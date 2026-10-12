CREATE TABLE IF NOT EXISTS team_ordinary_inbox (
  message_id TEXT PRIMARY KEY REFERENCES session_collaboration_messages(id) ON DELETE CASCADE,
  team_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  lead_turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  scope_turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  boundary_id TEXT NOT NULL,
  source_session_id TEXT NOT NULL,
  source_turn_id TEXT NOT NULL,
  permission_ceiling TEXT NOT NULL CHECK (permission_ceiling IN ('ask', 'accept-edits', 'auto')),
  user_message_id TEXT NOT NULL UNIQUE,
  phase TEXT NOT NULL CHECK (phase IN ('prepared', 'persisted', 'acked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_ordinary_inbox_turn
  ON team_ordinary_inbox(team_session_id, lead_turn_id, created_at, message_id);
