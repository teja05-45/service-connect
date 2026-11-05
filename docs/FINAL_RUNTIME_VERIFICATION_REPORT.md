# Service Connect — Final Runtime Verification Report

Date: 2026-11-05
Environment: Windows 10/11, Git Bash, Docker Desktop (Linux containers)
Project: `C:\Users\user\Music\service-connect`

## Scope

Runtime verification of the running Docker stack, PostgreSQL schema/seed, admin
account, backend integration tests, live API authorization, browser rendering,
OTP flows, and Gmail SMTP. No application features were rewritten. All checks
below were executed against the services in this project.

## Environment and stack

| Item | Result | Evidence |
|---|---|---|
| Docker Desktop initially running | NO — started manually, engine ready in ~10s | `docker info` reported server 29.6.1 |
| Compose configuration valid | PASS | `docker compose config -q` exit 0 |
| Services | `db`, `backend`, `frontend` | `docker compose ps` |
| `db` | healthy, postgres:18-alpine, host port 5433 → 5432 | `docker compose ps`; psql queries |
| `backend` | healthy on 3001 | `/health` HTTP 200; rebuilt after SQL fix |
| `frontend` | healthy on 3000 | `/` and `/healthz` HTTP 200 |
| Database | `service_connect`, 21 tables | migration log + `information_schema` |
| Migration `001_provider_verification_and_admin.sql` | applied once, tracked | `schema_migrations`; verification columns, trigger, indexes present |
| Admin bootstrap | created once (userId 1, `admin@example.com`) | backend log `admin_bootstrap_created` |
| Seed script | PASS, idempotent (run twice) | 2 customers, 7 providers, bookings/reviews, 12 services |

No volumes were deleted and `docker compose down -v` was never run.

## Automated tests

| ID | Test | Expected | Actual | Status |
|---|---|---|---|---|
| T-01 | Backend unit + integration suite against isolated `service_connect_test` | all pass | 71 tests, 71 passed, 0 failed, 0 skipped | PASS |
| T-02 | Provider discovery integration tests | nearby/radius/filter assertions | all pass after fixture correction | PASS |
| T-03 | Admin provider lifecycle/audit integration tests | approve/reject/suspend + audit | all 4 previously failing tests now pass | PASS |
| T-04 | Frontend Jest suite | 4/4 | 4 passed, 4/4 | PASS |
| T-05 | Frontend production build | success | exit 0 | PASS |

Integration tests used a dedicated `TEST_DATABASE_URL` pointing at
`service_connect_test`; the development database was not used for tests.

## Live API verification

All requests went to `http://localhost:3001/api/v1`.

| ID | Check | Expected | Actual | Status |
|---|---|---|---|---|
| A-01 | Admin login, correct credentials | 200 | 200, role `admin` | PASS |
| A-02 | Login with wrong password | 401 | 401 | PASS |
| A-03 | Customer login | 200 | 200 | PASS |
| A-04 | Admin endpoint without token | 401 | 401 | PASS |
| A-05 | Admin endpoint with customer token | 403 | 403 | PASS |
| A-06 | Admin dashboard stats | 200 + live counts | 200 | PASS |
| A-07 | Admin provider list | 200 | 200, 7 providers | PASS |
| A-08 | Admin audit logs | 200 | 200 | PASS |
| A-09 | Discovery at lat 16.17, lon 81.129997, radius 10 km, AC service | 2 approved AC providers | 200, 2 providers (Suresh AC Services, Lakshmi Cooling Care) | PASS |

The API uses the `x-auth-token` header (not Bearer); an initial harness using
Bearer produced false 401s and was corrected.

## Browser verification (headless Chrome via CDP)

Chrome was driven against the running frontend. A real admin session was created
through `/api/v1/admin/login`, stored in localStorage, and pages were rendered.

