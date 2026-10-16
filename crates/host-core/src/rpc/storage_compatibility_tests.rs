//! Reopen released Plus data through the real Host startup and read RPCs.
use super::*;
use crate::{
    db::{Database, PLUS_SCHEMA_VERSION},
    session_collaboration, transcripts,
};
use rusqlite::params;

const RELEASED_SCHEMA: &str = include_str!("fixtures/plus7.sql");

fn seed() -> (tempfile::TempDir, String, String) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open_in_dir(dir.path()).unwrap();
    db.conn().execute_batch(RELEASED_SCHEMA).unwrap();
    let lead =
        sessions::create_session(&db, Some("Historical Lead".into()), None, None, None, None)
            .unwrap();
    let member =
        sessions::create_session(&db, Some("Expert".into()), None, None, None, None).unwrap();
    let turn = sessions::begin_turn(&db, &lead.id, None, None).unwrap();
    let source_turn = sessions::begin_turn(&db, &member.id, None, None).unwrap();
    for (id, phase, written) in [
        ("prepared-written", "prepared", true),
        ("prepared-unwritten", "prepared", false),
        ("persisted", "persisted", true),
        ("acked", "acked", true),
    ] {
        db.conn().execute("INSERT INTO session_collaboration_messages(id,plugin_id,source_session_id,source_title,target_session_id,target_title,kind,content,status,idempotency_key,remaining_hops,permission_ceiling,created_at,updated_at) VALUES(?1,?2,?3,'Expert',?4,'Lead','message',?1,?5,?1,1,'ask',10,10)",params![id,format!("team:{}",lead.id),member.id,lead.id,if phase=="prepared" {"queued"} else {"completed"}]).unwrap();
        db.kv_set("team-message-source-turn-v1", id, &json!(source_turn))
            .unwrap();
        db.conn().execute("INSERT INTO team_ordinary_inbox(message_id,team_session_id,lead_turn_id,scope_turn_id,boundary_id,source_session_id,source_turn_id,permission_ceiling,user_message_id,phase,created_at,updated_at) VALUES(?1,?2,?3,?3,'wait-1',?4,?5,'ask',?6,?7,10,10)",params![id,lead.id,turn,member.id,source_turn,format!("user-{id}"),phase]).unwrap();
        if phase == "prepared" {
            db.conn().execute("INSERT INTO turn_queue(id,session_id,principal,idempotency_key,input_hash,content,session_message_id,permission_mode,position,created_at) VALUES(?1,?2,'team',?1,'hash',?1,?1,'ask',0,10)",params![id,lead.id]).unwrap();
        }
        if written {
            let delivery = session_collaboration::get(&db, id).unwrap().unwrap();
            let message: sessions::UiMessage = serde_json::from_value(json!({"id":format!("user-{id}"),"role":"user","content":id,"createdAt":crate::db::ms_to_ts(10),"sessionMessage":json!({"messageId":delivery.id,"sourceSessionId":delivery.source_session_id,"sourceTitle":delivery.source_title,"targetSessionId":delivery.target_session_id,"kind":delivery.kind})})).unwrap();
            let (record, _) = sessions::ui_to_record(&message);
            transcripts::append_message(db.data_dir(), &lead.id, &lead.created_at, &record)
                .unwrap();
            if phase != "prepared" {
                db.conn().execute("INSERT INTO messages(id,session_id,seq,role,text,created_at,turn_id) VALUES(?1,?2,?3,'user',?4,10,?5)",params![message.id,lead.id,if phase=="persisted" {1} else {2},id,turn]).unwrap();
            }
        }
    }
    // A normal queued report must retain main's continuation semantics.
    db.conn().execute("INSERT INTO session_collaboration_messages(id,plugin_id,source_session_id,source_title,target_session_id,target_title,kind,content,status,idempotency_key,remaining_hops,permission_ceiling,created_at,updated_at) VALUES('ordinary-queued',?1,?2,'Expert',?3,'Lead','message','Next report','queued','ordinary-queued',1,'ask',20,20)",params![format!("team:{}",lead.id),member.id,lead.id]).unwrap();
    db.conn().execute("INSERT INTO turn_queue(id,session_id,principal,idempotency_key,input_hash,content,session_message_id,permission_mode,position,created_at) VALUES('ordinary-queued',?1,'team','ordinary-queued','hash','Next report','ordinary-queued','ask',1,20)",[&lead.id]).unwrap();
    for (id, status, service) in [
        ("live-service", "running", true),
        ("stopped-service", "stopped", true),
        ("legacy-command", "running", false),
    ] {
        db.conn().execute("INSERT INTO background_processes(id,session_id,tool_call_id,command,cwd,status,started_at,stdout) VALUES(?1,?2,?1,'do not replay','/tmp',?3,'2026-10-11T00:00:00Z','saved output')",params![id,member.id,status]).unwrap();
        if service {
            db.conn().execute("INSERT INTO background_service_ownership(process_id,team_session_id,team_run_id,launch_turn_id,deadline_at,owner_project_path,stop_reason,stop_requested_at) VALUES(?1,?2,?3,?4,1000,'/tmp',?5,?6)",params![id,lead.id,turn,source_turn,if status=="stopped" {Some("explicit_stop")} else {None},if status=="stopped" {Some(500)} else {None}]).unwrap();
        }
    }
    db.conn().execute("UPDATE background_service_ownership SET stop_escalated=1 WHERE process_id='stopped-service'",[]).unwrap();
    db.conn()
        .execute("UPDATE plus_schema_meta SET plus_version=7", [])
        .unwrap();
    (dir, lead.id, member.id)
}

