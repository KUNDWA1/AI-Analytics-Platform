-- ============================================================
-- AI Analytics Platform for Digital Economy Activity Monitoring
-- PostgreSQL schema (idempotent: safe to run repeatedly)
-- ============================================================

CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,          -- administrator | analyst | regulator | management
  label       TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,                -- bcrypt hash, never plain text
  role_id       INT NOT NULL REFERENCES roles(id),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login    TIMESTAMPTZ
);

-- Token management: every issued JWT has a row; logout revokes it.
CREATE TABLE IF NOT EXISTS sessions (
  jti        UUID PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS data_sources (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  organization TEXT,
  url          TEXT,
  description  TEXT,
  source_type  TEXT NOT NULL DEFAULT 'public'
               CHECK (source_type IN ('public','manual','synthetic')),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS datasets (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT,
  category           TEXT NOT NULL,
  data_source_id     INT REFERENCES data_sources(id) ON DELETE SET NULL,
  uploaded_by        INT REFERENCES users(id) ON DELETE SET NULL,
  is_synthetic       BOOLEAN NOT NULL DEFAULT FALSE,
  status             TEXT NOT NULL DEFAULT 'uploaded'
                     CHECK (status IN ('uploaded','validated','processing','processed','failed','archived')),
  original_filename  TEXT NOT NULL,
  stored_filename    TEXT NOT NULL,           -- original file is kept unchanged on disk
  file_hash          TEXT NOT NULL,           -- SHA-256 of the original file
  file_size          BIGINT NOT NULL,
  record_count       INT NOT NULL DEFAULT 0,
  columns            JSONB NOT NULL DEFAULT '[]',
  column_mapping     JSONB,
  validation_report  JSONB,
  processing_summary JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_datasets_hash_active
  ON datasets(file_hash) WHERE status <> 'archived';

-- dataset_files: immutable upload history (one row per uploaded file)
CREATE TABLE IF NOT EXISTS dataset_files (
  id              SERIAL PRIMARY KEY,
  dataset_id      INT REFERENCES datasets(id) ON DELETE SET NULL,
  original_name   TEXT NOT NULL,
  stored_name     TEXT NOT NULL,
  file_hash       TEXT NOT NULL,
  file_size       BIGINT NOT NULL,
  mime_type       TEXT,
  uploaded_by     INT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS indicators (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  unit        TEXT,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- observations = the processed dataset. Every row points back to its source dataset
-- and source row number (provenance / traceability).
CREATE TABLE IF NOT EXISTS observations (
  id              BIGSERIAL PRIMARY KEY,
  dataset_id      INT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  indicator_id    INT NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
  period          DATE NOT NULL,
  geographic_area TEXT NOT NULL DEFAULT 'National',
  value           NUMERIC(24,4) NOT NULL,
  pct_change      NUMERIC(14,4),              -- period-over-period % change
  moving_avg      NUMERIC(24,4),              -- 3-period moving average
  source_row      INT,                        -- row number in the original file
  UNIQUE (dataset_id, indicator_id, period, geographic_area)
);
CREATE INDEX IF NOT EXISTS idx_obs_ind_period ON observations(indicator_id, period);
CREATE INDEX IF NOT EXISTS idx_obs_area ON observations(geographic_area);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id          SERIAL PRIMARY KEY,
  dataset_id  INT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  summary     JSONB,
  error       TEXT,
  started_by  INT REFERENCES users(id) ON DELETE SET NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS trend_analyses (
  id           SERIAL PRIMARY KEY,
  indicator_id INT NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
  area         TEXT NOT NULL,
  params       JSONB,
  result       JSONB NOT NULL,
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forecasts (
  id           SERIAL PRIMARY KEY,
  indicator_id INT NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
  area         TEXT NOT NULL,
  horizon      INT NOT NULL,
  method       TEXT,
  result       JSONB NOT NULL,
  is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anomaly_results (
  id              SERIAL PRIMARY KEY,
  indicator_id    INT NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
  dataset_id      INT REFERENCES datasets(id) ON DELETE SET NULL,
  geographic_area TEXT NOT NULL,
  period          DATE NOT NULL,
  observed_value  NUMERIC(24,4) NOT NULL,
  expected_value  NUMERIC(24,4),
  anomaly_score   NUMERIC(10,4) NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  direction       TEXT CHECK (direction IN ('increase','decrease')),
  method          TEXT NOT NULL,
  explanation     TEXT NOT NULL,
  is_synthetic    BOOLEAN NOT NULL DEFAULT FALSE,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (indicator_id, geographic_area, period)
);

CREATE TABLE IF NOT EXISTS alerts (
  id            SERIAL PRIMARY KEY,
  anomaly_id    INT NOT NULL UNIQUE REFERENCES anomaly_results(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','under_review','reviewed','dismissed')),
  analyst_note  TEXT,
  reviewed_by   INT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);

CREATE TABLE IF NOT EXISTS reports (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  params     JSONB NOT NULL,
  content    JSONB NOT NULL,                   -- snapshot of the findings used in the PDF
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  user_email  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  details     JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

-- ------------------------------------------------------------
-- Views
-- ------------------------------------------------------------
-- Effective observations: only processed datasets; if two datasets contain the same
-- indicator/period/area, the most recently processed dataset takes precedence.
CREATE OR REPLACE VIEW effective_observations AS
SELECT DISTINCT ON (o.indicator_id, o.period, o.geographic_area)
       o.id, o.dataset_id, o.indicator_id, o.period, o.geographic_area, o.value,
       o.pct_change, o.moving_avg, d.data_source_id, d.is_synthetic
FROM observations o
JOIN datasets d ON d.id = o.dataset_id AND d.status = 'processed'
ORDER BY o.indicator_id, o.period, o.geographic_area, d.processed_at DESC, d.id DESC;

-- National series: sum across areas (mean for % indicators). A reported
-- 'National' row is only used if no regional rows exist for that point.
CREATE OR REPLACE VIEW national_series AS
SELECT e.indicator_id, e.period,
       CASE WHEN i.unit = '%' THEN AVG(e.value) ELSE SUM(e.value) END AS value,
       COUNT(*) AS n_areas,
       BOOL_OR(e.is_synthetic) AS is_synthetic,
       MIN(e.data_source_id) AS data_source_id
FROM effective_observations e
JOIN indicators i ON i.id = e.indicator_id
WHERE e.geographic_area <> 'National'
   OR NOT EXISTS (SELECT 1 FROM effective_observations x
                  WHERE x.indicator_id = e.indicator_id AND x.period = e.period
                    AND x.geographic_area <> 'National')
GROUP BY e.indicator_id, e.period, i.unit;
