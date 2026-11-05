# Service Connect

Service Connect is a full-stack local-services marketplace. Customers find approved
professionals by service category and distance, request a booking, accept a provider's
quoted price, chat about the job, pay from an in-app wallet, and leave a review. Providers
manage requests, pricing, availability, and withdrawals. Administrators verify providers,
moderate activity, manage bookings and wallet requests, and inspect an audit trail.

This repository contains the React frontend, Express API, PostgreSQL schema and migrations,
Docker Compose stack, tests, and operational documentation.

## A. Project overview

### What it does

- Gives customers a location-aware directory of verified local service providers.
- Makes pricing explicit: a provider quotes, and the customer accepts or rejects before work.
- Keeps the transaction traceable through booking history, chat, wallet payments, and reviews.
- Gives platform operators a separate, database-backed admin console.

### Main features

- Customer/provider registration with email OTP verification and JWT login.
- Service catalogue and distance/radius-based provider discovery.
- Provider onboarding with location, coverage radius, and service categories.
- Manual admin approval (or optional auto-approval setting) before public visibility.
- Two-step booking flow and provider/customer booking statuses.
- Per-booking chat with attachments and unread counts.
- Wallet deposits, admin-verified payments, provider withdrawals, and transactions.
- Reviews with provider rating recalculation.
- Admin dashboard, user/provider/booking management, review moderation, complaints,
  wallet approvals, platform settings, and audit logs.
- Versioned SQL migrations and a reproducible development seed.

### Workflows

**Customer:** register -> verify email with OTP -> log in -> complete profile and location ->
choose a service and radius -> view nearby approved providers -> open a provider -> create a
booking -> accept the provider's quote -> chat/pay/review.

**Provider:** register -> verify email -> complete profile with real coordinates, coverage
radius, and services -> submit for review -> wait for admin approval -> receive bookings ->
quote/reject/complete work -> track earnings and request withdrawals.

**Administrator:** sign in at the separate admin URL -> review live statistics -> verify or
suspend providers -> inspect users, services, and bookings -> resolve reviews/complaints and
wallet requests -> review audit logs and platform settings.

## B. Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Create React App (`react-scripts` 5), React Testing Library, plain `fetch`, Tailwind via CDN |
| Backend | Node.js 20+ (verified on Node 24), Express 5, `pg`, `bcrypt`, `jsonwebtoken`, `multer`, `nodemailer`, `otp-generator` |
| Database | PostgreSQL 18 (14+ supported), plain SQL, no ORM |
| Auth | JWT in the `x-auth-token` request header; bcrypt password hashes |
| Email | Nodemailer over SMTP (optional in development) |
| Infrastructure | Docker, Docker Compose, nginx for the production frontend build |
| Tests | Node's built-in test runner; Jest through `react-scripts` |

## C. Project structure

```text
.
├── docker-compose.yml             # db + backend + frontend
├── .env.example                   # Compose environment template
├── .gitattributes                 # LF policy for shell/Docker files
├── README.md
├── docs/                          # architecture, admin, discovery, testing, release docs
├── server/                        # Express API
│   ├── index.js                   # app startup, middleware, routes, health check
│   ├── middleware/auth.js         # JWT verification (x-auth-token)
│   ├── db/
│   │   ├── schema.sql             # idempotent base schema
│   │   ├── seed.sql               # service catalogue seed
│   │   └── migrations/            # versioned SQL, tracked in schema_migrations
│   ├── scripts/
│   │   ├── migrate.js             # schema -> pending migrations -> seed
│   │   ├── create-admin.js        # create/rotate a database-backed admin
│   │   ├── seed-dev.js            # demo customers/providers/bookings/reviews
│   │   └── wait-for-db.js         # Docker readiness gate
│   ├── src/
│   │   ├── config/                # PostgreSQL pool, uploads, Nodemailer
│   │   ├── middleware/            # rate limiting, admin database guard
│   │   ├── routes/                # public, auth, user, booking, customer, provider, payment, admin
│   │   ├── services/              # discovery, audit, settings, booking history, admin bootstrap
│   │   └── utils/                 # geo, pagination, logger, helpers
│   ├── tests/                     # unit and isolated-database integration tests
│   ├── Dockerfile
│   └── docker-entrypoint.sh       # wait -> migrate -> start
└── frontend/                      # React SPA
    ├── Dockerfile                 # build -> nginx
    ├── nginx.conf                 # SPA fallback + /healthz
    ├── public/
    └── src/
        ├── App.js                 # state-based page routing (admin URLs are real paths)
        ├── context/AuthContext.js
        ├── components/            # shared UI, auth forms, cards
        └── pages/                 # home, services, dashboards, helpers
```

