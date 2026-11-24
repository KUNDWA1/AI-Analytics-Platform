# AI Analytics Platform for Digital Economy Activity Monitoring in Emerging Markets

BSc Software Engineering final-year project — Adventist University of Central Africa (AUCA), Rwanda.
Practical focus: FinTech and Digital Financial Services.

The platform imports publicly available datasets (CSV / Excel), validates and processes them, runs trend analysis,
forecasting and anomaly detection, and presents the results on role-based dashboards and downloadable reports.
**It is an analytical intelligence tool only.** It does not process payments, move money, score credit or control
transactions, and it has no access to BNR, MTN, RURA or bank systems.

> **Data honesty.** The bundled demo data is **SYNTHETIC DEMONSTRATION DATA — NOT OFFICIAL INSTITUTIONAL DATA.**
> It is labelled in the UI, on charts, in reports and in the data files. Real public datasets (BNR, NISR, RURA,
> World Bank Global Findex) are meant to be downloaded manually from their websites and uploaded through the
> platform. No partnership or data-sharing agreement with any institution is claimed.
> An *anomaly* is an unusual statistical pattern — not proof of fraud, misconduct or a regulatory violation.

## Architecture

```
React + TypeScript (Vite, Tailwind, Recharts)  ──HTTP/JSON──▶  Node.js / Express REST API  ──SQL──▶  PostgreSQL
                                                                      │
                                                                      └── spawns ──▶ Python analytics (pandas, NumPy, SciPy, scikit-learn)
```

* **Frontend** (`frontend/`) – 15 screens, role-aware navigation, all data fetched from the API.
* **Backend** (`backend/`) – authentication (bcrypt + JWT with server-side session revocation), RBAC enforced on every
  route, upload validation, audit logging, PDF/CSV reports, orchestration of the analytics engine.
* **Analytics** (`analytics/`) – a Python engine invoked by the backend as a child process with JSON on stdin/stdout.
  This is deliberately simpler than a separate FastAPI service: nothing extra to deploy or keep running on Windows,
  and business logic (Node) stays separate from analytics (Python). See `docs/ARCHITECTURE.md`.
* **Database** (`database/schema.sql`) – PostgreSQL schema with keys, constraints, indexes and provenance.

## Prerequisites (Windows 10)

| Tool | Version | Check |
|---|---|---|
| Node.js | 20 LTS or newer | `node --version` |
| Python | 3.10 or newer (tick *Add to PATH*) | `python --version` |
| PostgreSQL | 14 or newer | `psql --version` |
| VS Code | any | |

## Setup (PowerShell)

```powershell
# 1. Create the database (run in psql as the postgres user; choose your own password)
psql -U postgres -c "CREATE USER fintech WITH PASSWORD 'choose-a-password';"
psql -U postgres -c "CREATE DATABASE fintech_analytics OWNER fintech;"
psql -U postgres -c "CREATE DATABASE fintech_analytics_test OWNER fintech;"   # only needed for the automated tests

# 2. Environment file
cd ai-fintech-platform
Copy-Item .env.example .env
notepad .env        # set DATABASE_URL (same password), JWT_SECRET (>= 32 random chars), DEMO_PASSWORD
# Generate a JWT secret:
#   [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])

# 3. Python analytics dependencies
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
pip install -r analytics\requirements.txt
#   then set PYTHON_BIN in .env to the full path of the venv interpreter, e.g.
#   PYTHON_BIN=C:\path\to\ai-fintech-platform\.venv\Scripts\python.exe

# 4. Backend
cd backend
npm install
npm run db:init                        # creates tables, roles, permissions (safe to re-run)

# 5. Frontend
cd ..\frontend
npm install
```

## Run

**Development** (two terminals, hot reload):

```powershell
# Terminal 1
cd backend;  npm run dev          # API on http://localhost:4000
# Terminal 2
cd frontend; npm run dev          # UI  on http://localhost:5173  (proxies /api to :4000)
```

**Production-style** (one process; the API serves the built UI):

```powershell
cd frontend; npm run build
cd ..\backend; npm start          # http://localhost:4000
```

### Load the demonstration environment

With the API running (the loader uses the real API: it uploads the sample files, processes them, runs trend
analysis, forecasts and anomaly detection, and generates an example report):

