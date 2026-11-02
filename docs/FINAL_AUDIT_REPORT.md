# Final Audit Report — Service Connect

Date: 2026-11-02
Environment: Windows 11, Node.js 24.15.0, npm 11.12.1, Docker 29.6.1 / Compose v5.1.4,
PostgreSQL 18 (Docker and local install present).

## 1. Initial project condition

A complete but un-deployable marketplace app:

- React 19 SPA (CRA) + Express 5 API + PostgreSQL, JWT auth with email OTP.
- No README, no docs, no env templates, no `.gitignore`, no Docker assets.
- Database only as a binary PostgreSQL 18 dump (`data_base.sql`) — a fresh environment
  could not be provisioned.
- `server/.env` with real SMTP credentials tracked in git.
- Backend `npm test` intentionally failed; no frontend tests.
- Several functional defects (admin login, review rating, account takeover, 401/404
  confusion, upload URLs).

## 2. Issues discovered

30 findings: 6 Critical, 11 High, 9 Medium, 4 Low. Details, root causes and file-level
attribution are in [`docs/PROJECT_AUDIT.md`](./PROJECT_AUDIT.md).

## 3. Bugs fixed

- Admin role escalation now works (login selected no `email`).
- Unmatched API paths return JSON `404` instead of `401`.
- Registration can no longer overwrite an active account's credentials.
- Reviews require an integer rating 1–5 (API + UI), matching the DB constraint.
- Registration no longer dead-ends when SMTP is unconfigured or rejects the message.
- Upload URLs respect `PUBLIC_BASE_URL`, so files resolve through Docker.
- Upload directory is created on boot; duplicate multer configs replaced by one module.
- `GET /health` added, with a real database probe (`200`/`503`).
- Centralized JSON error handling (multer, malformed JSON, oversized bodies) and a JSON
  404 handler.
- Database pool error listener; API can no longer be killed by an idle-client error.
- Configurable CORS allow-list, structured JSON logging, auth rate limiting, email/password
  validation, JSON errors on profile/wallet paths, wallet row creation before admin approval.
- Junk files removed from `server/uploads/`; secrets untracked from git.

Regression found and fixed during verification: the upload refactor dropped the `multer`
import still referenced by `userRoutes`' upload wrapper, which left requests hanging. It
was caught by the end-to-end run and fixed before the final verification pass.

## 4. Files created

```
.gitignore                              README.md
.env.example                            docs/PROJECT_AUDIT.md
docs/FINAL_AUDIT_REPORT.md              docker-compose.yml
server/Dockerfile                       server/.dockerignore
server/docker-entrypoint.sh             server/.env.example
server/db/schema.sql                    server/db/seed.sql
server/scripts/migrate.js               server/scripts/wait-for-db.js
server/src/config/upload.js             server/src/middleware/rateLimit.js
server/src/utils/logger.js              server/tests/helpers.test.js
server/uploads/.gitkeep                 frontend/Dockerfile
frontend/nginx.conf                     frontend/.dockerignore
frontend/.env.example                   frontend/src/pages/utils/helpers.test.js
```

## 5. Files modified

```
server/index.js                         server/package.json
server/src/config/db.js                 server/src/config/nodemailer.js
server/src/utils/helpers.js             server/src/routes/authRoutes.js
server/src/routes/adminRoutes.js        server/src/routes/userRoutes.js
server/src/routes/bookingRoutes.js      server/src/routes/customerRoutes.js
server/src/routes/paymentRoutes.js      server/src/routes/providerRoutes.js (whitespace only)
server/src/routes/publicRoutes.js       (whitespace only)
frontend/src/pages/utils/helpers.js     frontend/src/components/modals/Modals.js
frontend/package.json                   server/.env (removed from git index)
```

## 6. Dependency changes

**None added, none removed.** `package.json` changes are scripts only:

