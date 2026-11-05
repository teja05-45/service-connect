# Testing Report — Service Connect

Date: 2026-11-05
Environment: Windows, Node.js v24.12.0, npm 11.6.2.
Docker daemon: **not running**. Local PostgreSQL: **not installed**. Therefore no live
database, no container startup and no browser session were executed in this environment.

---

## 1. Summary

| Suite | Type | Result |
|---|---|---|
| `server/tests/*.test.js` (5 files) | Node test runner, unit | **37 passed, 0 failed** |
| `server/tests/integration/providerDiscovery.test.js` | DB integration | **15 skipped** (no `TEST_DATABASE_URL`) |
| `server/tests/integration/adminApi.test.js` | DB integration | **19 skipped** (no `TEST_DATABASE_URL`) |
| Full backend run (`npm test`) | — | **71 tests: 37 passed, 0 failed, 34 skipped** |
| `node --check` on all server files | Syntax | **All passed** |
| JSX parse (`esbuild`) on changed frontend files | Syntax | **All passed** |
| `CI=true npm run test:ci` (frontend) | Jest | **4 passed, 1 suite** |
| `CI=false npm run build` (frontend) | Production build | **Exit 0**, compiled with lint warnings |
| `docker compose config -q` | Compose validation | **Passed** (with required env vars supplied) |
| `require('./server/index')` | Route-loading smoke | **Passed** (app loads; DB connection logged as unavailable) |
| Docker up / live API / browser | Manual E2E | **Not run** — daemon unavailable. |

No check was reported as passing unless it actually ran.

## 2. Backend unit tests (executed)

Files:

- `tests/geo.test.js` — latitude/longitude validation, complete-pair requirement,
  `(0,0)` handling, radius clamping, provider coverage fallback, Haversine symmetry and
  scale, rounding.
- `tests/providerSearch.test.js` — SQL builder: approved + active + located filters,
  service matching, active-service joins, Haversine expression, search-radius AND provider-
  coverage filter, bounding-box prefilter, distance ordering, no-location behaviour,
  top-rated without a service, parameter order, row mapping.
- `tests/adminAuth.test.js` — admin guard rejects non-admin token, missing DB role,
  suspended admin; allows active admin and attaches `req.admin`; DB failure → 500.
  Plus pagination parsing/metadata and settings validation.
- `tests/helpers.test.js` — pre-existing distance/OTP/email/file-URL tests.

Command and result:

```bash
cd server
npm test
# tests 71 (37 pass, 0 fail, 34 skipped: 15 discovery + 19 admin)
```

## 3. Database integration tests (written, skipped here)

### Provider discovery — 15 cases

File: `server/tests/integration/providerDiscovery.test.js`

1. approved nearby provider offering the selected service is returned
2. approved provider outside the radius is excluded
3. pending provider is not discoverable
4. suspended provider is not discoverable
5. approved provider offering another service is excluded
6. provider with missing coordinates is excluded
7. invalid customer coordinates → `400 INVALID_COORDINATES`
8. missing customer location → providers returned without distance filter
9. multiple nearby providers sorted by distance
10. provider on the radius boundary is included
11. larger radius includes a provider the smaller radius excludes
12. no matching provider → empty list, `200`
13. unknown service category → `404 SERVICE_NOT_FOUND`
14. provider with multiple services appears once and lists both
15. suspended user account hides its approved provider

Not covered by this file: a deliberately induced database failure (would require breaking
the live connection and risk affecting other tests). The route returns
`500 PROVIDER_SEARCH_FAILED` with a user-facing message; this path is verified by source
inspection only.

### Admin API — 19 cases

File: `server/tests/integration/adminApi.test.js`

1. admin login succeeds
2. invalid admin credentials rejected
3. customer rejected by admin login
4. provider token blocked from admin API
5. unauthenticated admin request rejected
6. invalid JWT rejected
7. dashboard stats come from the database
8. user listing includes pagination and no password hash
9. provider listing includes services
10. provider approval updates status and mirror boolean
11. rejection requires a reason and stores it
12. suspension updates status and clears verification
13. service creation
14. service modification
15. booking listing and status history
16. review moderation recalculates provider rating
17. admin actions written to audit log
18. pagination returns distinct pages
19. forged JWT with `role: admin` for a customer is rejected by the database check

