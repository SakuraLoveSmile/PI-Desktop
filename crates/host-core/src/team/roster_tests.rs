use super::tests::{create_team_member, test_db};
use crate::sessions::{self, SessionCreateOptions};
use crate::team::roster::CreateMemberParams;

#[test]
fn fresh_member_uses_the_existing_project_display_name() {
    let db = test_db();
    let project = tempfile::tempdir().unwrap();
    let lead = sessions::create_session_with_options(
        &db,
        SessionCreateOptions {
            title: Some("Named Team Lead".into()),
            mode: Some("agent".into()),
            execution_profile: Some("team".into()),
            project_path: Some(project.path().to_string_lossy().into_owned()),
            project_name: Some("Friendly Workspace".into()),
            ..Default::default()
        },
    )
    .unwrap();
    super::tests::ensure_test_route(&db, "test-provider", "test-model");
    db.conn()
        .execute(
            "UPDATE sessions SET provider_id = 'test-provider', model_id = 'test-model'
             WHERE id = ?1",
            [&lead.id],
        )
        .unwrap();
    let member = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead.id,
            caller_session_id: &lead.id,
            name: "researcher",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();

    let member_session = sessions::get_session(&db, &member.member_session_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        member_session.summary.project_name.as_deref(),
        Some("Friendly Workspace")
    );
}
