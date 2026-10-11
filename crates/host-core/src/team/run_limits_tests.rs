use super::{
    ensure_team, get_team, run_limits,
    tests::{create_test_lead, test_db},
};
use crate::sessions;

#[test]
fn repeating_validation_loop_is_paused_at_hard_wall_clock() {
    let db = test_db();
    let lead = create_test_lead(&db);
    ensure_team(&db, &lead).unwrap();
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let started = crate::db::now_ms();
    run_limits::start_conn(db.conn(), &lead, started).unwrap();
    let hard = run_limits::RunLimitSettings::default().hard_ms;
    // Fake provider repeatedly proposes another validation/fix iteration.
    for step in 1..=10 {
        run_limits::evaluate_at(&db, &lead, started + hard * step / 10).unwrap();
    }
    assert!(get_team(&db, &lead).unwrap().unwrap().paused);
    assert_eq!(sessions::running_turn_id(&db, &lead).unwrap(), Some(turn));
}

#[test]
fn soft_notice_is_durable_once_per_run_and_cannot_be_forged() {
    let db = test_db();
    let lead = create_test_lead(&db);
    ensure_team(&db, &lead).unwrap();
    sessions::begin_turn(&db, &lead, None, None).unwrap();
    let started = run_limits::state(&db, &lead).unwrap().unwrap().started_at;
    let soft = run_limits::RunLimitSettings::default().soft_ms;
    let events = run_limits::evaluate_at(&db, &lead, started + soft).unwrap();
    assert_eq!(events.len(), 1);
    let notice = events[0].message_id.as_ref().unwrap();
    assert!(run_limits::is_soft_notice(&db, &lead, notice).unwrap());
    for step in 1..5 {
        assert!(run_limits::evaluate_at(&db, &lead, started + soft + step)
            .unwrap()
            .is_empty());
    }
    let mail = super::list_member_messages(&db, &lead, &lead).unwrap();
    assert_eq!(mail.len(), 1);
    assert!(mail[0].content.contains("collect expert results"));
    assert!(
        super::member_failure::validate_message_key(Some("team-run-limit-soft:forged")).is_err()
    );
}

#[test]
fn hard_pause_survives_restart_and_resume_never_resets_the_clock() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    let db = crate::db::Database::open(&path).unwrap();
    let lead = create_test_lead(&db);
    ensure_team(&db, &lead).unwrap();
    sessions::begin_turn(&db, &lead, None, None).unwrap();
    let clock = run_limits::state(&db, &lead).unwrap().unwrap();
    let hard = run_limits::RunLimitSettings::default().hard_ms;
    let reached = clock.started_at + hard;
    run_limits::evaluate_at(&db, &lead, reached).unwrap();
    assert!(sessions::begin_turn(&db, &lead, None, None).is_err());
    drop(db);
    let db = crate::db::Database::open(&path).unwrap();
    assert!(get_team(&db, &lead).unwrap().unwrap().paused);
    let paused = run_limits::state(&db, &lead).unwrap().unwrap();
    assert_eq!(paused.started_at, clock.started_at);
    assert_eq!(paused.run_id, clock.run_id);
    assert!(super::resume_team(&db, &lead)
        .unwrap_err()
        .to_string()
        .contains("TEAM_RUN_LIMIT_REACHED"));
    // Policy changes alone never release the pause. Explicit resume is required.
    db.set_setting("app", &serde_json::json!({"expertTeam":{"schemaVersion":1,"userDefaults":{},"projectOverrides":{},"runLimits":{"enabled":false,"softMs":1,"hardMs":2}}})).unwrap();
    assert!(get_team(&db, &lead).unwrap().unwrap().paused);
    super::resume_team(&db, &lead).unwrap();
    let resumed = run_limits::state(&db, &lead).unwrap().unwrap();
    assert_eq!(resumed.elapsed_ms, hard);
    assert_eq!(resumed.started_at, clock.started_at);
    assert_eq!(resumed.run_id, clock.run_id);
    assert_eq!(resumed.hard_reached_at, None);
}

#[test]
fn idle_completed_teams_do_not_wake_and_new_user_scope_gets_a_new_budget() {
    let db = test_db();
    let lead = create_test_lead(&db);
    ensure_team(&db, &lead).unwrap();
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let old = run_limits::state(&db, &lead).unwrap().unwrap();
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    assert!(
        run_limits::evaluate_at(&db, &lead, old.started_at + 100 * 60 * 60 * 1000)
            .unwrap()
            .is_empty()
    );
    assert!(!get_team(&db, &lead).unwrap().unwrap().paused);
    assert!(super::list_member_messages(&db, &lead, &lead)
        .unwrap()
        .is_empty());
    let new = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let state = run_limits::state(&db, &lead).unwrap().unwrap();
    assert_eq!(state.run_id, new);
    assert_ne!(state.run_id, old.run_id);
    assert_eq!(state.elapsed_ms, 0);
}