```powershell
cd backend
npm run seed -- --reset           # wipe and rebuild demo data, create demo users
```

An administrator can also reset from the API: `POST /api/system/demo/reset` with `{"confirm": true}`.

### Demo accounts

| Role | Email | Landing page |
|---|---|---|
| Administrator | `admin@demo.local` | system overview, health, users, audit |
| Data Analyst | `analyst@demo.local` | processing results, model evaluation |
| Regulator | `regulator@demo.local` | activity overview, alerts, regional view |
| Management / Policymaker | `management@demo.local` | executive summary, growth, inclusion |

The password for all four is the `DEMO_PASSWORD` value you set in `.env`. Change or delete these users before any
non-demo use.

## Tests

```powershell
cd analytics;  python -m pytest -q                 # 13 analytics tests
cd backend;    npm test                            # 35 API / security / database tests (uses fintech_analytics_test)
cd frontend;   npm test                            # 9 UI tests; also: npm run build (type-checks)
```

What is covered: data inspection and processing counts, traceability to source rows, data-quality detection, trend
calculations, forecast back-testing and refusal on short series, anomaly detection on injected spikes, authentication,
role enforcement per endpoint, upload validation (extension, content, size, spoofed files), SQL constraints and
duplicate prevention, report/CSV generation, login/navigation/form validation and role-specific UI.

## How the AI/analytics works

* **Processing** – parses dates (several formats), converts numbers, flags invalid / missing / duplicate rows, normalises
  indicator names and units, never invents values for invalid or missing cells (they are counted and reported), computes period-over-period % change and a 3-period moving
  average. The original upload is never modified (SHA-256 recorded); each stored observation keeps its source row number.
* **Trend analysis** – linear trend (direction, R²), total and annualised growth, MoM / YoY, 3- and 12-period moving
  averages, volatility, seasonality, indicator correlation of changes, regional ranking and clustering.
* **Forecasting** – candidate models (naive, seasonal naive, linear, linear+seasonal, log-linear, log-linear+seasonal,
  Holt) are scored by **rolling-origin back-testing** (MAE, RMSE, MAPE); the lowest-RMSE model is refit on all data and
  prediction intervals come from pooled back-test errors. A benchmark comparison against the naive forecast is shown.
  With too little history the platform **refuses to forecast** and says why.
* **Anomaly detection** – robust z-scores (median/MAD) on residuals from a trend(+seasonal) baseline; Isolation Forest
  findings are only reported when corroborated by the z-scores, plus a regional peer comparison. Gaps inside a series are
  linearly interpolated for trend/forecast (and reported) but interpolated points are never flagged. Each finding stores the observed value, expected baseline, score, severity, explanation,
  method and date. There are **no ground-truth labels for real data**, so no accuracy claim is made for it; on
  *synthetic* series with injected anomalies the automated benchmark requires recall ≥ 0.9 and precision ≥ 0.7.

## Known limitations

* Only manual upload is supported – there are no live feeds from BNR, NISR, RURA or operators.
* Synthetic data is simple; results on it demonstrate the software, not the Rwandan economy.
* Forecasts extrapolate history; they cannot anticipate policy changes or shocks, and intervals are approximate.
* Short or strongly seasonal series can produce low-severity seasonal flags (e.g. a repeating September dip).
* The "regional comparison" uses charts and tables; no geographic map is drawn (no boundary data is bundled).
* Large uploads are processed synchronously (10 MB default limit) – adequate for a prototype.
* Sessions are Bearer tokens held in `sessionStorage`; for internet deployment add HTTPS, a reverse proxy and secure cookies.
* No Docker configuration is provided; the native Windows setup above is the supported route.

## Deployment notes

Build the UI (`npm run build`), set `NODE_ENV=production`, a strong `JWT_SECRET`, a real `DATABASE_URL`, `CORS_ORIGIN`
for your domain, and run `node src/index.js` (e.g. under a process manager) behind HTTPS. Do not run `seed` on a
production database.

## More documentation

* `docs/ARCHITECTURE.md` – components, data flow, database model, security design
* `docs/API.md` – REST endpoints and permissions
* `docs/DEMO_SCRIPT.md` – step-by-step presentation scenario
