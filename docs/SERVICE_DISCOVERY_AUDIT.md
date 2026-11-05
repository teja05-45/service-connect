# Service Discovery Audit — Service Connect

Date: 2026-11-05
Scope: provider discovery (`GET /api/v1/providers`), customer/provider location,
provider verification, provider↔service matching, frontend rendering, and the new
administrator console.

Method: source inspection of the actual repository, SQL review, and execution of the
backend unit suite. A live PostgreSQL instance and Docker daemon were **not available in
the working environment**, so database-backed checks are provided as a gated integration
suite and must be run against a disposable database (see `docs/TESTING_REPORT.md`).

---

## 1. Existing architecture (before this change)

```
React SPA (state router)
  fetch → Express 5 API (/api/v1)
            ├── publicRoutes   GET /services, GET /providers, POST /contact-us
            ├── authRoutes     register / verify-otp / login / password reset
            ├── userRoutes     profile, wallet, unread messages
            ├── bookingRoutes  bookings, price confirmation, chat
            ├── customerRoutes customer bookings + deposit requests
            ├── providerRoutes provider profile, bookings, earnings, withdrawals
            ├── paymentRoutes  wallet payment + reviews
            └── adminRoutes    metrics, wallet approvals, provider verify, lists
  PostgreSQL 18 (plain SQL, idempotent schema, no ORM, no PostGIS)
```

Key data model:

- `users(role, status)` — `customer` / `provider` / `admin`.
- `providers(user_id, location_lat, location_lon, service_radius_km, is_verified,
  average_rating, review_count)`.
- `customer_profiles(user_id, location_lat, location_lon, address, city)`.
- `services(id, name)` + `provider_services(provider_id, service_id)` many-to-many.
- `bookings`, `messages`, `payments`, `reviews`, `wallets`, `wallet_requests`.
- No provider verification lifecycle beyond the boolean `is_verified`.
- No platform settings, no admin audit log, no booking status history.

## 2. Reported symptom

Customer logged in, opened **AC/Refrigerator Repair**, and saw:

> "No verified providers found for this service near your location."

while the page printed the customer coordinates `16.17000000, 81.12999700` and providers
with nearby locations existed in the database.

## 3. Data flow trace

1. `ServiceProvidersPage` read `user.profile.location_lat/lon` via
   `getProfileField(user, field, null)`.
2. It issued `GET /providers?service_id=<id>&lat=<lat>&lon=<lon>`.
3. `publicRoutes` selected providers with `WHERE p.is_verified = TRUE`, joined
   `provider_services`, and calculated Haversine distance **in JavaScript**.
4. It filtered with `provider.distance_km <= provider.service_radius_km` and finally
   sorted by distance.
5. The frontend rendered the empty state whenever the array was empty, without
   distinguishing a real empty result from a filtering bug or an API error.

## 4. Root causes (all confirmed in the code)

| # | Root cause | Affected file | Effect |
|---|---|---|---|
| 1 | **`is_verified` was never set during onboarding.** New providers were created with the default `FALSE`; admin approval was the only way to flip it. | `authRoutes.js` (verify-otp), `providerRoutes.js`, `adminRoutes.js` | Every newly registered provider was invisible even with perfect data. |
| 2 | **Missing provider coverage radius excluded providers.** `service_radius_km` is nullable. `distance <= NULL` is `NULL`, which is not true, so legacy/partial rows were filtered out. | `publicRoutes.js` | Null radius silently hides providers. |
| 3 | **`(0, 0)` was treated as a real location.** Provider rows created by the old flow stored `0,0`; the customer profile default was also `0,0`. Distance from Ongole to `(0,0)` is ~10,000 km, so the radius filter removed everything. The frontend text even claimed "Using mock location (0, 0)". | `authRoutes.js`, `ServicePages.js` | Fake coordinates used as real search positions. |
| 4 | **Customer coordinates could be replaced by defaults.** `getProfileField` used `||`, so a stored `0` became the fallback; the page then searched from `0,0`. | `pages/utils/helpers.js` | Real saved locations could be ignored. |
| 5 | **The query returned one row per provider-service pair.** `GROUP BY p.id, s.name, s.id` with a `LEFT JOIN` replicated providers that offered several services. | `publicRoutes.js` | Duplicate cards; unstable distance ordering. |
| 6 | **Ordering was rating-first, distance-second** (JS sort only when location given). | `publicRoutes.js` | Results were not "nearest first" as the UI implied. |
| 7 | **Radius was not configurable** (hardcoded per provider, no customer search radius). | `publicRoutes.js`, `ServicePages.js` | A customer 12 km away could never see a provider with a 10 km coverage, even if willing to travel. |
| 8 | **No coordinate validation.** `parseFloat(lat || 0)` accepted `NaN`, reversed values, out-of-range values, or one coordinate without the other. | `publicRoutes.js` | Silent nonsense results. |
| 9 | **No distinction between error and empty state.** | `ServicePages.js` | A 500 or schema error looked exactly like "no providers found". |
| 10 | **Admin approval and provider lifecycle were a single boolean**, with no rejection/suspension reason or audit trail. | `adminRoutes.js`, schema | No accountability; suspended/rejected states were indistinguishable from pending. |

