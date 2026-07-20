CREATE TABLE IF NOT EXISTS issue_reports (
    id           SERIAL PRIMARY KEY,
    username     TEXT,
    role         TEXT,
    page_url     TEXT NOT NULL,
    description  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issue_reports_created_at ON issue_reports(created_at DESC);