#[tokio::test]
async fn schema7_reopens_nonempty_journal_and_service_history_without_replay() {
    let (dir, lead, member) = seed();
    for _ in 0..2 {
        let mut app = AppState::open(dir.path()).unwrap();
        app.handshook = true;
        assert!(app.background_jobs.is_empty());
        assert!(app.active_bash_cancellations.is_empty());
        let db = &app.db;
        assert_eq!(
            db.conn()
                .query_row("SELECT plus_version FROM plus_schema_meta", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            PLUS_SCHEMA_VERSION
        );
        assert_eq!(
            db.conn()
                .query_row(
                    "SELECT phase FROM team_ordinary_inbox WHERE message_id='prepared-written'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "persisted"
        );
        assert_eq!(db.conn().query_row("SELECT COUNT(*) FROM team_ordinary_inbox WHERE message_id='prepared-unwritten'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(db.conn().query_row("SELECT COUNT(*) FROM turn_queue WHERE session_message_id IN ('prepared-unwritten','ordinary-queued')",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        assert_eq!(
            db.conn()
                .query_row(
                    "SELECT status FROM session_collaboration_messages WHERE id='prepared-written'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "completed"
        );
        assert_eq!(
            db.conn()
                .query_row(
                    "SELECT COUNT(*) FROM turn_queue WHERE session_message_id='prepared-written'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        let records = transcripts::read_transcript(db.data_dir(), &lead).unwrap();
        assert_eq!(records.len(), 3);
        assert_eq!(
            db.conn()
                .query_row(
                    "SELECT COUNT(*) FROM messages WHERE session_id=?1 AND turn_id IS NOT NULL",
                    [&lead],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            3
        );
        let state = Arc::new(Mutex::new(app));
        let (tx, _) = mpsc::unbounded_channel();
        let list = handle_request(state.clone(), "session.list", json!({}), tx.clone())
            .await
            .unwrap();
        assert_eq!(list["sessions"].as_array().unwrap().len(), 2);
        let read = handle_request(
            state.clone(),
            "backgroundProcesses.read",
            json!({"sessionId":member,"id":"live-service"}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(read["process"]["status"], "interrupted");
        assert_eq!(read["process"]["backgroundKind"], "service");
        assert_eq!(read["process"]["teamSessionId"], lead);
        assert_eq!(read["process"]["stopReason"], "host_restart");
        assert_eq!(read["stdout"], "saved output");
        let stopped = handle_request(
            state.clone(),
            "backgroundProcesses.read",
            json!({"sessionId":member,"id":"stopped-service"}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(stopped["process"]["stopReason"], "explicit_stop");
        assert_eq!(stopped["process"]["serviceStopEscalated"], true);
        assert!(stopped["process"].get("stopMode").is_none());
        let command = handle_request(
            state.clone(),
            "backgroundProcesses.read",
            json!({"sessionId":member,"id":"legacy-command"}),
            tx,
        )
        .await
        .unwrap();
        assert_eq!(command["process"]["status"], "interrupted");
        assert!(command["process"].get("backgroundKind").is_none());
    }
}

#[test]
fn schema5_upgrade_preserves_rows_backs_up_and_applies_exact_released_ddl() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open_in_dir(dir.path()).unwrap();
    let session =
        sessions::create_session(&db, Some("Keep me".into()), None, None, None, None).unwrap();
    db.conn().execute_batch("DROP TABLE IF EXISTS team_ordinary_inbox; DROP TRIGGER IF EXISTS background_services_block_team_delete; DROP TABLE IF EXISTS background_service_ownership; UPDATE plus_schema_meta SET plus_version=5;").unwrap();
    drop(db);
    let reopened = Database::open_in_dir(dir.path()).unwrap();
    assert_eq!(
        sessions::get_session(&reopened, &session.id)
            .unwrap()
            .unwrap()
            .summary
            .title,
        "Keep me"
    );
    assert_eq!(
        reopened
            .conn()
            .query_row("SELECT plus_version FROM plus_schema_meta", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        PLUS_SCHEMA_VERSION
    );
    assert!(dir.path().join("pi.sqlite.plus-v5.bak").is_file());
    let released = rusqlite::Connection::open_in_memory().unwrap();
    released
        .execute_batch("CREATE TABLE sessions(id TEXT PRIMARY KEY);")
        .unwrap();
    released.execute_batch(RELEASED_SCHEMA).unwrap();
    for name in [
        "team_ordinary_inbox",
        "idx_team_ordinary_inbox_turn",
        "background_service_ownership",
        "background_services_team",
        "background_services_block_team_delete",
    ] {
        let ddl = |conn: &rusqlite::Connection| {
            conn.query_row("SELECT sql FROM sqlite_master WHERE name=?1", [name], |r| {
                r.get::<_, String>(0)
            })
            .unwrap()
        };
        assert_eq!(ddl(reopened.conn()), ddl(&released), "{name}");
    }
    drop(reopened);
    Database::open_in_dir(dir.path()).unwrap();
}

#[test]
fn newer_plus_schema_is_refused_without_rewriting_versions_or_rows() {
    let (dir, _, _) = seed();
    let path = dir.path().join("pi.sqlite");
    let conn = rusqlite::Connection::open(&path).unwrap();
    let future_version = PLUS_SCHEMA_VERSION + 1;
    conn.execute(
        "UPDATE plus_schema_meta SET plus_version=?1",
        [future_version],
    )
    .unwrap();
    assert!(Database::open(&path)
        .err()
        .unwrap()
        .to_string()
        .contains(&format!(
            "Plus schema version {future_version} is newer than supported"
        )));
    assert_eq!(
        conn.query_row("SELECT plus_version FROM plus_schema_meta", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        future_version
    );
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM team_ordinary_inbox", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        4
    );
}

#[test]
fn journal_index_completion_and_queue_retirement_rollback_together() {
    let (dir, lead, _) = seed();
    let conn = rusqlite::Connection::open(dir.path().join("pi.sqlite")).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_retirement BEFORE DELETE ON turn_queue WHEN OLD.session_message_id='prepared-written' BEGIN SELECT RAISE(ABORT,'retirement failed'); END;").unwrap();
    let error = AppState::open(dir.path()).err().unwrap();
    assert!(error.to_string().contains("retirement failed"));
    assert_eq!(
        conn.query_row(
            "SELECT phase FROM team_ordinary_inbox WHERE message_id='prepared-written'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "prepared"
    );
    assert_eq!(
        conn.query_row(
            "SELECT status FROM session_collaboration_messages WHERE id='prepared-written'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "queued"
    );
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE id='user-prepared-written'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM turn_queue WHERE session_message_id='prepared-written'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        transcripts::read_transcript(dir.path(), &lead)
            .unwrap()
            .len(),
        3
    );
    conn.execute_batch("DROP TRIGGER reject_retirement;")
        .unwrap();
    let app = AppState::open(dir.path()).unwrap();
    assert_eq!(
        transcripts::read_transcript(app.db.data_dir(), &lead)
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        conn.query_row(
            "SELECT phase FROM team_ordinary_inbox WHERE message_id='prepared-written'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "persisted"
    );
}

#[test]
fn journal_recovery_rejects_changed_ledger_and_transcript_identity() {
    for tamper in ["ledger-source", "source-turn", "content", "origin"] {
        let (dir, lead, member) = seed();
        let conn = rusqlite::Connection::open(dir.path().join("pi.sqlite")).unwrap();
        match tamper {
            "ledger-source" => {
                conn.execute("UPDATE session_collaboration_messages SET source_session_id='other' WHERE id='prepared-written'",[]).unwrap();
            }
            "source-turn" => {
                conn.execute("UPDATE team_ordinary_inbox SET source_turn_id='other' WHERE message_id='prepared-written'",[]).unwrap();
            }
            _ => {
                let mut record = transcripts::read_transcript(dir.path(), &lead)
                    .unwrap()
                    .remove(0);
                if tamper == "content" {
                    record.blocks = json!([{"type":"text","text":"forged body"}]);
                } else {
                    record.meta.as_mut().unwrap()["sessionMessage"]["sourceSessionId"] =
                        json!(format!("other-{member}"));
                }
                assert!(transcripts::update_message(dir.path(), &lead, &record).unwrap());
            }
        }
        assert!(AppState::open(dir.path()).is_err(), "{tamper}");
        assert_eq!(
            conn.query_row(
                "SELECT phase FROM team_ordinary_inbox WHERE message_id='prepared-written'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "prepared"
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM turn_queue WHERE session_message_id='prepared-written'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }
}

#[test]
fn rebuilding_another_proof_cannot_consume_unvalidated_journal_records() {
    for phase in ["prepared", "persisted", "acked"] {
        let (dir, lead, _) = seed();
        let conn = rusqlite::Connection::open(dir.path().join("pi.sqlite")).unwrap();
        conn.execute(
            "UPDATE team_ordinary_inbox SET phase=?1 WHERE message_id='persisted'",
            [phase],
        )
        .unwrap();
        conn.execute(
            "UPDATE session_collaboration_messages SET created_at=20 WHERE id='persisted'",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE session_collaboration_messages SET status='queued' WHERE id='persisted'",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO turn_queue(id,session_id,principal,input_hash,content,session_message_id,permission_mode,position,created_at) VALUES('persisted',?1,'team','hash','persisted','persisted','ask',2,10)",[&lead]).unwrap();
        let mut record = transcripts::read_transcript(dir.path(), &lead)
            .unwrap()
            .remove(1);
        record.blocks = json!([{"type":"text","text":"forged second proof"}]);
        assert!(transcripts::update_message(dir.path(), &lead, &record).unwrap());
        for _ in 0..2 {
            assert!(AppState::open(dir.path()).is_err());
            assert_eq!(
                conn.query_row(
                    "SELECT phase FROM team_ordinary_inbox WHERE message_id='persisted'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
                phase
            );
            assert_eq!(
                conn.query_row(
                    "SELECT status FROM session_collaboration_messages WHERE id='persisted'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
                "queued"
            );
            assert_eq!(
                conn.query_row(
                    "SELECT COUNT(*) FROM turn_queue WHERE session_message_id='persisted'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
                1
            );
            assert_eq!(
                conn.query_row(
                    "SELECT COUNT(*) FROM messages WHERE id='user-prepared-written'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
                0
            );
        }
    }
}

#[test]
fn service_owner_loss_and_process_interruption_rollback_together() {
    let (dir, _, _) = seed();
    let conn = rusqlite::Connection::open(dir.path().join("pi.sqlite")).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_interruption BEFORE UPDATE OF status ON background_processes WHEN OLD.id='live-service' BEGIN SELECT RAISE(ABORT,'interruption failed'); END;").unwrap();
    assert!(AppState::open(dir.path()).is_err());
    let owner: (Option<String>,Option<i64>) = conn.query_row("SELECT stop_reason,stop_requested_at FROM background_service_ownership WHERE process_id='live-service'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    assert_eq!(owner, (None, None));
    assert_eq!(
        conn.query_row(
            "SELECT status FROM background_processes WHERE id='live-service'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "running"
    );
    conn.execute_batch("DROP TRIGGER reject_interruption;")
        .unwrap();
    let app = AppState::open(dir.path()).unwrap();
    assert!(app.background_jobs.is_empty());
    assert_eq!(
        conn.query_row(
            "SELECT stop_reason FROM background_service_ownership WHERE process_id='live-service'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "host_restart"
    );
    assert_eq!(
        conn.query_row(
            "SELECT status FROM background_processes WHERE id='live-service'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "interrupted"
    );
}

#[tokio::test]
async fn service_launch_without_a_current_team_turn_cannot_fall_through_to_a_command() {
    let dir = tempfile::tempdir().unwrap();
    let mut app = AppState::open(dir.path()).unwrap();
    app.handshook = true;
    let session = sessions::create_session(
        &app.db,
        None,
        Some("agent".into()),
        None,
        None,
        Some(dir.path().to_string_lossy().into_owned()),
    )
    .unwrap();
    sessions::configure_session_with_thinking(
        &app.db,
        &session.id,
        "agent",
        None,
        None,
        None,
        Some("auto"),
    )
    .unwrap();
    let shell = tools::shell::catalog(None).effective.unwrap().id;
    let state = Arc::new(Mutex::new(app));
    let (tx, _) = mpsc::unbounded_channel();
    let result = handle_request(state.clone(),"tools.execute",json!({"sessionId":session.id,"toolCallId":"service-launch","toolName":"Bash","args":{"command":"printf rejected-service","run_in_background":true,"backgroundKind":"service"},"mode":"agent","expectedCommandShellId":shell,"expectedCommandShellDialect":tools::shell::dialect_for_id(&shell)}),tx).await;
    let jobs = {
        let mut st = state.lock().await;
        st.shutdown();
        std::mem::take(&mut st.background_jobs)
    };
    for (_, job) in jobs {
        job.await.unwrap();
    }
    let error = result.expect_err("service arguments must not fall through to command launch");
    assert_eq!(
        error.data.unwrap()["errorCode"],
        "TEAM_SERVICE_UNAUTHORIZED"
    );
    assert!(
        crate::background_processes::list(&state.lock().await.db, &session.id)
            .unwrap()
            .is_empty()
    );
}