- `server`: `start`, `dev`, `migrate`, `wait-for-db`, `test` (`node --test`), `engines.node >= 20`.
- `frontend`: added `test:ci`.

Both lockfiles (`server/package-lock.json`, `frontend/package-lock.json`) exist and were
used with `npm ci` in Docker builds.

## 7. Database changes

- Added the authoritative, idempotent `db/schema.sql` (17 tables, constraints, foreign
  keys, indexes) reconstructed from the original PG 18 dump.
- Added `db/seed.sql` with the 12 original service categories.
- Added `scripts/migrate.js` (safe to re-run) and `scripts/wait-for-db.js`.
- No data migration or destructive change was applied to any existing database.

## 8. Docker implementation

- `server/Dockerfile`: two stages (deps with build tooling for `bcrypt`, runtime on
  `node:20-alpine` with `tini`, non-root `node` user), healthcheck on `/health`.
- `frontend/Dockerfile`: CRA build stage + `nginx:1.27-alpine` runtime, healthcheck on
  `/healthz`; `REACT_APP_API_BASE_URL` is a build arg.
- `docker-compose.yml`: `db` (postgres:18-alpine, `pg_isready` healthcheck, `db_data`
  volume at `/var/lib/postgresql`), `backend` (waits for DB health, runs
  wait → migrate → start, `uploads_data` volume, healthcheck), `frontend` (waits for
  backend health). Internal DNS `db:5432`; published ports 3000/3001/5433.
- Entrypoint guarantees migrations finish before the API accepts traffic.

## 9. Tests executed

| # | Command | Result |
|---|---|---|
| 1 | `node --check` on all backend JS | PASS |
| 2 | `cd server && npm test` | PASS — 8/8 |
| 3 | `cd frontend && CI=true npm run test:ci` | PASS — 4/4 |
| 4 | `cd frontend && npm run build` (with `REACT_APP_API_BASE_URL`) | PASS |
| 5 | `npm run migrate` against a fresh PostgreSQL 18 database | PASS — 17 tables, 12 services |
| 6 | Full API integration script against local server (`:3101`) | PASS — 21/21 |
| 7 | `docker compose config --quiet` | PASS |
| 8 | `docker compose build` | PASS — both images built |
| 9 | `docker compose up --build -d` | PASS — all three containers healthy |
| 10 | Same integration script through Docker (`:3001`) | PASS — 21/21 |
| 11 | Persistence: counts before/after `docker compose down` + `up -d` | PASS — users 3→3, services 12→12, volumes retained |
| 12 | Container log scan for `"level":"error"` | PASS — 0 |
| 13 | `GET /health` (local and Docker) | PASS — `200`, database `up` |
| 14 | Frontend served by nginx (`:3000`, `/healthz`) | PASS — `200`, correct title |

Integration coverage: register → OTP → login (customer/provider/admin), provider profile
setup, admin provider verification, provider search by distance, profile photo upload,
deposit request + admin approval + wallet balance, booking creation, price quote,
customer confirmation, chat send/read/unread, job completion, wallet payment, provider
earnings, review validation and rating recalculation, duplicate-registration protection,
and 404 handling.

## 10. Test results

All automated checks and both end-to-end runs passed after the fixes. Two configuration
defects were found only by actually running Docker (PostgreSQL 18 volume path, missing
`middleware/` COPY) and are fixed and re-verified.

## 11. Remaining issues

- `AdminDashboard` provider table assumes the provider list is loaded before rendering the
  action button (low risk of a null dereference on a cold tab switch).
- `ProviderDashboard.handleAction` replaces specific API error messages with a generic
  network error.
- Tailwind CSS is still loaded from a CDN (needs a build pipeline for offline/production).
- Legacy unused tables/columns remain in the schema.
- Rate limiting is in-memory (single instance only); JWTs have no refresh flow.

## 12. Known limitations

