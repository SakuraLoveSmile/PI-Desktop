CREATE TABLE IF NOT EXISTS goal_execution_holds (
  execution_id TEXT PRIMARY KEY REFERENCES plan_approvals(execution_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('blocked','resumed','accepted','abandoned','superseded')),
  reasons_json TEXT NOT NULL,
  first_turn_id TEXT,
  segments_json TEXT NOT NULL DEFAULT '[]',
  blocks_json TEXT NOT NULL DEFAULT '[]',
  resume_count INTEGER NOT NULL DEFAULT 0,
  paused_team INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goal_execution_holds_session ON goal_execution_holds(session_id,state);
