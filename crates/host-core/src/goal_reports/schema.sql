CREATE TABLE IF NOT EXISTS goal_reports (
  execution_id   TEXT PRIMARY KEY NOT NULL,
  report_id      TEXT NOT NULL,
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  proposal_id    TEXT NOT NULL,
  turn_id        TEXT,
  status         TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'ready', 'failed')),
  integrity      TEXT NOT NULL CHECK (integrity IN ('structured', 'fallback')),
  verdict        TEXT NOT NULL CHECK (verdict IN ('met', 'partial', 'blocked', 'unknown')),
  summary        TEXT NOT NULL DEFAULT '',
  file_path      TEXT NOT NULL DEFAULT '',
  file_hash      TEXT NOT NULL DEFAULT '',
  file_size      INTEGER NOT NULL DEFAULT 0,
  durable_seq    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_goal_reports_session ON goal_reports(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_goal_reports_report_id ON goal_reports(report_id);
