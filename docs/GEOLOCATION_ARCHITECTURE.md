# Geolocation Architecture — Service Connect

## 1. Coordinate rules

| Rule | Enforcement |
|---|---|
| Latitude is a finite number in **[-90, 90]** | `server/src/utils/geo.js`, mirrored in `frontend/src/pages/utils/helpers.js` |
| Longitude is a finite number in **[-180, 180]** | same |
| Latitude and longitude are supplied together | `parseCoordinates` / `PUT /user/profile` / provider profile |
| `(0, 0)` means "location not set", never a real position | search query excludes it; frontend labels it as unset |
| Only numeric storage | `numeric(10,8)` / `numeric(11,8)`; `::float8` casts in queries |

Coordinates are never inferred from a free-text address. The address fields
(`address_line_1`, `city`) are display-only; discovery uses coordinates only.

## 2. Storage

- `customer_profiles.location_lat`, `location_lon` — the customer's preferred search
  location. New accounts start with `NULL` (not `0,0`).
- `providers.location_lat`, `location_lon` — the provider's service base location.
  Required during onboarding; `NULL` or `0,0` means "not discoverable".
- `providers.service_radius_km` — how far the provider will travel (1–100, default 10).
- `platform_settings.default_search_radius_km` — default customer search radius (10).
- `platform_settings.max_search_radius_km` — hard cap (default 50).

Indexes: `idx_providers_location (location_lat, location_lon)` supports the bounding-box
prefilter.

## 3. Distance calculation

Haversine, in kilometres, with Earth radius **6371.0088 km**, evaluated inside PostgreSQL:

```sql
6371.0088 * 2 * asin(sqrt(
  power(sin(radians(p.location_lat - :lat) / 2), 2)
  + cos(radians(:lat)) * cos(radians(p.location_lat))
  * power(sin(radians(p.location_lon - :lon) / 2), 2)
))
```

Why SQL instead of JavaScript: filtering and ordering happen before rows leave the
database, so "nearest N" is correct and does not depend on how many rows the API happens to
load. The same radius units (km) are used on both sides.

A cheap bounding box (`± radius / 111.045` degrees latitude, and a longitude delta divided
by `cos(latitude)`) runs first so the index can be used. It is deliberately slightly
larger than the circle; the Haversine comparison then removes the corners.

No PostGIS. The Docker image stays `postgres:18-alpine`; no extension or migration risk is
introduced. For very large provider counts, revisit with `GEOGRAPHY(Point, 4326)` and a
GiST index.

## 4. Inclusion rules (public search)

A provider appears for a service when **all** are true:

1. `verification_status = 'approved'` and `is_verified = TRUE`.
2. Its `users.status = 'active'`.
3. `location_lat`/`location_lon` are non-null and not `(0,0)`.
4. It offers the requested **active** service (`provider_services` + `services.is_active`).
5. If the customer supplied a location:
   `distance ≤ search radius` **and**
   `distance ≤ COALESCE(provider coverage, search radius)`.

Rule 5's fallback is intentional: a legacy row with a NULL coverage radius is treated as
covering the current search radius rather than being silently excluded. A provider that
explicitly sets a smaller radius is respected.

Without a customer location, rules 1–4 still apply and approved providers are returned
unfiltered; the response includes `search.has_location = false` and the UI states that no
distance filter was applied. The API never substitutes `(0,0)`.

## 5. Radius semantics

- `radius` query parameter is clamped to `1 … max_radius_km`.
- The UI offers 5, 10, 20 and 30 km, filtered by the configured maximum.
- The customer cannot search beyond `max_radius_km`, even by crafting the query string.

## 6. Response shape

```json
{
  "message": "2 provider(s) found.",
  "providers": [
    {
      "id": 12,
      "display_name": "Suresh AC Services",
      "location_lat": 16.1727,
      "location_lon": 81.1337,
      "service_radius_km": 10,
      "average_rating": 4.5,
      "review_count": 3,
      "services": ["AC/Refrigerator Repair", "Washing Machine Repair"],
      "service_name": "AC/Refrigerator Repair",
      "distance_km": 0.5,
      "is_verified": true
    }
  ],
  "search": {
    "service_id": 5,
    "service_name": "AC/Refrigerator Repair",
    "radius_km": 10,
    "has_location": true,
    "location_ignored": false,
    "sort_by": "distance",
    "max_radius_km": 50
  }
}
```

Known limitations:

- No address geocoding (manual coordinates or browser location only).
- No timezone/availability filtering in discovery; availability was not part of the
  existing schema and is not fabricated here.
- Distance is straight-line, not travel distance.

## 7. Privacy

- Browser geolocation is requested only after the user clicks "Use my current location";
  the permission prompt is the browser's own.
- If permission is denied, the UI falls back to manual entry; it does not reuse a fake
  location.
- The customer's exact coordinates are **not** written to application logs (request logs
  exclude query strings; `requestLogger` logs method/path/status/duration only).
- Provider results contain a distance, not the customer's coordinates.
- Provider public responses expose the business service location and radius, never the
  customer's address. Provider payout details (`payout_upi_id`) are excluded from the admin
  provider detail response too.
- Saving a location to the profile requires authentication and writes only the current
  user's `customer_profiles` row.
