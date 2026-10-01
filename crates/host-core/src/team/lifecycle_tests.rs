use super::tests::{create_team_member, create_test_lead, test_db};
use super::{
    ensure_team, get_team, get_team_member_by_session_id, get_team_snapshot, CreateMemberParams,
};
use crate::db::Database;
use crate::sessions;

#[test]
fn legacy_team_snapshot_bootstraps_but_dissolved_team_stays_dissolved() {
    let db = test_db();
    let lead_id = create_test_lead(&db);

    assert!(get_team(&db, &lead_id).unwrap().is_none());
    let snapshot = get_team_snapshot(&db, &lead_id).unwrap();
    assert_eq!(snapshot.revision, 1);
    assert!(get_team(&db, &lead_id).unwrap().is_some());

    super::lifecycle::cleanup_team_on_lead_delete(&db, &lead_id).unwrap();
    assert!(get_team(&db, &lead_id).unwrap().is_none());
    assert!(get_team_snapshot(&db, &lead_id).is_err());
    assert!(ensure_team(&db, &lead_id).is_err());
    assert!(get_team(&db, &lead_id).unwrap().is_none());
}

#[test]
fn host_restart_settles_running_team_member_and_advances_revision() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    let db = Database::open(&path).unwrap();
    let lead_id = create_test_lead(&db);
    let member = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "restart-worker",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    db.conn()
        .execute(
            "INSERT INTO turns (id, session_id, status, started_at)
             VALUES ('restart-member-turn', ?1, 'running', 1)",
            [&member.member_session_id],
        )
        .unwrap();
    db.conn()
        .execute(
            "UPDATE team_members SET phase='running' WHERE member_session_id=?1",
            [&member.member_session_id],
        )
        .unwrap();
    let revision_before_restart = get_team(&db, &lead_id).unwrap().unwrap().revision;
    drop(db);

    let reopened = Database::open(&path).unwrap();
    let recovered = get_team_member_by_session_id(&reopened, &member.member_session_id)
        .unwrap()
        .unwrap();
    assert_eq!(recovered.phase, "idle");
    let turn_status: String = reopened
        .conn()
        .query_row(
            "SELECT status FROM turns WHERE id='restart-member-turn'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(turn_status, "aborted");
    assert_eq!(
        get_team(&reopened, &lead_id).unwrap().unwrap().revision,
        revision_before_restart + 1
    );
}

#[test]
fn lead_profile_cannot_be_downgraded_with_team_data_and_empty_team_cleans_atomically() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let member = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "protected-worker",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();

    let error = sessions::configure_session_with_profile(
        &db,
        &lead_id,
        "agent",
        None,
        None,
        None,
        None,
        Some("standard"),
    )
    .unwrap_err();
    assert!(error
        .to_string()
        .starts_with("TEAM_LEAD_CONFIGURATION_BLOCKED:"));
    assert_eq!(
        sessions::session_execution_profile(&db, &lead_id)
            .unwrap()
            .as_deref(),
        Some("team")
    );
    assert!(
        get_team_member_by_session_id(&db, &member.member_session_id)
            .unwrap()
            .is_some()
    );

    let empty_lead_id = create_test_lead(&db);
    ensure_team(&db, &empty_lead_id).unwrap();
    sessions::configure_session_with_profile(
        &db,
        &empty_lead_id,
        "agent",
        None,
        None,
        None,
        None,
        Some("standard"),
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        sessions::session_execution_profile(&db, &empty_lead_id)
            .unwrap()
            .as_deref(),
        Some("standard")
    );
    assert!(get_team(&db, &empty_lead_id).unwrap().is_none());
}