- **Local database verification used a Docker-provisioned PostgreSQL 18**, not the
  workstation's own PostgreSQL service: its password was not available to the agent and
  reading `server/.env` was out of scope. The schema and migration were verified against
  a real PostgreSQL 18 server; only the credentials differ.
- **SMTP delivery was not verified with valid credentials.** The failure path was verified
  (the API logs the failure and, in development, returns `dev_otp`).
- No browser click-through/UI screenshots were performed; frontend verification is the
  production build, unit tests, and nginx serving the app.
- Docker was verified on Windows (Docker Desktop Linux engine) only.
- `docker compose down -v` destroying data was not executed against real user data.

## 13. Local execution status

PASS. With a running PostgreSQL and `server/.env` configured:

```
cd server && npm install && npm run migrate && npm start
cd frontend && npm install && npm start
```

Verified: migration on PostgreSQL 18, API health, 21/21 functional checks, 8 backend unit
tests, 4 frontend unit tests, successful production build.

## 14. Docker execution status

PASS. `docker compose up --build -d` builds both images, starts PostgreSQL with a
healthcheck, applies schema + seed, starts the API, and starts nginx once the API is
healthy. All containers report `healthy`; database data and uploads survive
`docker compose down` + `up -d`.

Running now: frontend <http://localhost:3000>, API <http://localhost:3001/api/v1>,
API health <http://localhost:3001/health>.

## Final summary

| Component | Status | Details |
|---|---|---|
| Frontend | PASS | Production build succeeds; 4/4 unit tests; served by nginx (`200`, correct title) |
| Backend | PASS | Starts against PostgreSQL 18; `/health` 200; 8/8 unit tests; structured logs |
| Database | PASS | Idempotent schema applied: 17 tables, 12 seeded services; data persists across container recreation |
| API Integration | PASS | 21/21 end-to-end checks on local server and through Docker |
| Dependencies | PASS | `npm ci` from committed lockfiles; no dependency changes; no missing modules |
| Tests | PASS | 12 unit tests + 2 full integration runs, all passing |
| Docker Build | PASS | `service-connect-backend` and `service-connect-frontend` images built |
| Docker Compose | PASS | Config validates; all three services healthy; volumes retained |
| README | PASS | Root README documents both run paths, API, DB, Docker and troubleshooting; commands match the implementation |

## Git workflow

- **Branch:** `main`
- **Initial commit count:** 25 (preserved, no history rewritten, no force-push)
- **Final commit count:** 66
- **New commits for this assignment:** 41
- **Working tree after commits:** clean

### Commit distribution

| Category | Commits |
|---|---:|
| Project setup, repo hygiene and configuration | 8 |
| Database and migrations | 4 |
| Backend (config, middleware, routes, server) | 14 |
| Frontend | 3 |
| Testing | 2 |
| Docker and DevOps | 7 |
| Documentation | 3 |
| **Total new commits** | **41** |

Every commit contains a real change to a specific file or coherent group of files, staged
with an explicit pathspec. No commit is empty, and no file was committed multiple times
for the sake of volume.

### Milestones

1. Repository hygiene: ignore rules, secret untracking, stray-file removal, env templates.
2. Configuration: npm scripts, database pool and email configuration.
3. Database: idempotent schema, seed, migration runner, readiness gate.
4. Backend: shared uploads, structured logging, rate limiting, route fixes, health/errors.
5. Frontend: configurable API origin, review rating guard, test script.
6. Testing: backend and frontend unit suites.
7. Docker and deployment: images, entrypoint, nginx, compose stack.
8. Documentation: README, project audit, final report.

### Why 41 rather than 50+

The audit's actual change set is roughly 45 files representing one coherent piece of
work; it was split into 41 runtime-, review- and deployment-scoped commits. Reaching an
arbitrary higher number would have required either splitting single-file fixes into
non-compiling intermediate states or adding whitespace/rename-only commits, both of which
the brief explicitly forbids. The shortfall is reported here rather than manufactured.
