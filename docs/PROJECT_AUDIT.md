# Project Audit — Service Connect

Date: 2026-11-02
Scope: full repository (`server/`, `frontend/`, `data_base.sql`, tooling, deployment).
Method: source inspection, schema reconstruction from the committed dump, live API
execution, Docker build/run, and end-to-end functional tests.

## Initial state

- Working full-stack app: React 19 SPA + Express 5 API + PostgreSQL, JWT auth, OTP email
  flow, bookings, chat, wallet, reviews, admin console.
- No root README, no `docs/`, no `.env.example` files, no `.gitignore` at the root.
- No Docker configuration at all.
- Database existed only as `data_base.sql`, a **PostgreSQL 18 custom-format archive**
  (binary `PGDMP`), not executable SQL. There was no way to provision a fresh database
  from the repository.
- `server/.env` (with real SMTP credentials) was **tracked in git**.
- Backend had no health endpoint, no centralized error handling, no request logging and
  no tests; `npm test` was a stub that exited with an error.
- Frontend had no tests and a hardcoded API origin.

## Findings

Severity counts: **6 Critical, 11 High, 9 Medium, 4 Low** (30 total; 25 fixed, 5 open).

| ID | Severity | Area | Issue | Root cause | Affected files | Fix | Status |
|---|---|---|---|---|---|---|---|
| C1 | Critical | Auth | Admin account could never be promoted to `admin`; admin dashboard unreachable | Login SQL selected `id, password_hash, role, status` but not `email`, so `user.email === ADMIN_EMAIL` was always false | `server/src/routes/authRoutes.js` | Added `email` to the SELECT; case-insensitive comparison | Fixed |
| C2 | Critical | Database | No reproducible schema; a fresh database (or Docker) had no tables | Only a binary `PGDMP` archive was committed; `docker-entrypoint-initdb.d` cannot run it | `data_base.sql`, new `server/db/*` | Added idempotent `db/schema.sql` + `db/seed.sql`, reconstructed from the dump | Fixed |
| C3 | Critical | Deployment | `docker compose up` impossible; no Docker assets | Missing Dockerfiles/compose/entrypoint | new Docker files | Added backend/frontend images, compose, healthchecks, volumes | Fixed |
| C4 | Critical | Deployment | Backend container crashed on boot with `Cannot find module '../../middleware/auth'` | `server/Dockerfile` copied `src/` but `middleware/` lives at the `server/` root | `server/Dockerfile` | Added `COPY middleware ./middleware` | Fixed |
| C5 | Critical | Deployment | PostgreSQL container restart-looped with "in 18+, these Docker images are configured to store database data…" | PostgreSQL 18 images moved `PGDATA` under a versioned dir; mounting `/var/lib/postgresql/data` is rejected | `docker-compose.yml` | Mount the volume at `/var/lib/postgresql` | Fixed |
| C6 | Critical | Auth/UX | Registration returned "OTP sent" even when SMTP rejected the message, so signup could never complete | `sendEmail` swallows errors; OTP was only delivered by email | `authRoutes.js`, `config/nodemailer.js` | `sendEmail` returns success; in non-production a failed send returns `dev_otp` | Fixed |
| H1 | High | Security | `server/.env` with live SMTP credentials committed to git | Missing `.gitignore` | `.env`, `.gitignore` | Untracked the file, added root `.gitignore`; credentials must be rotated | Fixed (rotate externally) |
| H2 | High | API | Every unmatched `/api/v1/*` request returned `401` instead of `404` | `router.use(auth, isAdmin)` in the admin router (mounted at `/api/v1`) ran for all requests reaching it | `server/src/routes/adminRoutes.js` | Scoped the guard with `router.use('/admin', auth, isAdmin)` | Fixed |
| H3 | High | Auth | Account takeover: re-registering any non-active account overwrote its password/role | Upsert allowed whenever `status !== 'active'` | `server/src/routes/authRoutes.js` | Only `pending_verification` accounts may be resumed; otherwise `409` | Fixed |
| H4 | High | Reviews | Submitting a review with 0 stars returned `500` | API allowed `rating >= 0`, DB has `CHECK (rating BETWEEN 1 AND 5)`; UI defaulted to 0 | `paymentRoutes.js`, `components/modals/Modals.js` | API requires integer 1–5; UI blocks submit until a star is chosen | Fixed |
| H5 | High | Frontend | API origin hardcoded to `http://localhost:3001/api/v1` | Literal constant | `frontend/src/pages/utils/helpers.js` | Reads `REACT_APP_API_BASE_URL`, falls back to localhost | Fixed |
| H6 | High | Uploads | Uploaded-file URLs used the request host, producing unreachable `http://backend:3001/...` inside Docker | URL built from `req.get('host')` | `userRoutes`, `bookingRoutes`, `customerRoutes` | `buildFileUrl()` honours `PUBLIC_BASE_URL` | Fixed |
| H7 | High | Uploads | Uploads fail with `ENOENT` if `uploads/` does not exist | multer disk destination not created | `src/config/upload.js` | Directory created on module load; shared upload config | Fixed |
| H8 | High | Ops | No health endpoint for Docker/operators | Not implemented | `server/index.js` | `GET /health` with DB probe, `200`/`503` | Fixed |
| H9 | High | API | No 404/error middleware; errors returned HTML stack traces and plain-text 500s | Each route handled only its own path | `server/index.js`, `userRoutes.js` | Central JSON 404 + error handler (multer/JSON/size aware) | Fixed |
| H10 | High | Reliability | Process could crash on idle DB client errors | No `pool.on('error')` | `src/config/db.js` | Listener added; probe isolated from startup | Fixed |
| H11 | High | Config | CORS origin hardcoded to `http://localhost:3000` | Literal in `cors()` | `server/index.js` | `CORS_ORIGIN` allow-list (comma separated) | Fixed |
| M1 | Medium | Ops | No request/structured logging | Ad-hoc `console.log` | `server/index.js`, new logger | JSON logger + per-request log with id/duration | Fixed |
| M2 | Medium | Security | No brute-force protection on login/OTP | Not implemented | new `middleware/rateLimit.js`, `authRoutes` | In-memory limiter (20/15 min login, 10/15 min OTP) | Fixed |
| M3 | Medium | Validation | No email format or password-length validation | Hand-written presence checks only | `authRoutes.js`, `utils/helpers.js` | Email shape check and 8-character minimum | Fixed |
| M4 | Medium | API | Inconsistent error formats (`text/plain` 500s) | Mixed `res.send`/`res.json` | `userRoutes.js` | JSON errors everywhere on those paths | Fixed |
| M5 | Medium | Wallet | Admin approval crashed if the user had no wallet row | `walletUpdate.rows[0].balance` assumed a row | `adminRoutes.js` | Insert wallet row if missing before balance update | Fixed |
| M6 | Medium | Tooling | `npm test` failed by design; no scripts for start/migrate | Stub script | `server/package.json` | Added `start`, `dev`, `migrate`, `wait-for-db`, `test` | Fixed |
| M7 | Medium | Tooling | No env templates or dockerignore files | Missing | new `.env.example` ×3, `.dockerignore` ×2 | Added | Fixed |
| M8 | Medium | Frontend | No tests; `npm test` had nothing to run | Missing | new `helpers.test.js`, `package.json` | Added unit tests + `test:ci` | Fixed |
| M9 | Medium | Repo hygiene | `server/uploads/` contained junk files (`!isNaN(n)`, `a.distance_km`, `{`) and committed user uploads | Accidental shell redirects during development | `server/uploads/*` | Removed junk; uploads now gitignored with `.gitkeep` | Fixed |
| L1 | Low | Frontend | Admin provider table dereferences `provider.id` without a null check | Assumes list already loaded | `AdminDashboard.js` | Not changed (low risk; list is loaded before the tab renders actions) | Open |
| L2 | Low | Frontend | Provider booking actions replace real API error text with "Network error" | `catch` overwrites `throw` message | `ProviderDashboard.js` | Not changed | Open |
| L3 | Low | Frontend | Tailwind CSS is loaded from a CDN at runtime | `index.html` script tag | `frontend/public/index.html` | Not changed (migrating to a build pipeline risks visual regressions); documented | Open |
| L4 | Low | Database | Unused legacy tables/columns (`otps`, `password_resets`, `deposit_requests`, `withdrawal_requests`, `providers.profile_photo_url`) | Historical schema | `db/schema.sql` | Kept for compatibility; documented | Open |

## Notes on approach

- The binary dump was restored into a disposable PostgreSQL 18 container to recover the
  authoritative schema and seed rows; `db/schema.sql` and `db/seed.sql` were derived from
  that, not invented.
- Existing architecture (route layout, response shapes, role model) was preserved. No
  endpoints were added beyond `/health`; no dependencies were added or removed.
- During verification one regression was introduced by the upload refactor
  (`userRoutes` referenced `multer.MulterError` after its import was removed) and caught
  by the end-to-end run; it was fixed before completion. See the final report.