Runtime uploads live under `server/uploads/` and are ignored by Git. A legacy local database
dump is also ignored and is not part of a fresh clone.

## D. Prerequisites

- **Git** 2.x.
- **Node.js 20 or newer** and npm (verified with Node 24 and npm 11).
- **Docker Desktop** with Docker Compose v2 (`docker compose version`) for the Docker path.
- **PostgreSQL 14+** only if running the API outside Docker against a locally installed
  database. The verified version is PostgreSQL 18.
- A **Gmail account with an App Password** only if real email delivery is required.
- Free host ports: **3000** (frontend), **3001** (API), **5433** (Docker PostgreSQL).
- Windows PowerShell 5.1+ or PowerShell 7 for the commands below.

Check versions:

```powershell
git --version
node -v
npm -v
docker compose version
```

## E. Environment setup

Clone the repository and enter it:

```powershell
git clone https://github.com/teja05-45/service-connect.git
cd service-connect
```

There are two supported topologies:

1. **Docker Compose** uses the root `.env` and runs all three services.
2. **Local development** uses `server\.env` and `frontend\.env`; PostgreSQL may still run in
   Docker.

Copy the templates:

```powershell
Copy-Item .env.example .env
Copy-Item server\.env.example server\.env
Copy-Item frontend\.env.example frontend\.env
```

Generate strong secrets instead of using the placeholders:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Use the generated value for `JWT_SECRET`. Use a different strong value for database
passwords. Never commit `.env` files.

### Root `.env` (Docker Compose)

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_DB` | No | Database name, default `service_connect` |
| `POSTGRES_USER` | No | Database user, default `service_connect` |
| `POSTGRES_PASSWORD` | Yes | Database password; Compose refuses to start without it |
| `DB_PORT` | No | Host port for PostgreSQL, default `5433` (container port is always `5432`) |
| `JWT_SECRET` | Yes | JWT signing key; Compose refuses to start without it |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | No | Optional first-run admin bootstrap; both must be set and no admin may exist |
| `EMAIL_USER`, `EMAIL_PASS` | No | Gmail address and App Password for real email |
| `EMAIL_SENDER_NAME` | No | Display name on outgoing mail |
| `NODE_ENV` | No | `development` (default) or `production` |
| `LOG_LEVEL` | No | `error`, `warn`, `info`, or `debug` |
| `BACKEND_PORT` | No | Published API port, default `3001` |
| `FRONTEND_PORT` | No | Published frontend port, default `3000` |
| `CORS_ORIGIN` | No | Comma-separated browser origins, default `http://localhost:3000` |
| `PUBLIC_BASE_URL` | No | Browser-visible API origin used for upload URLs |
| `REACT_APP_API_BASE_URL` | No | Browser-visible API base compiled into the frontend image |
| `SEED` | No | `false` skips the base service seed during migration |

### `server\.env` (local API)

