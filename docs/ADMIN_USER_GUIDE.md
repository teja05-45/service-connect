# Administrator User Guide — Service Connect

## 1. Signing in

1. Start the application (see README).
2. Open **http://localhost:3000/admin/login** (or `/admin/login` on your deployed host).
3. Enter the administrator email and password.

Notes:

- This page is separate from the customer/provider login. Customer or provider accounts
  are rejected here, even with the correct password.
- Repeated failures are rate limited (10 attempts per 15 minutes per IP + email).
- After sign-in you land on `/admin/dashboard`. The session expires after 2 hours; sign in
  again when prompted.

To sign out, use **Sign out** in the top bar (top-right on mobile).

## 2. Overview

The overview shows live database counts:

- users: total, customers, providers
- providers: approved, pending, under review, rejected, suspended
- services: total and active
- bookings: total, pending, completed, cancelled
- reviews and open complaints
- recent registrations, recent bookings, recent admin activity

If a number looks stale, reload the page. Nothing on this page is hardcoded.

## 3. Reviewing provider applications

1. Open **Providers**.
2. Pending and under-review applications are listed first.
3. Use the status filter or search by name/email.
4. Click a provider name to open the detail view: services, rating, reviews, coordinates,
   service radius, booking stats and any prior reasons.
5. Choose an action:
   - **Approve** — makes the provider discoverable (if the account is active, coordinates
     are valid and at least one active service is selected).
   - **Reject** — requires a reason. The provider is not discoverable.
   - **Suspend** — requires a reason. Use for an approved provider that must be disabled.
   - **Request info** — requires a reason; moves the application to `under_review`.
   - **Reactivate** — returns a rejected/suspended provider to `approved`.

Every decision is recorded in **Audit logs** with your admin id, reason and timestamp.

## 4. Managing users

Open **Users**. You can:

- search by email or name,
- filter by role and account status,
- see whether the email was verified,
- change status with the dropdown: activate, suspend, deactivate.

A reason is required for suspension/deactivation. You cannot change your own status, and
administrator accounts are protected from this screen.

## 5. Managing service categories

Open **Services**.

- Create a category with name, optional slug, description, icon URL and active flag.
- Edit any category.
- **Deactivate** hides it from customer search. Existing providers, bookings and reviews are
  kept; nothing is deleted, so historical bookings stay readable.

The slug is generated from the name when left blank. Duplicate names/slugs return an error.

## 6. Bookings

Open **Bookings**.

- Filter by status, search by booking id, customer email or provider email.
- **View** opens the booking detail: customer/provider, service, scheduled time, amount,
  payment status, message count and full status history.
- Status changes are available through the API; the UI is read-only for bookings in this
  version. Use `PATCH /admin/bookings/:id/status` (see `docs/ADMIN_API.md`) when a manual
  intervention is required. A reason is mandatory for `rejected` and `closed`.

## 7. Reviews and complaints

**Reviews** — filter visible/hidden, hide or restore a review. Hiding requires a reason and
immediately recalculates the provider's public rating from the remaining visible reviews.

**Complaints** — messages sent through the public Contact form. Mark resolved when handled;
reopen if the issue returns.

## 8. Wallet requests

**Wallet requests** lists pending customer deposits and provider withdrawals. Approving a
deposit credits the wallet; approving a withdrawal debits it and refuses to create a
negative balance. Rejecting records the decision. Both are audited.

## 9. Audit logs

**Audit logs** shows the newest administrative actions first. Filter by action text (for
example `provider`) to review approvals, rejections, suspensions, service changes, review
moderation and settings updates. Logs are append-only from the UI.

## 10. Platform settings

**Settings** edits operational, non-secret values:

- default search radius (km) — used when a customer does not choose one
- maximum search radius (km) — hard cap for customers
- provider approval policy — `manual` (default) or `auto`
- booking/notification/service availability flags

Secrets (JWT, database password, SMTP credentials) are never shown here.

## 11. Common tasks

**A provider complains they are not visible to customers.**
Check, in order: account status is active (Users), provider status is approved (Providers),
coordinates are set and not `(0,0)`, at least one active service is selected, the provider's
coverage radius covers the customer's distance, and the customer is searching within the
configured radius.

**A customer sees no providers nearby.**
Confirm their location is set (not `0,0`), try a larger radius, and check that approved
providers exist for that category. The page distinguishes an API failure from an empty
result; report the error text if one is shown.

**A review should be removed.**
Hide it with a reason. Ratings recalculate automatically. Do not delete bookings or reviews.

**An administrator left the company.**
Create or rotate credentials with `npm run create-admin` (server/) and suspend/deactivate the
old admin's `users` row through the database or a future admin-management endpoint. The
current UI intentionally does not allow admins to suspend other admins.
