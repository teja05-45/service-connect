# Service Connect — Release Checklist

Date: 2026-11-05
Release scope: provider discovery, admin management, migrations, tests, documentation, and
local commit preparation.

Statuses are limited to **PASS**, **FAIL**, and **BLOCKED**. A blocked item is never treated
as a pass.

## Build and repository

| Item | Status | Evidence |
|---|---|---|
| Environment variables reviewed | PASS | `.env` and `server/.env` are ignored; tracked `.env.example` files contain placeholders only |
| No secrets in the current release tree | PASS | Pattern scan found no live keys, passwords, JWTs, or private keys; local env values were never printed |
| Historical secret exposure assessed | FAIL | An earlier committed `server/.env` contained non-empty Gmail, JWT, and database credentials; rotation is required, and history was not rewritten |
| Unintended generated files removed from Git index | PASS | `server/node_modules`, runtime uploads, and the legacy `data_base.sql` dump are untracked and ignored; local copies retained |
| `.gitignore` reviewed | PASS | Ignore rules cover env files, dependencies, build output, uploads, logs, and database dumps |
| Migrations verified | PASS | `schema_migrations` contains `001_provider_verification_and_admin.sql`; 21 tables present; rerun is idempotent |
| Git diff reviewed before commit | PASS | Final staged diff reviewed file-by-file; no unrelated user changes included |

## Automated checks

| Item | Status | Evidence |
|---|---|---|
| Backend unit/integration tests | PASS | 71 tests, 71 passed, 0 failed, 0 skipped against isolated `service_connect_test` |
| Frontend tests | PASS | 4/4 Jest tests passed |
| Frontend production build | PASS | `npm run build` exited 0 |
| Docker Compose configuration | PASS | `docker compose config -q` exited 0 |
| Docker stack healthy | PASS | `db`, `backend`, and `frontend` all healthy; API and frontend health endpoints returned 200 |
| Database data integrity checks | PASS | Users/providers/services/provider-services/bookings/audit/history counts queried successfully; no sensitive rows printed |

## End-to-end workflows

| Item | Status | Evidence |
|---|---|---|
| Admin login tested | PASS | Chrome: login form, invalid rejection, valid redirect to `/admin/dashboard`, refresh, tab navigation, provider detail, logout, and post-logout guard |
| Admin API authorization tested | PASS | Correct login 200; wrong password 401; missing token 401; customer/provider token on admin endpoint 403; stats/providers/audit 200 |
| Provider onboarding tested | PASS | API: registration -> wrong OTP 401 -> verification -> login -> complete profile -> pending -> admin approval -> public discovery |
| Customer onboarding tested | PASS | API: registration -> verification -> login -> profile/location -> nearby discovery -> booking |
| Provider discovery tested | PASS | Approved visible; pending hidden; suspended hidden; unrelated service excluded; out-of-radius excluded; nearest-first sort `[0.5, 1.1, 2, 24.1]`; empty search 200 with zero results; invalid coordinates 400 |
| Booking workflow tested | PASS | Customer booking created; visible in customer data; admin found/detail/status update; history entry recorded; audit action recorded |
| OTP workflow tested | PASS | Generation 200 with development fallback; wrong 401; correct reset 200; login 200; expired 401 |
| OTP resend cooldown | FAIL | Immediate second forgot-password request returned 200; no dedicated cooldown beyond general rate limiting |
| Customer/provider dashboard browser click-through | FAIL | API workflows passed, and home/service/admin pages rendered in Chrome, but customer/provider dashboard interactions were not fully click-tested |

## Email

| Item | Status | Evidence |
|---|---|---|
| Development OTP fallback documented | PASS | README and runtime tests describe `dev_otp` for non-production when SMTP is unavailable |
| Gmail SMTP delivery | BLOCKED | `EMAIL_USER` and `EMAIL_PASS` are empty; no SMTP acceptance or inbox receipt was observed |
| Gmail delivery status documented honestly | PASS | README and verification report state delivery is unverified and must not be claimed |

## Documentation and release

| Item | Status | Evidence |
|---|---|---|
| README updated | PASS | Setup, environment variables, Docker/local topologies, admin creation, workflows, discovery, email, testing, troubleshooting, and docs index |
| Admin creation command verified against code | PASS | `npm run create-admin -- --email ... --password ...`; 12-character minimum, optional `--rotate-password`, `--promote`, `--if-none` |
| Admin URLs documented | PASS | Login `/admin/login`; dashboard `/admin/dashboard` |
| Release checklist created | PASS | This file |
| Final runtime verification report present | PASS | `docs/FINAL_RUNTIME_VERIFICATION_REPORT.md` |
| Git commit created locally | PASS | Release commit contains this checklist after final diff review; not pushed |

## Release decision

The code, database migrations, tests, admin UI, discovery rules, provider/customer API
workflows, booking management, and development OTP fallback are verified. A local release
commit is permitted with the following explicitly documented gaps:

1. **Gmail SMTP is BLOCKED** until valid credentials are configured and delivery is confirmed.
2. **OTP resend has no dedicated cooldown** beyond general rate limiting.
3. **Customer/provider dashboard interactions are not fully browser-tested.**
4. **Legacy service rows may have empty slugs**; ID-based routing currently works.
5. **Historical credentials require rotation**; Git history was not rewritten.

Do not describe any blocked or failed item above as resolved.