### How to run them

Use a **disposable** database, never the development/production one:

```bash
# with Docker's database running on host port 5433
docker compose exec -T db createdb -U service_connect service_connect_test

cd server
TEST_DATABASE_URL=postgres://service_connect:YOUR_PASSWORD@localhost:5433/service_connect_test \
  npm test
```

The suites:

- apply `db/schema.sql`, all migrations and the service seed idempotently,
- create users with the prefixes `it-discovery-…@example.test` and
  `it-admin-…@example.test`,
- delete only those prefixed rows in `after()`,
- start the Express app on an ephemeral port and call it with `fetch`.

## 4. Frontend checks

- All changed `.js` files parsed successfully with `esbuild --loader:.js=jsx`:
  `App.js`, `AuthContext.js`, `ServicePages.js`, `AdminDashboard.js`, `AuthForms.js`,
  `UI.js`, `Cards.js`, `pages/utils/helpers.js`.
- Dependencies were installed (`npm ci`, 1343 packages), then:

  ```text
  CI=true npm run test:ci
  PASS src/pages/utils/helpers.test.js
  Test Suites: 1 passed, 1 total
  Tests:       4 passed, 4 total

  CI=false npm run build
  Compiled with warnings.
  File sizes after gzip: 91.19 kB main JS, 238 B main CSS
  exit code 0
  ```

- Remaining build warnings are non-blocking lint warnings: pre-existing
  `jsx-a11y/anchor-is-valid` patterns and one unused import already present in `UI.js` /
  `ProviderDashboard.js`. The new unused-import warnings introduced during this work were
  removed (including adding a booking status-change control so the bookings tab has no dead
  state).
- Browser verification (discovery page, admin login/dashboard) was not possible here.

## 5. Docker / runtime verification (not performed)

`docker compose config -q` **passed** with required variables supplied inline
(`POSTGRES_PASSWORD=… JWT_SECRET=… docker compose config -q`), confirming the Compose file
is valid and the new code needs no Compose changes.

Docker Desktop's engine was unreachable (`npipe:////./pipe/dockerDesktopLinuxEngine`), so
the runtime commands were **not** run:

```bash
docker compose ps
docker compose up -d --build --force-recreate
docker compose logs --tail=200
```

The Compose file, Dockerfiles and entrypoint were inspected; no changes were required for
the new endpoints. Expected startup remains: `db healthy → backend healthy → frontend`.
Because the stack was not started, container health and the live API are unverified here.

## 6. Manual acceptance checklist (to run in a working environment)

1. `cd server && npm run migrate` — verify migrations apply and tables/indexes exist.
2. Start the API and open `/health` → `200`, database `up`.
3. Create the first admin, sign in at `/admin/login`.
4. Seed development data (`npm run seed:dev`) at 16.17, 81.129997.
5. Customer at the test location opens AC/Refrigerator Repair:
   - sees the near and mid approved AC providers,
   - does **not** see the electrician, far (>10 km), pending, rejected or suspended providers,
   - sees distances and nearest-first order.
6. Change radius to 30 km → the far approved AC provider appears.
7. Customer with no location → approved AC providers listed, clearly labelled unfiltered.
8. Admin approves the pending provider → it appears in a fresh search.
9. Admin suspends/rejects with a reason → provider disappears and the reason is in the
   provider row and audit log.
10. Admin hides a review → provider rating recalculates; restore works.
11. Admin deactivates a service → it disappears from customer search, bookings remain.
12. Customer/admin/provider logins all still work; provider onboarding requires valid
    coordinates and at least one service.

## 7. Limitations / blockers

- No live database or Docker verification in this session.
- No browser session, therefore no screenshots or interaction tests.
- No frontend production build (dependency installation attempted separately).
- Integration suites are unexecuted here; they must be run before claiming the SQL and
  endpoints work against PostgreSQL.
- PostGIS was intentionally not introduced; the indexed lat/lon + Haversine approach is
  used and documented.
