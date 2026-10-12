//! Isolated service ownership, admission and lifecycle regression coverage.
use super::*;
use crate::{sessions, team};
use serde_json::json;

struct Fixture {
    _data: tempfile::TempDir,
    db: Database,
    lead: String,
    member: String,
    run: String,
    id: String,
}
impl Fixture {
    fn new(member_owner: bool) -> Self {
        let data = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(data.path()).unwrap();
        let lead = sessions::create_session(
            &db,
            None,
            Some("agent".into()),
            None,
            None,
            Some(data.path().to_string_lossy().into()),
        )
        .unwrap();
        sessions::configure_session_with_profile(
            &db,
            &lead.id,
            "agent",
            None,
            None,
            None,
            Some("auto"),
            Some("team"),
        )
        .unwrap();
        team::ensure_team(&db, &lead.id).unwrap();
        let run = sessions::begin_turn(&db, &lead.id, None, None).unwrap();
        let member = sessions::create_session(
            &db,
            None,
            Some("agent".into()),
            None,
            None,
            Some(data.path().to_string_lossy().into()),
        )
        .unwrap();
        db.conn().execute("INSERT INTO team_members(team_session_id,member_session_id,name,context_kind,phase,created_at,updated_at) VALUES(?1,?2,'owner','fresh','completed',1,1)",params![lead.id,member.id]).unwrap();
        let owner = if member_owner { &member.id } else { &lead.id };
        let cwd = crate::db::canonical_project_path(data.path().to_str().unwrap()).unwrap();
        db.conn().execute("INSERT INTO background_processes(id,session_id,tool_call_id,command,cwd,status,started_at) VALUES('service',?1,'call','fixture',?2,'running','2026-10-11T00:00:00Z')", params![owner,cwd]).unwrap();
        persist_owner(
            &db,
            "service",
            &LaunchScope {
                team_session_id: lead.id.clone(),
                team_run_id: run.clone(),
                turn_id: run.clone(),
                permission_ceiling: "auto".into(),
            },
            1_000,
        )
        .unwrap();
        Self {
            _data: data,
            db,
            lead: lead.id,
            member: member.id,
            run,
            id: "service".into(),
        }
    }
    fn reason(&self, now: i64) -> Option<String> {
        lifecycle::reason(&self.db, &self.id, now)
            .unwrap()
            .map(|request| request.reason)
    }
    fn end(&self) {
        self.db
            .conn()
            .execute(
                "UPDATE turns SET status='completed' WHERE id=?1",
                [&self.run],
            )
            .unwrap();
    }
}

#[test]
fn ordinary_team_end_ignores_member_phase_but_preserves_open_tasks_and_reports() {
    let f = Fixture::new(true);
    // An expert's own completed phase does not terminate the run while Lead works.
    assert_eq!(f.reason(2_000), None);
    f.end();
    f.db.conn().execute("INSERT INTO team_tasks(team_session_id,task_id,subject,status,created_at,updated_at) VALUES(?1,'task','Unfinished work','in_progress',1,1)",[&f.lead]).unwrap();
    assert_eq!(f.reason(2_000), None);
    f.db.conn()
        .execute(
            "UPDATE team_tasks SET status='completed' WHERE task_id='task'",
            [],
        )
        .unwrap();
    f.db.conn().execute("INSERT INTO session_collaboration_messages(id,plugin_id,source_session_id,source_title,target_session_id,target_title,kind,content,status,idempotency_key,remaining_hops,permission_ceiling,created_at,updated_at) VALUES('report',?1,?2,'owner',?3,'Lead','message','Completed report','queued','report',1,'auto',1,1)",params![team::team_plugin_origin(&f.lead),f.member,f.lead]).unwrap();
    assert_eq!(f.reason(2_000), None);
    f.db.conn()
        .execute(
            "UPDATE session_collaboration_messages SET status='completed' WHERE id='report'",
            [],
        )
        .unwrap();
    assert_eq!(f.reason(2_000), Some("team_ended".into()));
}