#[test]
fn disabled_limits_do_not_trigger_actions_and_manual_pause_cannot_bypass_hard() {
    let db = test_db();
    let lead = create_test_lead(&db);
    ensure_team(&db, &lead).unwrap();
    sessions::begin_turn(&db, &lead, None, None).unwrap();
    let start = run_limits::state(&db, &lead).unwrap().unwrap().started_at;
    db.set_setting(
        "app",
        &serde_json::json!({"expertTeam":{"runLimits":{"enabled":false,"softMs":1,"hardMs":2}}}),
    )
    .unwrap();
    assert!(run_limits::evaluate_at(&db, &lead, start + 100)
        .unwrap()
        .is_empty());
    assert!(!get_team(&db, &lead).unwrap().unwrap().paused);
    super::pause_team(&db, &lead).unwrap();
    db.set_setting("app", &serde_json::json!({})).unwrap();
    let reached = start + 100 * 60 * 60 * 1000;
    let events = run_limits::evaluate_at(&db, &lead, reached).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, "hard");
    assert_eq!(
        run_limits::state(&db, &lead)
            .unwrap()
            .unwrap()
            .hard_reached_at,
        Some(reached)
    );
}

#[test]
fn persisted_elapsed_high_water_survives_a_backward_host_clock() {
    let db = test_db();
    let lead = create_test_lead(&db);
    ensure_team(&db, &lead).unwrap();
    sessions::begin_turn(&db, &lead, None, None).unwrap();
    let start = run_limits::state(&db, &lead).unwrap().unwrap().started_at;
    run_limits::evaluate_at(&db, &lead, start + 1000).unwrap();
    run_limits::evaluate_at(&db, &lead, start - 1000).unwrap();
    assert_eq!(
        run_limits::state(&db, &lead).unwrap().unwrap().elapsed_ms,
        1000
    );
}

#[test]
fn legacy_settings_keep_defaults_and_malformed_limits_fail_closed() {
    let db = test_db();
    assert_eq!(
        run_limits::settings(&db).unwrap(),
        run_limits::RunLimitSettings::default()
    );
    for value in [
        serde_json::json!({"enabled":true,"softMs":0,"hardMs":10}),
        serde_json::json!({"enabled":true,"softMs":10,"hardMs":10}),
        serde_json::json!({"enabled":true,"softMs":1.2,"hardMs":10}),
        serde_json::json!(null),
    ] {
        assert!(super::expert_config::parse(&serde_json::json!({"schemaVersion":1,"userDefaults":{},"projectOverrides":{},"runLimits":value})).is_err());
    }
}

#[test]
fn authenticated_mail_continuation_keeps_the_existing_run_clock() {
    let db = test_db();
    let lead = create_test_lead(&db);
    ensure_team(&db, &lead).unwrap();
    let user = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let before = run_limits::state(&db, &lead).unwrap().unwrap();
    let soft = run_limits::RunLimitSettings::default().soft_ms;
    let notice = run_limits::evaluate_at(&db, &lead, before.started_at + soft).unwrap()[0]
        .message_id
        .clone()
        .unwrap();
    sessions::end_turn(&db, &user, "completed", None, None, false).unwrap();
    let mail_turn =
        crate::session_collaboration::begin_turn(&db, &lead, &notice, None, None).unwrap();
    let after = run_limits::state(&db, &lead).unwrap().unwrap();
    assert_ne!(mail_turn, user);
    assert_eq!(after.run_id, user);
    assert_eq!(after.started_at, before.started_at);
    assert_eq!(after.elapsed_ms, soft);
    assert_eq!(after.soft_message_id, Some(notice));
}

#[test]
fn failed_resume_keeps_the_hard_pause_reason_atomic() {
    let db = test_db();
    let lead = create_test_lead(&db);
    ensure_team(&db, &lead).unwrap();
    sessions::begin_turn(&db, &lead, None, None).unwrap();
    let start = run_limits::state(&db, &lead).unwrap().unwrap().started_at;
    let hard = run_limits::RunLimitSettings::default().hard_ms;
    run_limits::evaluate_at(&db, &lead, start + hard).unwrap();
    db.set_setting(
        "app",
        &serde_json::json!({"expertTeam":{"runLimits":{"enabled":false,"softMs":1,"hardMs":2}}}),
    )
    .unwrap();
    db.conn().execute_batch("CREATE TRIGGER fail_resume BEFORE UPDATE OF paused ON teams WHEN NEW.paused=0 BEGIN SELECT RAISE(ABORT,'isolated resume failure'); END;").unwrap();
    assert!(super::resume_team(&db, &lead).is_err());
    assert!(get_team(&db, &lead).unwrap().unwrap().paused);
    assert_eq!(
        run_limits::state(&db, &lead)
            .unwrap()
            .unwrap()
            .hard_reached_at,
        Some(start + hard)
    );
    db.conn()
        .execute_batch("DROP TRIGGER fail_resume;")
        .unwrap();
    super::resume_team(&db, &lead).unwrap();
    assert_eq!(
        run_limits::state(&db, &lead)
            .unwrap()
            .unwrap()
            .hard_reached_at,
        None
    );
}
