-- Frozen released Plus P6/P7 DDL; independent of the migration under test.
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

CREATE TABLE IF NOT EXISTS background_service_ownership (
 process_id TEXT PRIMARY KEY REFERENCES background_processes(id) ON DELETE CASCADE,
 team_session_id TEXT NOT NULL, team_run_id TEXT NOT NULL,
 launch_turn_id TEXT NOT NULL, deadline_at INTEGER NOT NULL, goal_execution_id TEXT,
 owner_project_path TEXT,
 stop_reason TEXT, stop_requested_at INTEGER, stop_escalated INTEGER CHECK(stop_escalated IN (0,1)),
 CHECK ((stop_reason IS NULL) = (stop_requested_at IS NULL))
);
CREATE INDEX IF NOT EXISTS background_services_team ON background_service_ownership(team_session_id,team_run_id);
CREATE TRIGGER IF NOT EXISTS background_services_block_team_delete
BEFORE DELETE ON sessions
WHEN EXISTS (SELECT 1 FROM background_service_ownership s JOIN background_processes p ON p.id=s.process_id
 WHERE s.team_session_id=OLD.id AND p.status IN ('starting','running','stopping'))
BEGIN SELECT RAISE(ABORT, 'SESSION_HAS_BACKGROUND_SERVICES'); END;