#[test]
fn durable_service_stop_is_first_writer_wins_across_pause_and_new_run() {
    let f = Fixture::new(false);
    team::pause_team(&f.db, &f.lead).unwrap();
    let first = metadata(&f.db, &f.id).unwrap().unwrap();
    request_team(&f.db, &f.lead, "session_deleted", 3_000).unwrap();
    let next = metadata(&f.db, &f.id).unwrap().unwrap();
    assert_eq!(first.stop_requested_at, next.stop_requested_at);
    assert_eq!(next.stop_reason.as_deref(), Some("team_paused"));
    assert_eq!(f.reason(4_000), Some("team_paused".into()));
}

#[test]
fn service_member_removal_run_replacement_and_owner_abort_are_distinct() {
    let removed = Fixture::new(true);
    removed
        .db
        .conn()
        .execute(
            "DELETE FROM team_members WHERE member_session_id=?1",
            [&removed.member],
        )
        .unwrap();
    assert_eq!(removed.reason(2_000), Some("member_removed".into()));
    let replacement = Fixture::new(true);
    let mut state = team::run_limits::state(&replacement.db, &replacement.lead)
        .unwrap()
        .unwrap();
    state.run_id = "replacement".into();
    replacement
        .db
        .kv_set(
            team::run_limits::STATE_NS,
            &replacement.lead,
            &serde_json::to_value(state).unwrap(),
        )
        .unwrap();
    assert_eq!(replacement.reason(2_000), Some("run_replaced".into()));
    let cancelled = Fixture::new(false);
    cancelled
        .db
        .conn()
        .execute(
            "UPDATE turns SET status='aborted' WHERE id=?1",
            [&cancelled.run],
        )
        .unwrap();
    assert_eq!(cancelled.reason(2_000), Some("owner_cancelled".into()));
}

#[test]
fn service_ttl_is_owned_clock_and_chat_switch_is_not_owner_workspace_change() {
    let f = Fixture::new(true);
    assert_eq!(f.reason(1_000 + TTL_MS - 1), None);
    assert_eq!(f.reason(1_000 + TTL_MS), Some("ttl_expired".into()));
    // Updating the visible Host workspace is deliberately outside this domain;
    // only a changed persisted session project changes ownership.
    let different = tempfile::tempdir().unwrap();
    let project =
        f.db.ensure_project(different.path().to_str().unwrap(), false)
            .unwrap();
    f.db.conn()
        .execute(
            "UPDATE sessions SET project_id=?2 WHERE id=?1",
            params![f.member, project],
        )
        .unwrap();
    assert_eq!(f.reason(2_000), Some("owner_workspace_changed".into()));
}

#[test]
fn service_goal_binding_requires_exact_run_turn_proof() {
    let f = Fixture::new(false);
    f.db.conn().execute("INSERT INTO plan_approvals(request_id,session_id,turn_id,tool_call_id,kind,plan_json,status,created_at,updated_at,execution_id,execution_state) VALUES('approval',?1,'old-turn','approval-call','goal','{}','approved',1,1,'old-goal','running')",[&f.lead]).unwrap();
    f.db.conn().execute("INSERT INTO goal_reports(execution_id,report_id,session_id,proposal_id,turn_id,status,integrity,verdict,created_at,updated_at) VALUES('old-goal','report',?1,'approval','old-turn','pending','fallback','unknown',1,1)",[&f.lead]).unwrap();
    // A new ordinary run must never inherit an older still-running Goal's lifetime.
    f.db.conn()
        .execute(
            "DELETE FROM background_service_ownership WHERE process_id='service'",
            [],
        )
        .unwrap();
    let scope = LaunchScope {
        team_session_id: f.lead.clone(),
        team_run_id: f.run.clone(),
        turn_id: f.run.clone(),
        permission_ceiling: "auto".into(),
    };
    persist_owner(&f.db, "service", &scope, 1_000).unwrap();
    f.db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state='completed' WHERE request_id='approval'",
            [],
        )
        .unwrap();
    assert_eq!(f.reason(2_000), None);
    let stored: Option<String> = f
        .db
        .conn()
        .query_row(
            "SELECT goal_execution_id FROM background_service_ownership WHERE process_id='service'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(stored.is_none());
    // Exact turn proof does bind and observes that Goal's terminal state.
    f.db.conn()
        .execute(
            "UPDATE goal_reports SET turn_id=?1 WHERE execution_id='old-goal'",
            [&f.run],
        )
        .unwrap();
    f.db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state='running' WHERE request_id='approval'",
            [],
        )
        .unwrap();
    f.db.conn()
        .execute(
            "DELETE FROM background_service_ownership WHERE process_id='service'",
            [],
        )
        .unwrap();
    persist_owner(&f.db, "service", &scope, 1_000).unwrap();
    f.db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state='interrupted' WHERE request_id='approval'",
            [],
        )
        .unwrap();
    assert_eq!(f.reason(2_000), Some("goal_ended".into()));
}

