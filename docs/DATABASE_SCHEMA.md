# Database Schema — Service Connect

PostgreSQL 14+ (verified design targets PostgreSQL 18). Plain SQL, no ORM, no PostGIS.
The base schema (`server/db/schema.sql`) is idempotent; incremental changes live in
`server/db/migrations/` and are tracked in `schema_migrations`.

Apply everything with:

```bash
cd server
npm run migrate
```

`migrate.js` runs the base schema, then each pending migration in filename order inside a
transaction, then the service catalogue seed (unless `SEED=false`). It never drops data.

---

## 1. Existing tables

| Table | Purpose |
|---|---|
| `users` | Accounts: `customer`, `provider`, `admin`; status, OTP fields |
| `customer_profiles` | 1:1 customer details + preferred location |
| `providers` | 1:1 provider business profile, location, radius, verification |
| `services` | Service catalogue |
| `provider_services` | Many-to-many provider ↔ service (optional hourly rate) |
| `bookings` | Customer ↔ provider ↔ service, status workflow |
| `messages` | Per-booking chat |
| `payments` | One payment per booking (wallet capture) |
| `reviews` | One review per booking; drives provider rating |
| `wallets`, `transactions`, `wallet_requests` | Money flow |
| `contact_messages` | Public contact form (admin "complaints") |
| `otps`, `password_resets`, `deposit_requests`, `withdrawal_requests` | Legacy, retained |

## 2. Migration 001 — provider verification & admin

File: `server/db/migrations/001_provider_verification_and_admin.sql`

### users
- `email_verified_at timestamptz` — set on OTP verification.
- `status_reason text` — why an account was suspended/deactivated.
- `status` values now documented as `active`, `pending_verification`, `suspended`,
  `deactivated` (no CHECK constraint existed).

### services
- `slug varchar(120)` — stable public identifier; backfilled from the name; unique index.
- `is_active boolean NOT NULL DEFAULT true` — soft deactivation.
- Indexes: unique `idx_services_slug`, `idx_services_active`.

### providers
- `verification_status varchar(20) NOT NULL DEFAULT 'pending'`
  (`pending`, `under_review`, `approved`, `rejected`, `suspended`), CHECK constraint.
- `verification_notes`, `rejection_reason`, `suspended_reason`, `verified_at`,
  `verified_by`.
- Backfill: `is_verified = true` → `approved`; then `is_verified` is recomputed from
  `verification_status`.
- Trigger `trg_sync_provider_verification` keeps `is_verified` and
  `verification_status` consistent for legacy clients.
- Indexes: `idx_providers_verification_status`, `idx_providers_location`.

### reviews
- `is_hidden boolean NOT NULL DEFAULT false`, `moderation_reason`, `moderated_by`,
  `moderated_at`.
- Index `idx_reviews_provider_visibility (provider_id, is_hidden)`.
- Provider rating aggregates must exclude hidden reviews (implemented in payment and
  moderation queries).

### admin_audit_logs (new)
```
id bigint identity PK
admin_id integer NOT NULL → users(id)
action varchar(100) NOT NULL
target_type varchar(50)
target_id varchar(64)
reason text
metadata jsonb NOT NULL DEFAULT '{}'
created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
```
Indexes on `created_at DESC` and `(admin_id, created_at DESC)`. Append-only from the API.

### platform_settings (new)
```
key varchar(100) PK
value text NOT NULL
updated_by integer
updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
```
Seeded defaults: `default_search_radius_km=10`, `max_search_radius_km=50`,
`provider_approval_policy=manual`, `booking_allow_new_bookings=true`,
`notifications_email_enabled=true`, `service_availability_enabled=true`.

### booking_status_history (new)
```
id bigint identity PK
booking_id integer NOT NULL → bookings(id) ON DELETE CASCADE
status varchar(50) NOT NULL
changed_by integer → users(id)
changed_by_role varchar(20)
note text
created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
```
Index on `(booking_id, created_at)`. Written for customer, provider and admin changes.

### Additional indexes
- `idx_users_role_status (role, status)`
- `idx_bookings_status_created (booking_status, created_at DESC)`

## 3. Relationships

```
users 1 ── 1 customer_profiles
users 1 ── 1 providers
providers N ── N services  (provider_services)
users(customer) 1 ── N bookings ── 1 providers ── 1 users(provider)
bookings 1 ── 1 payments
bookings 1 ── 1 reviews
bookings 1 ── N messages
bookings 1 ── N booking_status_history
users 1 ── N admin_audit_logs (admin_id)
users 1 ── 1 wallets
```

## 4. Status values

| Field | Values |
|---|---|
| `users.role` | `customer`, `provider`, `admin` (CHECK) |
| `users.status` | `pending_verification`, `active`, `suspended`, `deactivated` |
| `providers.verification_status` | `pending`, `under_review`, `approved`, `rejected`, `suspended` (CHECK) |
| `bookings.booking_status` | `pending_provider`, `awaiting_customer_confirmation`, `accepted`, `rejected`, `completed`, `closed` (CHECK) |
| `wallet_requests.status` | `pending`, `approved`, `rejected` (CHECK) |
| `payments.status` | `pending`, `succeeded`, `failed` (CHECK) |
| `reviews.rating` | 1–5 (CHECK) |

## 5. Deletion and data safety

- The migration only adds columns/tables/indexes. It does not drop or rewrite business data.
- `DELETE /admin/services/:id` performs a **soft deactivation** (`is_active = false`) because
  bookings reference service categories. No cascading delete of history.
- Provider services cascade only when a provider row itself is deleted; the admin UI does not
  delete providers.
- Reviews are hidden, never deleted by moderation.
- `booking_status_history` cascades only when a booking is deleted (no admin endpoint does
  that).
- Never run `docker compose down -v` against a database whose data you need.

## 6. Geospatial indexes

`idx_providers_location (location_lat, location_lon)` supports the bounding-box prefilter
used before the Haversine comparison. A composite B-tree helps range predicates on both
coordinates; it is not a true spatial index. If provider volume grows substantially,
introduce PostGIS (`GEOGRAPHY(Point,4326)` + GiST) as a separate migration after checking
image availability and data migration cost.

## 7. Inspecting the schema

```bash
docker compose exec db psql -U service_connect -d service_connect -c "\d providers"
docker compose exec db psql -U service_connect -d service_connect -c "SELECT * FROM schema_migrations;"
```

```sql
-- provider status distribution
SELECT verification_status, COUNT(*) FROM providers GROUP BY 1 ORDER BY 2 DESC;

-- providers with unusable locations (not discoverable)
SELECT id, display_name, location_lat, location_lon
FROM providers
WHERE location_lat IS NULL OR location_lon IS NULL
   OR (location_lat = 0 AND location_lon = 0);

-- recent admin actions
SELECT created_at, admin_id, action, target_type, target_id, reason
FROM admin_audit_logs ORDER BY created_at DESC LIMIT 20;
```

## 8. Backup / restore

Unchanged from the README: use `pg_dump -F c` and `pg_restore --no-owner --no-privileges`.
Back up before applying migrations in any environment with real data.
