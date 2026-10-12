use super::{replacements, test_support::expert_proposal, tests::*, *};
use crate::{db::Database, sessions};
use serde_json::json;

fn fixture(count: usize) -> (Database, String, TeamExecutionDecision) {
    let db = test_db();
    let lead = create_test_lead(&db);
    db.set_setting("expertTeam",&json!({"schemaVersion":1,"userDefaults":{"qa":{"tools":["Read"],"instructions":"Frozen QA"}},"projectOverrides":{}})).unwrap();
    start_test_turn(&db, &lead, "replacement-turn");
    let proposals = (0..count)
        .map(|i| {
            let mut p = expert_proposal(&format!("qa_{i}"));
            p.preset_id = Some(super::expert_config::ExpertTeamPresetId::Qa);
            p
        })
        .collect();
    let (_, review) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: "replacement-turn",
            strategy: "delegate",
            reason: "Approved QA",
            members: Some(proposals),
        },
    )
    .unwrap();
    let review = review.unwrap();
    let (_, decision) =
        confirm_launch_review(&db, &lead, &review.review_id, review.revision).unwrap();
    (db, lead, decision)
}

fn replace(
    db: &Database,
    lead: &str,
    name: &str,
    source: &str,
    provider: Option<&str>,
) -> anyhow::Result<TeamMember> {
    replacements::create(
        db,
        CreateMemberParams {
            team_session_id: lead,
            caller_session_id: lead,
            name,
            description: None,
            context_kind: None,
            model_id: None,
            provider_id: provider,
        },
        source,
    )
}

#[test]
fn replacement_inherits_frozen_config_route_permission_and_does_not_migrate_tasks() {
    let (db, lead, decision) = fixture(1);
    let original = &decision.member_session_ids[0];
    update_member_phase(&db, &lead, original, "failed", Some("PROVIDER_FAILED")).unwrap();
    let owned = create_team_task(
        &db,
        CreateTaskParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            task_id: Some("existing-task"),
            subject: "Original task",
            description: None,
            blocked_by: None,
            write_scopes: None,
            owner_session_id: Some(original),
            owner_member_name: Some("qa_0"),
        },
    )
    .unwrap();
    let member = replace(&db, &lead, "qa_new", "qa_0", None).unwrap();
    let retained = get_team_task(&db, &lead, &owned.task_id).unwrap().unwrap();
    assert_eq!(
        retained.owner_session_id.as_deref(),
        Some(original.as_str())
    );
    assert_eq!(retained.owner_member_name.as_deref(), Some("qa_0"));
    let old = sessions::get_session(&db, original)
        .unwrap()
        .unwrap()
        .summary;
    let new = sessions::get_session(&db, &member.member_session_id)
        .unwrap()
        .unwrap()
        .summary;
    assert_eq!(new.provider_id, old.provider_id);
    assert_eq!(new.model_id, old.model_id);
    assert_eq!(new.thinking_level, old.thinking_level);
    assert_eq!(new.permission_mode, old.permission_mode);
    assert_eq!(
        super::expert_config::member_snapshot(&db, original).unwrap(),
        super::expert_config::member_snapshot(&db, &member.member_session_id).unwrap()
    );
    super::review::require_approved_member(&db, &lead, &member.member_session_id).unwrap();
    db.conn()
        .execute(
            "UPDATE sessions SET permission_mode='auto' WHERE id=?1",
            [&member.member_session_id],
        )
        .unwrap();
    assert!(super::review::require_approved_member(&db, &lead, &member.member_session_id).is_err());
    assert!(sessions::get_session(&db, original).unwrap().is_some());
}

#[test]
fn healthy_member_override_and_replacement_chain_are_rejected() {
    let (db, lead, decision) = fixture(1);
    let original = &decision.member_session_ids[0];
    assert!(replace(&db, &lead, "qa_new", "qa_0", None)
        .unwrap_err()
        .to_string()
        .contains("TEAM_REPLACEMENT_NOT_FAILED"));
    update_member_phase(&db, &lead, original, "failed", None).unwrap();
    assert!(replace(&db, &lead, "qa_new", "qa_0", Some("forged-provider")).is_err());
    let new = replace(&db, &lead, "qa_new", "qa_0", None).unwrap();
    update_member_phase(&db, &lead, &new.member_session_id, "failed", None).unwrap();
    assert!(replace(&db, &lead, "qa_third", "qa_new", None)
        .unwrap_err()
        .to_string()
        .contains("TEAM_REPLACEMENT_ALREADY_USED"));
    assert_eq!(list_team_members(&db, &lead).unwrap().len(), 2);
}

#[test]
fn full_roster_retains_failed_history_and_names_a_trusted_next_step() {
    let (db, lead, decision) = fixture(8);
    update_member_phase(&db, &lead, &decision.member_session_ids[0], "failed", None).unwrap();
    let error = replace(&db, &lead, "qa_new", "qa_0", None)
        .unwrap_err()
        .to_string();
    assert!(error.contains("TEAM_MEMBER_LIMIT_EXCEEDED"));
    assert!(error.contains("nextStep"));
    assert_eq!(list_team_members(&db, &lead).unwrap().len(), 8);
    assert!(db
        .kv_get(
            replacements::NS,
            &format!("{lead}:{}", decision.member_session_ids[0])
        )
        .unwrap()
        .is_none());
}

#[test]
fn new_user_scope_cannot_replace_from_a_previous_approval() {
    let (db, lead, decision) = fixture(1);
    update_member_phase(&db, &lead, &decision.member_session_ids[0], "failed", None).unwrap();
    finish_test_turn(&db, "replacement-turn");
    start_test_turn(&db, &lead, "new-user-turn");
    assert!(replace(&db, &lead, "qa_new", "qa_0", None)
        .unwrap_err()
        .to_string()
        .contains("TEAM_APPROVAL_REQUIRED"));
    assert_eq!(list_team_members(&db, &lead).unwrap().len(), 1);
}