| Variable | Required | Purpose |
|---|---|---|
| `PORT`, `HOST` | No | API port/bind address, defaults `3001` / `0.0.0.0` |
| `NODE_ENV` | No | Enables `dev_otp` fallback when not `production` |
| `JWT_SECRET` | **Yes** | API refuses to start without it |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | No | Optional first-run bootstrap; minimum 12 characters; never promotes an existing user |
| `CORS_ORIGIN` | No | Allowed frontend origins, comma separated |
| `PUBLIC_BASE_URL` | No | Public API origin for file URLs |
| `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD` | Yes* | PostgreSQL connection |
| `DATABASE_URL` | Alternative* | Full connection string instead of `PG_*` |
| `EMAIL_SERVICE` | No | `gmail` for Gmail SMTP |
| `EMAIL_USER`, `EMAIL_PASS` | No | SMTP login and App Password |
| `EMAIL_SENDER_NAME` | No | Sender display name |
| `UPLOAD_DIR` | No | Upload directory; defaults to `server/uploads` |
| `SEED` | No | `false` skips the service catalogue seed |
| `LOG_LEVEL` | No | Structured log verbosity |

\* Provide either `DATABASE_URL` or the `PG_*` values.

### `frontend\.env` (local frontend)

| Variable | Required | Purpose |
|---|---|---|
| `REACT_APP_API_BASE_URL` | Yes for local non-default API | Browser-reachable API base, normally `http://localhost:3001/api/v1` |

Create React App compiles this value into the bundle. Restart the dev server or rebuild the
Docker image after changing it.

## F. Running with Docker Compose

1. Start Docker Desktop and wait until the engine is ready:

   ```powershell
   docker info
   ```

2. Configure the root environment:

   ```powershell
   Copy-Item .env.example .env
   # Edit .env and set POSTGRES_PASSWORD, JWT_SECRET, and optional admin/email values.
   ```

3. Build and start the stack:

   ```powershell
   docker compose up -d --build
   ```

4. Check health:

   ```powershell
   docker compose ps
   ```

   Expected: `db`, `backend`, and `frontend` all report `healthy`.

5. Check logs:

   ```powershell
   docker compose logs --tail=200
   docker compose logs -f backend
   ```

6. Open:

   - Application: <http://localhost:3000>
   - Admin login: <http://localhost:3000/admin/login>
   - API: <http://localhost:3001/api/v1>
   - Health: <http://localhost:3001/health>

7. Stop safely:

   ```powershell
   docker compose down
   ```

   This preserves named volumes and database data. **Do not** run
   `docker compose down -v` unless you intentionally want to delete the database and uploads.

On startup the backend waits for PostgreSQL, applies `schema.sql`, applies pending files in
`server/db/migrations/`, seeds the service catalogue (unless `SEED=false`), starts the API,
and only then does the frontend start.

## G. Running locally without the full stack

### 1. Start PostgreSQL in Docker

```powershell
docker compose up -d db
```

The database is available to Windows applications at **`localhost:5433`**, not `5432`.
Inside the Compose network the API uses `db:5432`; those are different topologies.

Configure `server\.env` for local access:

```dotenv
PG_HOST=localhost
PG_PORT=5433
PG_DATABASE=service_connect
PG_USER=service_connect
PG_PASSWORD=the-same-password-as-POSTGRES_PASSWORD
```

### 2. Run the backend locally

```powershell
cd server
npm install
npm run migrate
npm start
```

For auto-restart during development use `npm run dev`. Verify:

```powershell
curl.exe http://localhost:3001/health
curl.exe http://localhost:3001/api/v1/services
```

### 3. Run the frontend locally

In another terminal:

```powershell
cd frontend
npm install
npm start
```

Open <http://localhost:3000>. If the API is not on the default URL, set
`REACT_APP_API_BASE_URL` in `frontend\.env` and restart.

### 4. Verify connectivity

- Frontend loads and service cards appear.
- Browser devtools show API requests to `http://localhost:3001/api/v1`.
- `GET /health` returns `200` with a database status.
- CORS errors mean `CORS_ORIGIN` does not include the frontend origin.

## H. Database setup, migrations, and seed data

From `server/`:

```powershell
npm run migrate
```

`npm run migrate`:

1. Applies the idempotent base schema (`server/db/schema.sql`).
2. Applies each unapplied file in `server/db/migrations/` in filename order inside a
   transaction.
3. Records filenames in `schema_migrations`.
4. Applies the service catalogue seed unless `SEED=false`.

