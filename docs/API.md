# REST API

Base path `/api`. Responses: `{ "success": true, "data": ... }` or `{ "success": false, "error": { "message", "details" } }`.
All routes except `GET /health` and `POST /auth/login` need `Authorization: Bearer <token>`.
Permission names are enforced server-side (administrator holds all of them).

| Method & path | Permission | Purpose |
|---|---|---|
| POST `/auth/login` · POST `/auth/logout` · GET `/auth/me` · POST `/auth/change-password` | – / authenticated | session management |
| GET `/users` · GET `/users/roles` · POST `/users` · PUT `/users/:id` · DELETE `/users/:id` | `users.manage` | user & role management |
| GET `/data-sources` · POST `/data-sources` · PUT `/data-sources/:id` | `sources.view` / `sources.manage` | source registration |
| GET `/indicators` · POST `/indicators` · PUT `/indicators/:id` | `indicators.view` / `indicators.manage` | indicator catalogue |
| GET `/datasets/meta` · GET `/datasets` · GET `/datasets/:id` | `datasets.view` | list / detail (columns, validation, summary, history) |
| POST `/datasets/upload` (multipart: `file`, `name`, `category`, `data_source_id`, `description`, `is_synthetic`) | `datasets.upload` | upload + validate |
| PUT `/datasets/:id/mapping` · PATCH `/datasets/:id` · POST `/datasets/:id/process` | `datasets.process` | column mapping, metadata edit, processing |
| POST `/datasets/:id/archive` · DELETE `/datasets/:id` | `datasets.delete` | archive, permanently delete (administrator only by default) |
| GET `/datasets/jobs/all` | `datasets.view` | processing history |
| GET `/analytics/overview` · GET `/analytics/forecasts` | `analytics.view` | overview, stored forecasts |
| POST `/analytics/trends` · `/compare` · `/regions` | `analytics.view` | trend / comparison analyses |
| POST `/analytics/forecast` · POST `/analytics/anomalies` | `analytics.run` | train + back-test forecast; detect anomalies |
| GET `/alerts` (filters: status, severity, category, area, from, to, q) · GET `/alerts/summary` · GET `/alerts/:id` | `alerts.view` | alerts |
| PATCH `/alerts/:id` `{status, analyst_note}` | `alerts.review` | review workflow |
| GET `/dashboard/filters` · GET `/dashboard/{admin,analyst,regulator,management}` (filters: from, to, category, area, source) | `dashboard.view` (role-bound) | dashboards |
| GET `/reports` · GET `/reports/:id` · GET `/reports/:id/download` (PDF) | `reports.view` | reports |
| POST `/reports/generate` · GET `/reports/export/csv` | `reports.generate` | create report, export CSV |
| GET `/audit-logs` | `audit.view` | audit trail |
| GET `/system/samples` · GET `/system/samples/:name` | `datasets.view` | sample demo files |
| POST `/system/demo/reset` `{"confirm":true}` | `system.manage` | rebuild demo data |
| GET `/health` | public | liveness |

Invalid input → 400, missing/invalid token → 401, insufficient permission → 403, duplicate → 409, file too large → 413.