| ID | Check | Expected | Actual | Status |
|---|---|---|---|---|
| B-01 | `/admin/login` renders | email + password + submit | form present, correct copy | PASS |
| B-02 | `/admin/dashboard` after admin sign-in | dashboard with live counts | Overview, Providers, Users, Services, Bookings, Reviews, Complaints, Wallet, Audit, Settings; users 10, customers 2, providers 7, services 12 | PASS |
| B-03 | `/services/5` AC page | AC providers shown | Suresh AC Services and Lakshmi Cooling Care rendered | PASS |
| B-04 | `/` homepage | services + top-rated providers | services grid and providers rendered | PASS |

Browser scope limitation: customer and provider dashboards were not
click-through-tested end to end in the browser. Their backend flows are covered
by the 71 integration tests and live API login checks, but this report does not
claim interactive browser verification of those dashboards.

Note: `/admin` intentionally renders the admin sign-in page; the dashboard URL
is `/admin/dashboard`. This is existing routing behavior, not a defect.

## OTP and email

| ID | Check | Expected | Actual | Status |
|---|---|---|---|---|
| O-01 | Forgot-password generates OTP | 200 | 200, `dev_otp` returned because email is not configured (dev fallback) | PASS (dev fallback) |
| O-02 | Wrong OTP | 401 | 401 | PASS |
| O-03 | Correct OTP resets password | 200 | 200 | PASS |
| O-04 | Login with new password | 200 | 200 | PASS |
| O-05 | Expired OTP | 401 | 401 (expiry forced in test DB for the check) | PASS |
| O-06 | Immediate resend/cooldown | cooldown expected | second request returned 200; no cooldown is enforced | FAIL / GAP |
| S-01 | Gmail SMTP delivery | accepted by SMTP and received | not testable: `EMAIL_USER` / `EMAIL_PASS` are empty | BLOCKED |

No email delivery is claimed. The application correctly falls back to returning
`dev_otp` in non-production when sending fails.

## Bugs found and fixed during verification

1. **Compose did not pass `ADMIN_PASSWORD` to the backend** although documented.
   Added it to `docker-compose.yml`; admin bootstrap then succeeded.
2. **Backend crash loop from CRLF line endings** in `server/docker-entrypoint.sh`
   (`[FATAL tini] exec ./docker-entrypoint.sh failed: No such file or directory`,
   exit 127). Normalized to LF and added `.gitattributes` (`*.sh text eol=lf`);
   backend became healthy in 9s.
3. **Admin provider status SQL type error** — PostgreSQL inferred `$4` as text
   inside `CASE`, producing `column "verified_by" is of type integer but
   expression is of type text`, and earlier `inconsistent types deduced for
   parameter $1`. Added explicit `$1::text`, `$3::boolean`, `$4::int` casts.
   Integration suite went from 4 failures to 71/71.
4. **Discovery integration fixture geometry** — provider was diagonal rather than
   due north and the radius case used the default coverage. Fixture corrected;
   assertions were not weakened.
5. **Stale `server/.env.example` comment** implying login promoted roles by email
   was corrected to match the separate admin login.

## Remaining blockers and gaps

- **Gmail SMTP: BLOCKED.** Requires `EMAIL_USER` and `EMAIL_PASS` (Gmail App
  Password). Until configured and a message is confirmed in the recipient inbox,
  email delivery is unverified. OTP works only through the development fallback.
- **No OTP resend cooldown** was observed; repeated forgot-password requests are
  accepted immediately (only the general rate limiter applies).
- **Legacy seeded services have empty `slug` values.** Discovery and the frontend
  use service IDs, so current flows work; admin-created services receive slugs.
  This was observed but not changed.
- **Browser coverage:** admin, home, and service pages were rendered and checked;
  customer/provider dashboard interactions were not exercised in Chrome.
- Docker Desktop was not running at the start; it must be started before using
  the stack.

## Conclusion

The stack builds, migrates, seeds, and runs healthy. Backend tests are 71/71,
frontend tests are 4/4, the production build succeeds, admin authorization and
provider discovery behave correctly in live API calls, and the main pages render
with live data in Chrome. Email delivery remains blocked without SMTP
credentials, and the resend-cooldown gap and browser-dashboard limitation are
recorded above rather than reported as passes.
