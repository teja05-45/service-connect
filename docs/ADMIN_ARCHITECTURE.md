# Administrator Architecture — Service Connect

## 1. Goals

- Separate administrator entry point (`/admin/login`, `/admin/dashboard`).
- Backend-enforced authorization on every admin request.
- No hardcoded credentials, no public admin registration.
- Full audit trail for administrative changes.
- Real database data only — no hardcoded dashboard numbers.

## 2. Identity model

Administrators are ordinary rows in `users` with `role = 'admin'` and `status = 'active'`.
There is no separate admin table. Passwords are bcrypt hashes (cost 12 for bootstrap,
10 for normal registration).

`users_role_check` already allowed `'admin'`, so no destructive schema change was needed.

### Bootstrap

Two supported paths:

1. **Environment bootstrap (first run only)**
   `ADMIN_EMAIL` + `ADMIN_PASSWORD` in the backend environment.
   `ensureInitialAdmin()` runs at API start and:
   - no-ops when the variables are unset,
   - no-ops when **any** administrator already exists,
   - refuses to promote an existing customer/provider,
   - requires a password of at least 12 characters.
2. **CLI (explicit, recommended for credential rotation)**
   ```bash
   cd server
   npm run create-admin -- --email admin@example.com --password "a-long-secret"
   npm run create-admin -- --email admin@example.com --password "new-secret" --rotate-password
   ```
   `--promote` is required to deliberately convert an existing non-admin account.
   The CLI never prints the password.

There is **no** `POST /admin/register`. Registration rejects `role: "admin"`.

## 3. Authentication flow

```
POST /api/v1/admin/login  { email, password }
  → rate limited (10 attempts / 15 min per IP+email)
  → lookup by lower(email)
  → generic 401 for unknown email, wrong password, or non-admin role
  → 403 when the admin account is not active
  → bcrypt compare
  → JWT { user: { id, role: 'admin' } }, 2h expiry
  → audit row: admin.login
  → { token, role: 'admin', user }
```

The general `/auth/login` no longer escalates `ADMIN_EMAIL` at login. Removing that
behaviour closed a privilege-escalation path: previously, controlling the environment
variable was enough to make any account administrator.

## 4. Backend authorization

`server/src/middleware/adminAuth.js`:

1. `auth` verifies the JWT and attaches `req.user`.
2. `requireAdmin` checks the token role **and** re-queries the database:
   `SELECT id, role, status FROM users WHERE id = $1 AND role = 'admin'`.
3. Rejects if the row is missing (`403`), the role changed (`403`), or the account is not
   active (`403`). Database errors return `500`.

This defeats stale tokens and JWT role tampering (a forged token still needs a valid
signature; even then, the database role must be admin).

`adminRoutes` applies `router.use('/admin', auth, requireAdmin)` so new admin endpoints are
protected by default. Frontend route guards are convenience only.

## 5. Audit trail

Table `admin_audit_logs(admin_id, action, target_type, target_id, reason, metadata, created_at)`.

Written for:

- `admin.login`, `admin.logout`
- `provider.approve`, `provider.reject`, `provider.suspend`, `provider.request_info`,
  `provider.reactivate`, `provider.revoke`
- `user.status_change`
- `service.create`, `service.update`, `service.deactivate`
- `booking.status_change`
- `review.hide`, `review.unhide`
- `complaint.resolve`, `complaint.reopen`
- `wallet_request.approve`, `wallet_request.reject`
- `settings.update`

Mutations and their audit rows are written in the **same transaction**. There is no
update/delete endpoint for audit rows. Metadata is limited to non-sensitive fields (ids,
previous/new status, changed setting keys); passwords, OTPs and secrets are never stored.

## 6. Platform settings

`platform_settings(key, value, updated_by, updated_at)`. Only allow-listed keys can be
edited (validated server-side):

| Key | Type | Default |
|---|---|---|
| `default_search_radius_km` | int 1–100 | 10 |
| `max_search_radius_km` | int 1–200 | 50 |
| `provider_approval_policy` | `manual` / `auto` | `manual` |
| `booking_allow_new_bookings` | bool | `true` |
| `notifications_email_enabled` | bool | `true` |
| `service_availability_enabled` | bool | `true` |

Secrets (`JWT_SECRET`, SMTP credentials, database password) are environment-only and are
not exposed by any endpoint.

## 7. Frontend structure

```
/admin/login      AdminLoginPage (dark, separate from customer/provider login)
/admin/dashboard  AdminDashboard
  sidebar: Overview, Providers, Users, Services, Bookings, Reviews,
           Complaints, Wallet requests, Audit logs, Settings
  top bar: administrator email, View site, Sign out
```

Both URLs are served by the SPA (nginx `try_files … /index.html`); `App.js` maps them to
pages and updates `window.history`. The admin area renders without the customer header and
footer.

## 8. Implemented admin modules

- **Overview** — real counts for users/providers/services/bookings/reviews/complaints plus
  recent registrations, bookings and admin activity.
- **Providers** — filter by status, search by name/email, detail view (services, reviews,
  booking stats), approve/reject/suspend/request-info/reactivate, reasons required where
  applicable.
- **Users** — search, role/status filters, pagination, email-verification status,
  activate/suspend/deactivate with reason; admin accounts cannot be suspended here.
- **Services** — create, edit, deactivate (never deletes referenced rows).
- **Bookings** — filters/search, detail view with payment status, messages count and status
  history; status changes audit and record history.
- **Reviews** — visibility filter, hide/restore with reason; provider rating recalculated
  from visible reviews only.
- **Complaints** — contact-form messages, resolve/reopen.
- **Wallet requests** — existing deposit/withdrawal approval flow, now audited.
- **Audit logs** — paginated, filterable by action.
- **Settings** — validated, non-secret platform settings.

## 9. Known limitations

- JWT is stateless: "logout" discards the client token; there is no server-side revocation
  list. Admin tokens expire after 2 hours.
- The in-memory rate limiter is per process; use a shared store if scaling horizontally.
- There is no separate "reported reviews" feature in the existing product; moderation
  operates on all reviews. Complaints are the contact-form messages. No reporting workflow
  was invented.
- No admin file-upload UI for verification documents: the existing schema has no document
  table, so the detail view shows the provider profile and review history only. Adding a
  documents table + uploader is the natural next step.