#[test]
fn service_metadata_is_additive_and_legacy_rows_remain_commands() {
    let f = Fixture::new(false);
    f.db.conn().execute("INSERT INTO background_processes(id,session_id,tool_call_id,command,cwd,status,started_at) VALUES('legacy',?1,'legacy-call','echo legacy','/fixture','completed','2026-10-11T00:00:00Z')",[&f.lead]).unwrap();
    let legacy = crate::background_processes::get(&f.db, &f.lead, "legacy")
        .unwrap()
        .unwrap();
    assert!(serde_json::to_value(legacy)
        .unwrap()
        .get("backgroundKind")
        .is_none());
    let service = crate::background_processes::get(&f.db, &f.lead, &f.id)
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::to_value(service).unwrap()["backgroundKind"],
        json!("service")
    );
}

#[test]
fn service_stop_mode_is_durable_launch_evidence_not_the_readers_platform() {
    let f = Fixture::new(false);
    let launched = metadata(&f.db, &f.id).unwrap().unwrap();
    assert_eq!(
        launched.stop_mode.as_deref(),
        Some(if cfg!(windows) {
            "windows-job-force"
        } else {
            "unix-term-then-kill"
        })
    );
    // A historical service from another platform keeps its recorded mechanism.
    f.db.kv_set(STOP_MODE_NS, &f.id, &json!("windows-job-force"))
        .unwrap();
    drop(f.db);
    let db = Database::open_in_dir(f._data.path()).unwrap();
    assert_eq!(
        metadata(&db, &f.id).unwrap().unwrap().stop_mode.as_deref(),
        Some("windows-job-force")
    );
    db.conn()
        .execute(
            "DELETE FROM kv WHERE ns=?1 AND key=?2",
            params![STOP_MODE_NS, f.id],
        )
        .unwrap();
    let historical = serde_json::to_value(metadata(&db, &f.id).unwrap().unwrap()).unwrap();
    assert!(historical.get("stopMode").is_none());
}

#[test]
fn service_owner_snapshot_upgrade_preserves_existing_rows_without_adoption_or_replay() {
    let Fixture {
        _data: data,
        db,
        lead,
        id,
        ..
    } = Fixture::new(false);
    db.conn()
        .execute_batch("ALTER TABLE background_service_ownership DROP COLUMN owner_project_path;")
        .unwrap();
    // Reverify an existing additive table during the actual P6 -> P7 upgrade;
    // no released P7 database exists before this feature lands.
    db.conn()
        .execute("UPDATE plus_schema_meta SET plus_version=6 WHERE id=1", [])
        .unwrap();
    let legacy_command = crate::background_processes::get(&db, &lead, &id)
        .unwrap()
        .unwrap()
        .command;
    drop(db);
    let restored = crate::state::AppState::open(data.path()).unwrap();
    let snapshot: Option<String> = restored
        .db
        .conn()
        .query_row(
            "SELECT owner_project_path FROM background_service_ownership WHERE process_id=?1",
            [&id],
            |row| row.get(0),
        )
        .unwrap();
    assert!(snapshot.is_none());
    assert!(restored.background_jobs.is_empty());
    let process = crate::background_processes::get(&restored.db, &lead, &id)
        .unwrap()
        .unwrap();
    assert_eq!(process.command, legacy_command);
    assert_eq!(process.status, "interrupted");
    assert_eq!(
        process.service.unwrap().stop_reason.as_deref(),
        Some("host_restart")
    );
}
