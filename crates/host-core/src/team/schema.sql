CREATE TABLE IF NOT EXISTS teams (
  team_session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  revision        INTEGER NOT NULL DEFAULT 1,
  paused          INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  team_session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  member_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  context_kind      TEXT NOT NULL DEFAULT 'fresh'
                    CHECK (context_kind IN ('fresh', 'fork')),
  phase             TEXT NOT NULL DEFAULT 'provisioning'
                    CHECK (phase IN ('provisioning', 'idle', 'running', 'failed', 'completed')),
  model_id          TEXT,
  provider_id       TEXT,
  error             TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (team_session_id, name),
  UNIQUE (team_session_id, member_session_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_session
  ON team_members(member_session_id);

CREATE TABLE IF NOT EXISTS team_tasks (
  team_session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  task_id           TEXT NOT NULL,
  revision          INTEGER NOT NULL DEFAULT 1,
  subject           TEXT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
  owner_session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  owner_member_name TEXT,
  blocked_by_json   TEXT NOT NULL DEFAULT '[]',
  write_scopes_json TEXT NOT NULL DEFAULT '[]',
  deleted           INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (team_session_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_team_tasks_status
  ON team_tasks(team_session_id, status);