It never drops tables or data and is safe to rerun. Check migration status:

```powershell
docker compose exec db psql -U service_connect -d service_connect -c "SELECT filename, applied_at FROM schema_migrations ORDER BY filename;"
```

Check table count and key rows without printing personal data:

```powershell
docker compose exec db psql -U service_connect -d service_connect -c "SELECT count(*) AS tables FROM information_schema.tables WHERE table_schema='public';"
docker compose exec db psql -U service_connect -d service_connect -c "SELECT role, count(*) FROM users GROUP BY role;"
docker compose exec db psql -U service_connect -d service_connect -c "SELECT verification_status, count(*) FROM providers GROUP BY verification_status;"
```

### Development seed data

```powershell
cd server
npm run seed:dev
npm run seed:dev -- --reset   # remove previous demo rows first
```

The seed is idempotent for normal reruns. It creates demo customers, providers in pending,
approved, rejected, and suspended states, services, bookings, and reviews. Demo accounts use
`@example.test` addresses, `[DEMO]` names, and the development-only password
`DemoPass123!`. Test location: `16.17000000, 81.12999700` (Ongole). With a clean seed, a
10 km AC search returns two approved providers.

## I. Administrator login and creation

### URLs

- Admin login: **<http://localhost:3000/admin/login>**
- Admin dashboard: **<http://localhost:3000/admin/dashboard>**

`/admin` intentionally shows the admin sign-in page; it is not the dashboard.

### Create the first administrator

The supported explicit command is:

```powershell
cd server
npm run create-admin -- --email admin@example.com --password "YOUR_STRONG_PASSWORD"
```

- Replace `admin@example.com` with the real administrator email.
- Use a unique password of at least **12 characters**.
- The password is hashed with bcrypt before storage and is never printed by the script.
- Do not commit or share the password.
- Use `--rotate-password` to change an existing admin's password.
- Use `--promote` only when deliberately promoting an existing customer/provider account.
- Use `--if-none` to make the command a no-op when any administrator already exists.

### Optional first-run environment bootstrap

