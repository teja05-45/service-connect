# Administrator API — Service Connect

Base URL: `http://localhost:3001/api/v1`
Authentication: `x-auth-token: <JWT from POST /admin/login>`
Every endpoint below requires an active administrator account (token role `admin` **and**
database role `admin`). List endpoints are paginated.

Standard list response:

```json
{
  "data": [ ... ],
  "pagination": { "page": 1, "limit": 20, "total": 42, "total_pages": 3,
                  "has_next": true, "has_previous": false }
}
```

Error format: `{ "error": "human readable message" }`.
Status codes: `400` validation, `401` unauthenticated/bad credentials, `403` wrong role,
`404` missing resource, `409` duplicate, `429` rate limited, `500` unexpected.

---

## Authentication

### `POST /admin/login`
Body: `{ "email": "...", "password": "..." }`
Rate limited (10 per 15 minutes per IP+email). Returns:

```json
{ "message": "Administrator login successful.",
  "token": "...", "role": "admin",
  "user": { "id": 1, "email": "admin@example.com", "role": "admin" } }
```

`401` for unknown email, wrong password, or a non-admin account; `403` if the admin account
is not active.

### `GET /admin/me`
Returns `{ admin: { id, email, role, status, created_at, profile_picture_url } }`.

### `POST /admin/logout`
Stateless; records `admin.logout` and tells the client to discard the token.

---

## Dashboard

### `GET /admin/dashboard/stats`
```json
{
  "generated_at": "...",
  "users": { "total_users": 10, "total_customers": 6, "total_providers": 3,
             "total_admins": 1, "active_users": 9, "suspended_users": 1,
             "email_verified_users": 8 },
  "providers": { "total_providers": 3, "approved_providers": 2, "pending_providers": 1,
                 "under_review_providers": 0, "rejected_providers": 0,
                 "suspended_providers": 0 },
  "services": { "total_services": 12, "active_services": 12 },
  "bookings": { "total_bookings": 5, "pending_bookings": 1,
                "awaiting_confirmation_bookings": 1, "accepted_bookings": 1,
                "completed_bookings": 1, "closed_bookings": 1,
                "cancelled_bookings": 0 },
  "reviews": { "total_reviews": 2, "hidden_reviews": 0 },
  "complaints": { "total_complaints": 1, "unresolved_complaints": 1 },
  "recent_registrations": [ ... ],
  "recent_bookings": [ ... ],
  "recent_admin_activity": [ ... ]
}
```

### `GET /admin/dashboard/recent-activity`
Paginated audit entries (same shape as `/admin/audit-logs`, default limit 15).

---

## Users

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/users?page=&limit=&role=&status=&q=` | `role` customer/provider/admin; `status` active/suspended/deactivated; `q` email or name |
| GET | `/admin/users/:id` | User + customer/provider profile + booking stats + recent bookings |
| PATCH | `/admin/users/:id/status` | Body `{ "status": "active\|suspended\|deactivated", "reason": "..." }` |

Rules: reason required for non-active statuses; cannot change your own status; administrator
accounts cannot be suspended through this endpoint. Password hashes and OTPs are never
returned.

---

## Providers

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/providers?page=&limit=&status=&service_id=&q=` | Pending/under-review first |
| GET | `/admin/providers/:id` | Profile, services, recent reviews, booking stats (payout details excluded) |
| PATCH | `/admin/providers/:id/approve` | No body required |
| PATCH | `/admin/providers/:id/reject` | `{ "reason": "..." }` required |
| PATCH | `/admin/providers/:id/suspend` | `{ "reason": "..." }` required |
| PATCH | `/admin/providers/:id/request-info` | `{ "reason": "..." }` required → `under_review` |
| PATCH | `/admin/providers/:id/reactivate` | → `approved` |
| PUT | `/admin/providers/:id/verify` | Legacy `{ "is_verified": true }`; mapped to approve/pending |

All actions write an audit row with previous/new status and reason.

---

## Services

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/services?page=&limit=&q=&include_inactive=` | Includes provider/booking counts |
| POST | `/admin/services` | `{ name, description?, slug?, icon_url?, is_active? }` |
| PATCH | `/admin/services/%3Aid` | Partial update of the same fields |
| DELETE | `/admin/services/:id` | **Soft deactivate** — never deletes referenced data |

`409` on duplicate name/slug. Deactivation removes the category from public search while
preserving bookings, provider links and reviews.

---

## Bookings

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/bookings?page=&limit=&status=&service_id=&customer_id=&provider_id=&from=&to=&q=` | `q` = booking id or email |
| GET | `/admin/bookings/:id` | Booking, payment, review, message count, status history |
| PATCH | `/admin/bookings/:id/status` | `{ "status": "...", "reason": "..." }` |

Valid statuses: `pending_provider`, `awaiting_customer_confirmation`, `accepted`,
`rejected`, `completed`, `closed`. Reason required for `rejected` and `closed`. Every change
is added to `booking_status_history` and the audit log.

---

## Reviews & complaints

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/reviews?page=&limit=&provider_id=&rating=&hidden=` | |
| PATCH | `/admin/reviews/:id/moderate` | `{ "action": "hide"\|"unhide", "reason": "..." }` — reason required to hide |
| GET | `/admin/complaints?page=&limit=&resolved=` | Contact-form messages |
| PATCH | `/admin/complaints/:id/resolve` | `{ "resolved": true\|false, "note": "..." }` |

Hiding/restoring a review recalculates `providers.average_rating` and `review_count` from
visible reviews only.

---

## Audit logs

`GET /admin/audit-logs?page=&limit=&admin_id=&action=&target_type=`

```json
{ "data": [ { "id": 1, "admin_id": 1, "admin_email": "...", "action": "provider.approve",
              "target_type": "provider", "target_id": "7", "reason": null,
              "metadata": { "previous_status": "pending", "new_status": "approved" },
              "created_at": "..." } ],
  "pagination": { ... } }
```

---

## Settings

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/settings` | `{ settings, definitions }` |
| PATCH | `/admin/settings` | `{ "settings": { "default_search_radius_km": 15 } }` |

Unknown keys are rejected (`400`). Values are validated against type and bounds. Secrets are
never part of this API.

---

## Legacy endpoints (kept for compatibility)

| Method | Path |
|---|---|
| GET | `/admin/overview-metrics` |
| GET | `/admin/contact-messages` |
| GET | `/admin/wallet-requests` |
| PUT | `/admin/wallet-requests/:id/approve` |
| PUT | `/admin/wallet-requests/:id/reject` (`{ reason }`) |

Wallet approvals now also write audit rows.

---

## Example

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your-password"}' | \
  node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl -s http://localhost:3001/api/v1/admin/dashboard/stats -H "x-auth-token: $TOKEN"

curl -s -X PATCH http://localhost:3001/api/v1/admin/providers/7/approve \
  -H "x-auth-token: $TOKEN" -H "Content-Type: application/json" -d '{}'
```