## 5. Fix implemented

### 5.1 Canonical verification lifecycle

`providers.verification_status ∈ {pending, under_review, approved, rejected, suspended}`
plus reasons (`rejection_reason`, `suspended_reason`, `verification_notes`), `verified_at`,
`verified_by`. `is_verified` is retained as a compatibility mirror and is kept in sync by a
database trigger (`sync_provider_verification_status`).

Public discovery now requires **all** of:

1. `verification_status = 'approved'` **and** `is_verified = TRUE`
2. provider's `users.status = 'active'`
3. usable coordinates (`NOT NULL` and not `0,0`)
4. the requested service through `provider_services`, with the service `is_active`
5. when the customer supplied a location:
   `distance ≤ search radius` **and** `distance ≤ provider coverage`.
   A missing provider coverage falls back to the search radius (documented default), so a
   NULL column no longer hides an otherwise valid provider.

### 5.2 Distance in SQL, nearest first

Haversine (Earth radius **6371.0088 km**) is computed in PostgreSQL, together with a
bounding-box prefilter so the `(location_lat, location_lon)` index can be used. Results are
ordered by distance when a location is supplied, then rating. No PostGIS dependency.

### 5.3 One row per provider

The requested service is resolved through a `LEFT JOIN LATERAL` (one matching active
service per provider), and all services are aggregated into a `services` array. This
removes duplicate rows and is covered by an integration test.

### 5.4 Validated, configurable location

- `parseCoordinates` rejects non-numeric, out-of-range and half-supplied pairs (400).
- `(0,0)` is treated as "location not set" and never used as a real search position.
- `radius` query parameter is clamped to `1…max_radius_km` (platform setting, default max 50).
- Default radius is 10 km (platform setting), offered as 5/10/20/30 km in the UI.
- Without a location, approved providers for the category are listed **unfiltered**, and the
  UI says so instead of pretending a location exists.

### 5.5 Frontend

`ServiceProvidersPage` now provides: saved profile location, browser geolocation (with the
native permission prompt), manual latitude/longitude entry, radius selector, "save to
profile", clear location, explicit loading/error/empty states, a retry action, and a
distance label on every provider card. `ErrorState` renders API failures separately from a
genuine "no matches" result.

### 5.6 Admin control

Provider applications start at `pending`; admin can approve, reject (reason required),
suspend (reason required), request information, or reactivate. Every action is authorized
on the backend and written to `admin_audit_logs`.

## 6. Database changes

See `docs/DATABASE_SCHEMA.md`. New migration:
`server/db/migrations/001_provider_verification_and_admin.sql` (idempotent, tracked in
`schema_migrations` by `npm run migrate`).

## 7. Verification performed here

- Backend unit suite: **37 passed, 0 failed, 15 skipped** (the 15 are DB integration tests).
- `node --check` on every server file: passed.
- JSX parse of all changed frontend files: passed.
- Docker daemon and PostgreSQL were unavailable, so container startup and live SQL were
  not executed in this environment. The gated integration suites are ready to run; see
  `docs/TESTING_REPORT.md` for exact commands and the remaining manual checklist.

## 8. Recommended next steps

1. Run `npm run migrate` against the real database, then `npm run seed:dev` (development
   only) and confirm the expected nearby providers appear at the test location.
2. Approve existing legitimate providers in the admin console (the migration maps
   `is_verified = true` to `approved`; unverified rows deliberately stay `pending`).
3. Run the integration suites against a disposable database.
4. Only then consider PostGIS + `GEOGRAPHY` indexes if provider volume makes the bounding
   box query insufficient.
