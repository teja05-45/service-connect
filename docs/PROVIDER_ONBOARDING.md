# Provider Onboarding — Service Connect

## 1. Journey

1. **Register** — `POST /auth/register` with `role: "provider"`. The account is created with
   `users.status = 'pending_verification'`.
2. **Verify email** — `POST /auth/verify-otp`. The account becomes `active` and
   `email_verified_at` is set. A provider row is created with **no coordinates** and
   `verification_status = 'pending'`.
3. **Complete the business profile** — provider dashboard or onboarding form:
   display name, bio, **service coordinates**, service radius, service categories, payout
   details. Submitting this calls `POST /provider/profile`.
4. **Application review** — the application is visible to admins at `pending` (or
   `under_review` after an information request).
5. **Admin decision** — approve, reject (reason required), suspend (reason required), or
   request more information. Every decision is audited.
6. **Discoverability** — only `approved` providers with an active account, usable
   coordinates and at least one active service appear in customer search.
7. **Manage** — the provider can edit profile/location/services, manage bookings, chat,
   earnings and withdrawals.

Email verification and provider approval are **separate**. Verifying an email never grants
approval.

## 2. Status lifecycle

| Status | Meaning | Discoverable | Set by |
|---|---|---|---|
| `pending` | New application, not reviewed | No | registration / profile submit |
| `under_review` | Admin requested more information | No | admin `request-info` |
| `approved` | Verified provider | **Yes** | admin `approve` (or auto policy) |
| `rejected` | Application declined (reason stored) | No | admin `reject` |
| `suspended` | Previously active, now disabled (reason stored) | No | admin `suspend` |

`is_verified` is a compatibility mirror of `status = 'approved'`. A trigger keeps both
fields consistent even for older clients that only send `is_verified`.

Rejected/suspended providers can resubmit their profile, but the status is **not**
silently reset to approved. An admin must reactivate them.

## 3. Required profile data for discovery

- `display_name` (2–100 characters)
- `bio`
- `location_lat` in [-90, 90] and `location_lon` in [-180, 180], not `(0,0)`
- `service_radius_km` 1–100
- at least one **active** service category

Server-side validation rejects invalid coordinates, `(0,0)`, unknown/inactive service IDs,
and missing services.

## 4. Approval policy

`platform_settings.provider_approval_policy`:

- `manual` (default) — admin must approve.
- `auto` — a provider who submits a complete profile with coordinates and services is
  approved automatically. Rejected/suspended providers are never auto-approved.

The admin UI changes this setting under **Settings**.

## 5. Location and privacy

- The provider enters a **service base location** and a coverage radius. The exact address
  is not displayed in search results; only distance is shown to the customer.
- The provider's coordinates are stored in `providers.location_lat/lon` and used for the
  bounding-box/distance query.
- Coordinates must be edited deliberately; there is no hardcoded default city.

## 6. Admin review checklist (suggested)

1. Display name and bio are plausible.
2. At least one service category matches the business.
3. Service location is inside the intended operating area.
4. Radius is sensible (1–100 km).
5. Payout details are present.
6. No duplicate provider account for the same person/business.

Rejection/suspension always records a reason in `admin_audit_logs` and on the provider row.

## 7. Provider self-service endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/provider/profile` | Profile, status, coordinates, services |
| POST | `/provider/profile` | Create/update profile, location, radius and services |
| GET | `/provider/bookings` | Incoming and historical bookings |
| GET | `/provider/earnings` | Wallet balance, rating, completed jobs |
| POST | `/provider/wallet/withdraw-request` | Request a payout (admin approved) |