Setting **both** `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first API start creates one
administrator only when **no administrator exists**. It never overwrites an existing admin
and never promotes an existing customer/provider. The password must be at least 12
characters. Prefer `npm run create-admin` for explicit control.

### Important separation

Admin accounts are **not** created through public registration. There is no public admin
signup. Admin credentials are separate from customer/provider accounts, and admin access is
authorized by a database role check on every admin request, not merely by a JWT claim.
Sign in through `/admin/login`; customer/provider credentials are rejected there.

## J. Admin dashboard features

- **Overview** — live user, provider, service, booking, review, and complaint counts.
- **Providers** — search/filter by status, view details, approve, reject, suspend, request
  information, or reactivate. Pending applications are listed first.
- **Users** — search customers/providers/admins, inspect accounts, activate or suspend with
  a reason.
- **Services** — create, edit, and safely deactivate service categories.
- **Bookings** — search by ID/email, filter by status, open details, change status with a
  reason where required, and inspect status history.
- **Reviews** — inspect and hide/restore reviews with moderation audit records.
- **Complaints** — read contact-form messages and mark them resolved/reopened.
- **Wallet requests** — approve or reject deposit/withdrawal requests.
- **Audit logs** — inspect administrator actions, target, reason, and metadata.
- **Settings** — default/maximum search radius, provider approval policy, and feature flags.

### Approve a provider

1. Sign in at `/admin/login`.
2. Open **Providers**.
3. Select a pending provider with **View**.
4. Confirm it has real coordinates, a coverage radius, and at least one active service.
5. Click **Approve**.
6. Verify the status becomes `approved`; the provider can then appear in discovery when the
   service and radius match.

## K. Customer and provider workflows

### Customer

1. Open <http://localhost:3000> and choose **Register**.
2. Register as a customer, then enter the OTP from the email (or the development
   `dev_otp` fallback).
3. Log in and open the customer dashboard.
4. Set a location using browser location permission or manual latitude/longitude, and save
   it to the profile if desired.
5. Choose a service category and a radius (default options: 5/10/20/30 km, capped by admin
   settings).
6. Review nearby approved providers, sorted nearest first.
7. Open a provider profile and create a booking with a time, address, and description.
8. After the provider quotes a price, accept or reject it; use booking chat if needed.

### Provider

1. Register as a provider and verify the email OTP.
2. Log in and open the provider dashboard/profile.
3. Enter a display name, bio, real service coordinates, coverage radius, and at least one
   service category.
4. Save the profile. New providers are `pending` (unless the platform policy is `auto`).
5. Wait for an administrator to approve the account.
6. Once approved, bookings become available; quote, reject, or complete them from the
   dashboard.
7. Track earnings and request withdrawals from the wallet area.

## L. Nearby service discovery

Discovery only returns providers that are all of the following:

- The provider account is active.
- `providers.verification_status = 'approved'`.
- Coordinates are present and not `(0,0)`.
- The selected service is active and offered by the provider.
- When the customer supplies a location, distance is within the customer's search radius
  **and** the provider's own coverage radius.
- Results are deduplicated and ordered nearest first.

Pending, rejected, and suspended providers are not public. A provider with no location or
`(0,0)` is also excluded. If the customer does not provide a location, approved providers
are listed without a distance filter; the UI tells the user that location was not used.

The customer can grant browser location permission, enter coordinates manually, or use a
saved profile location. Denied permission is handled by offering manual entry. `(0,0)` is
never treated as a real location.

## M. Email setup and OTP

### Gmail SMTP (real delivery)

1. Enable 2-Step Verification on the Google account.
2. Create a Google **App Password** for Mail.
3. Set the following in `server\.env` (local) or the root `.env` (Docker):

   ```dotenv
   EMAIL_SERVICE=gmail
   EMAIL_USER=your-address@gmail.com
   EMAIL_PASS=<16-character-google-app-password>
   EMAIL_SENDER_NAME=Service Connect
   ```

4. Restart/recreate the API container or local server.
5. Register a test account and confirm the message arrives in the inbox.

### Development fallback

If SMTP is not configured, or sending fails, and `NODE_ENV` is not `production`, responses
from registration and forgot-password include `dev_otp`. This keeps local development
usable without email. The fallback is disabled in production.

**Current status:** real Gmail delivery is **not verified** in this environment because
`EMAIL_USER` and `EMAIL_PASS` are empty. Do not claim email delivery works until a message is
accepted by SMTP and received. OTP generation, rejection, reset, and expiry were verified via
the development fallback.

There is currently no dedicated resend cooldown beyond the general rate limiter; an
immediate second forgot-password request returns `200`.

## N. Testing

### Backend

Unit tests:

```powershell
cd server
npm test
```

Database integration tests require an isolated database. Create it once:

```powershell
docker compose exec db createdb -U service_connect service_connect_test
```

Run with the test database (replace the password):

```powershell
cd server
$env:TEST_DATABASE_URL="postgres://service_connect:YOUR_PASSWORD@localhost:5433/service_connect_test"
npm test
```

Integration suites apply schema/migrations idempotently, create only `it-*@example.test`
rows, and remove them afterward. Never point `TEST_DATABASE_URL` at the development
database. Expected baseline: **71 tests, 71 passed, 0 failed, 0 skipped**.

### Frontend

```powershell
cd frontend
$env:CI="true"
npm run test:ci
npm run build
```

Expected baseline: **4/4 tests passed** and a successful production build.

### Docker and health

```powershell
docker compose config -q
docker compose ps
docker compose logs --tail=200
```

See `docs/TESTING_REPORT.md` and `docs/FINAL_RUNTIME_VERIFICATION_REPORT.md` for recorded
results and limitations.

## O. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `Cannot connect to the Docker daemon` | Start Docker Desktop and wait for `docker info` to succeed |
| `POSTGRES_PASSWORD`/`JWT_SECRET` required | Copy `.env.example` to `.env` and set both |
| `ECONNREFUSED` / `database connection failed` | DB not running or wrong host/port. Docker API uses `db:5432`; host tools use `localhost:5433`; local PostgreSQL commonly uses `5432` |
| Migration failure | Read the `[migrate]` error. Do not edit `schema_migrations` manually; fix the failing migration and rerun |
| `port is already allocated` | Change `FRONTEND_PORT`, `BACKEND_PORT`, or `DB_PORT` in `.env`; update public/CORS/API URLs if the API port changes |
| Backend exits on startup | Check `JWT_SECRET`; inspect `docker compose logs backend` |
| Frontend cannot reach API | `REACT_APP_API_BASE_URL` must be browser-reachable; rebuild the frontend after changing it |
| CORS error | Add the exact browser origin to `CORS_ORIGIN` and restart the API |
| No nearby providers | Confirm provider is approved, account active, service offered, coordinates not `(0,0)`, and both customer radius and provider coverage cover the distance |
| Provider pending approval | An administrator must approve it under **Providers**; email verification alone does not approve |
| Gmail authentication failure | Use a Google App Password, not the normal password; verify 2-Step Verification and `EMAIL_USER`/`EMAIL_PASS` |
| OTP not received | Check SMTP configuration and spam; in development use `dev_otp`. Do not assume delivery without checking the inbox |
| Admin login rejected | Account must have `role='admin'`, status `active`, and a valid password; use `npm run create-admin` with `--rotate-password` if needed |
| Admin URL shows sign-in | `/admin` is the sign-in page; the dashboard is `/admin/dashboard` |
| Styles missing offline | Tailwind is loaded from a CDN; network access is required unless you compile Tailwind locally |

## P. Documentation index

- `docs/ADMIN_API.md` — administrator endpoints, payloads, and statuses.
- `docs/ADMIN_ARCHITECTURE.md` — admin authentication, RBAC, audit, and settings design.
- `docs/ADMIN_USER_GUIDE.md` — day-to-day administrator tasks.
- `docs/DATABASE_SCHEMA.md` — tables, relationships, migrations, indexes, and deletion rules.
- `docs/SERVICE_DISCOVERY_AUDIT.md` — discovery root causes, fixes, and behavior.
- `docs/GEOLOCATION_ARCHITECTURE.md` — coordinate rules, distance, radius, and privacy.
- `docs/PROVIDER_ONBOARDING.md` — provider lifecycle and discoverability.
- `docs/TESTING_REPORT.md` — test coverage, results, and limitations.
- `docs/FINAL_RUNTIME_VERIFICATION_REPORT.md` — Docker/API/browser/OTP verification evidence.
- `docs/PROJECT_AUDIT.md` — original audit findings.
- `docs/FINAL_AUDIT_REPORT.md` — final audit summary.
- `docs/RELEASE_CHECKLIST.md` — release gate with PASS/FAIL/BLOCKED status.

## Security notes

- `.env` files are ignored. Only `.env.example` placeholders belong in Git.
- Runtime uploads, `node_modules`, and legacy database dumps are ignored and are not part
  of the current tree. A legacy dump should never be committed because it can contain
  password hashes and personal data.
- **Historical exposure:** an earlier `server/.env` was committed in Git history with a
  non-empty Gmail App Password, JWT secret, and database password (for example commit
  `37b15cb`). Those values must be treated as compromised. Rotate the Gmail App Password,
  JWT secret, and database password if any of them were ever used outside local testing.
  History was intentionally not rewritten during this release.
- Passwords are bcrypt-hashed; JWTs expire after one hour and are sent in `x-auth-token`.
- Admin protection is enforced by a database-backed role/status check on every admin API
  request. Frontend route guards are convenience only.
- Use `NODE_ENV=production` in real deployments so `dev_otp` is never returned. Configure
  `JWT_SECRET`, `POSTGRES_PASSWORD`, and SMTP credentials through environment/secret
  management, not source control.

## License

No license file is included in this repository. Confirm licensing with the repository owner
before redistribution.
