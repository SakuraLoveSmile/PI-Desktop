use super::{expert_config::*, test_support::expert_proposal, tests::*, *};
use crate::sessions;
use serde_json::json;

fn configure(db: &crate::db::Database, settings: serde_json::Value) {
    validate_settings(db, &settings).unwrap();
    db.set_setting("app", &json!({"expertTeam": settings}))
        .unwrap();
}

#[test]
fn expert_settings_validate_schema_routes_tools_and_canonical_project_scope() {
    let db = test_db();
    ensure_test_route(&db, "fixture", "model");
    for value in [
        json!(null),
        json!({"schemaVersion":2,"userDefaults":{},"projectOverrides":{}}),
        json!({"schemaVersion":1,"userDefaults":{"qa":{"providerId":"fixture"}},"projectOverrides":{}}),
        json!({"schemaVersion":1,"userDefaults":{"qa":{"providerId":"missing","modelId":"model"}},"projectOverrides":{}}),
        json!({"schemaVersion":1,"userDefaults":{"qa":{"tools":["mcp_secret"]}},"projectOverrides":{}}),
        json!({"schemaVersion":1,"userDefaults":{"qa":{"tools":["Read","Read"]}},"projectOverrides":{}}),
        json!({"schemaVersion":1,"userDefaults":{"qa":{"apiKey":"secret"}},"projectOverrides":{}}),
        json!({"schemaVersion":1,"userDefaults":{},"projectOverrides":{"/unknown":{"qa":{}}}}),
        json!({"schemaVersion":1,"userDefaults":{"unknown":{}},"projectOverrides":{}}),
        json!({"schemaVersion":1,"userDefaults":{"qa":{"instructions":"a".repeat(16001)}},"projectOverrides":{}}),
    ] {
        assert!(validate_settings(&db, &value).is_err(), "{value}");
    }
    for value in [
        json!({"schemaVersion":1,"userDefaults":{"qa":{"instructions":null}},"projectOverrides":{}}),
        json!({"schemaVersion":1,"userDefaults":{"qa":{"providerId":null,"modelId":null}},"projectOverrides":{}}),
    ] {
        assert!(parse(&value).is_err());
    }
    assert!(parse(&json!({"schemaVersion":1,"userDefaults":{"ui":{"instructions":"😀".repeat(16000)}},"projectOverrides":{}})).is_ok());
    assert!(parse(&json!({"schemaVersion":1,"userDefaults":{"ui":{"instructions":"😀".repeat(16001)}},"projectOverrides":{}})).is_err());
    validate_settings(
        &db,
        &json!({"schemaVersion":1,"userDefaults":{"qa":{"tools":[]}},"projectOverrides":{}}),
    )
    .unwrap();
}

#[test]
fn confirmed_member_config_survives_restart_and_reuse_without_live_settings_link() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("host.sqlite");
    let db = crate::db::Database::open(&db_path).unwrap();
    let lead = create_test_lead(&db);
    ensure_test_route(&db, "pinned-provider", "pinned-model");
    configure(
        &db,
        json!({"schemaVersion":1,"userDefaults":{"reviewer":{"providerId":"pinned-provider","modelId":"pinned-model","thinkingLevel":"low","tools":["Read"],"instructions":"original"}},"projectOverrides":{}}),
    );
    start_test_turn(&db, &lead, "reviewer-turn");
    let mut proposal = expert_proposal("reviewer-person");
    proposal.preset_id = Some(ExpertTeamPresetId::Reviewer);
    let (_, review) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: "reviewer-turn",
            strategy: "delegate",
            reason: "Review",
            members: Some(vec![proposal]),
        },
    )
    .unwrap();
    let review = review.unwrap();
    let (_, decision) = confirm_launch_review(&db, &lead, &review.review_id, 1).unwrap();
    let member = decision.member_session_ids[0].clone();
    let snapshot = member_snapshot(&db, &member).unwrap().unwrap();
    finish_test_turn(&db, "reviewer-turn");
    drop(db);
    let db = crate::db::Database::open(&db_path).unwrap();
    assert_eq!(
        member_snapshot(&db, &member).unwrap(),
        Some(snapshot.clone())
    );
    configure(
        &db,
        json!({"schemaVersion":1,"userDefaults":{"reviewer":{"tools":["Write"],"instructions":"changed"}},"projectOverrides":{}}),
    );
    // Composer now uses B while the expert's reviewed route remains A.
    db.conn().execute("UPDATE sessions SET provider_id='test-provider',model_id='test-model',thinking_level='high' WHERE id=?1", [&lead]).unwrap();
    for (turn, model_proposes_change) in [("reuse-turn", false), ("reuse-explicit-turn", true)] {
        start_test_turn(&db, &lead, turn);
        let mut proposal = expert_proposal("reviewer-person");
        proposal.member_session_id = Some(member.clone());
        proposal.preset_id = Some(ExpertTeamPresetId::Reviewer);
        if model_proposes_change {
            proposal.selection = Some(TeamMemberSelectionPartial {
                provider_id: Some("test-provider".into()),
                model_id: Some("test-model".into()),
                thinking_level: Some("high".into()),
            });
        }
        let (_, reused) = declare_team_strategy(
            &db,
            DeclareStrategyParams {
                team_session_id: &lead,
                caller_session_id: &lead,
                lead_turn_id: turn,
                strategy: "delegate",
                reason: "Reuse review",
                members: Some(vec![proposal]),
            },
        )
        .unwrap();
        let reused = reused.unwrap();
        assert_eq!(reused.members[0].expert_config, Some(snapshot.clone()));
        assert_eq!(reused.members[0].selection.provider_id, "pinned-provider");
        assert_eq!(reused.members[0].selection.model_id, "pinned-model");
        assert_eq!(reused.members[0].selection.thinking_level, "low");
        if model_proposes_change {
            let edited = update_launch_review(
                &db,
                &lead,
                &reused.review_id,
                reused.revision,
                vec![TeamLaunchReviewSelectionUpdate {
                    name: "reviewer-person".into(),
                    provider_id: "test-provider".into(),
                    model_id: "test-model".into(),
                    thinking_level: "off".into(),
                }],
            )
            .unwrap();
            confirm_launch_review(&db, &lead, &edited.review_id, edited.revision).unwrap();
            assert_eq!(
                sessions::get_session(&db, &member)
                    .unwrap()
                    .unwrap()
                    .summary
                    .provider_id
                    .as_deref(),
                Some("test-provider")
            );
        } else {
            confirm_launch_review(&db, &lead, &reused.review_id, reused.revision).unwrap();
            assert_eq!(
                sessions::get_session(&db, &member)
                    .unwrap()
                    .unwrap()
                    .summary
                    .provider_id
                    .as_deref(),
                Some("pinned-provider")
            );
        }
        finish_test_turn(&db, turn);
    }
    assert_eq!(member_snapshot(&db, &member).unwrap(), Some(snapshot));
}

#[test]
fn trusted_review_route_edit_wins_and_unavailable_confirmation_leaves_no_snapshot() {
    let db = test_db();
    let lead = create_test_lead(&db);
    ensure_test_route(&db, "configured", "configured-model");
    configure(
        &db,
        json!({"schemaVersion":1,"userDefaults":{"debugger":{"providerId":"configured","modelId":"configured-model","thinkingLevel":"low","tools":["Read"]}},"projectOverrides":{}}),
    );
    start_test_turn(&db, &lead, "debug-turn");
    let mut proposal = expert_proposal("debug-person");
    proposal.preset_id = Some(ExpertTeamPresetId::Debugger);
    let (_, review) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: "debug-turn",
            strategy: "delegate",
            reason: "Debug",
            members: Some(vec![proposal]),
        },
    )
    .unwrap();
    let review = review.unwrap();
    let edited = update_launch_review(
        &db,
        &lead,
        &review.review_id,
        review.revision,
        vec![TeamLaunchReviewSelectionUpdate {
            name: "debug-person".into(),
            provider_id: "test-provider".into(),
            model_id: "test-model".into(),
            thinking_level: "off".into(),
        }],
    )
    .unwrap();
    db.conn()
        .execute(
            "UPDATE providers SET enabled=0 WHERE id='test-provider'",
            [],
        )
        .unwrap();
    assert!(confirm_launch_review(&db, &lead, &edited.review_id, edited.revision).is_err());
    assert!(list_team_members(&db, &lead).unwrap().is_empty());
    let snapshots: i64 = db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM kv WHERE ns=?1",
            [MEMBER_CONFIG_NS],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(snapshots, 0);
    db.conn()
        .execute(
            "UPDATE providers SET enabled=1 WHERE id='test-provider'",
            [],
        )
        .unwrap();
    let (confirmed, decision) =
        confirm_launch_review(&db, &lead, &edited.review_id, edited.revision).unwrap();
    assert_eq!(confirmed.members[0].selection.provider_id, "test-provider");
    assert_eq!(
        sessions::get_session(&db, &decision.member_session_ids[0])
            .unwrap()
            .unwrap()
            .summary
            .provider_id
            .as_deref(),
        Some("test-provider")
    );
}

#[test]
fn unavailable_saved_expert_route_cannot_fall_back_to_lead_on_new_launch() {
    let db = test_db();
    let lead = create_test_lead(&db);
    ensure_test_route(&db, "configured", "configured-model");
    let settings = json!({"schemaVersion":1,"userDefaults":{"qa":{"providerId":"configured","modelId":"configured-model","thinkingLevel":"off"}},"projectOverrides":{}});
    configure(&db, settings.clone());
    db.conn()
        .execute("UPDATE providers SET enabled=0 WHERE id='configured'", [])
        .unwrap();
    // Historical references stay editable but they never become launch grants.
    validate_settings(&db, &settings).unwrap();
    start_test_turn(&db, &lead, "unavailable-route-turn");
    let mut proposal = expert_proposal("qa");
    proposal.preset_id = Some(ExpertTeamPresetId::Qa);
    let error = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: "unavailable-route-turn",
            strategy: "delegate",
            reason: "Do not fall back",
            members: Some(vec![proposal]),
        },
    )
    .unwrap_err();
    assert!(error.to_string().contains("TEAM_MODEL_SELECTION_INVALID"));
    assert!(get_launch_review(&db, &lead, None).unwrap().is_none());
    assert!(list_team_members(&db, &lead).unwrap().is_empty());
}

#[test]
fn project_fields_inherit_user_defaults_without_cross_project_leakage() {
    let db = test_db();
    let first = create_test_lead(&db);
    let second = create_test_lead(&db);
    let workspace = tempfile::tempdir().unwrap();
    let path = workspace.path().to_string_lossy().to_string();
    sessions::move_session_project(&db, &first, &path).unwrap();
    let path = sessions::get_session(&db, &first)
        .unwrap()
        .unwrap()
        .summary
        .project_path
        .unwrap();
    configure(
        &db,
        json!({"schemaVersion":1,"userDefaults":{"qa":{"providerId":"test-provider","modelId":"test-model","thinkingLevel":"high","tools":["Read"],"instructions":"user"}},"projectOverrides":{path:{"qa":{"tools":[],"instructions":"project"}}}}),
    );
    let alpha = resolve(&db, &first, &ExpertTeamPresetId::Qa).unwrap();
    assert_eq!(alpha.provider_id.as_deref(), Some("test-provider"));
    assert_eq!(alpha.thinking_level.as_deref(), Some("high"));
    assert_eq!(alpha.tools, Some(vec![]));
    assert_eq!(alpha.instructions.as_deref(), Some("project"));
    assert_eq!(
        resolve(&db, &second, &ExpertTeamPresetId::Qa)
            .unwrap()
            .instructions
            .as_deref(),
        Some("user")
    );
}

#[test]
fn user_confirmed_review_snapshots_config_and_ignores_later_settings_edits() {
    let db = test_db();
    let lead = create_test_lead(&db);
    ensure_test_route(&db, "configured", "configured-model");
    configure(
        &db,
        json!({"schemaVersion":1,"userDefaults":{"qa":{"providerId":"configured","modelId":"configured-model","thinkingLevel":"low","tools":["Read"],"instructions":"first"}},"projectOverrides":{}}),
    );
    start_test_turn(&db, &lead, "configured-turn");
    let mut proposal = expert_proposal("qa-person");
    proposal.preset_id = Some(ExpertTeamPresetId::Qa);
    proposal.selection = Some(TeamMemberSelectionPartial {
        provider_id: Some("test-provider".into()),
        model_id: Some("test-model".into()),
        thinking_level: Some("off".into()),
    });
    let (_, review) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: "configured-turn",
            strategy: "delegate",
            reason: "Configured QA",
            members: Some(vec![proposal]),
        },
    )
    .unwrap();
    let review = review.unwrap();
    assert_eq!(review.members[0].selection.provider_id, "configured");
    assert_eq!(review.members[0].selection.thinking_level, "low");
    assert!(list_team_members(&db, &lead).unwrap().is_empty());
    configure(
        &db,
        json!({"schemaVersion":1,"userDefaults":{"qa":{"tools":["Write"],"instructions":"second"}},"projectOverrides":{}}),
    );
    let (confirmed, decision) =
        confirm_launch_review(&db, &lead, &review.review_id, review.revision).unwrap();
    let member = &decision.member_session_ids[0];
    let snapshot = member_snapshot(&db, member).unwrap().unwrap();
    assert_eq!(snapshot.instructions.as_deref(), Some("first"));
    assert_eq!(
        snapshot,
        confirmed.members[0].expert_config.clone().unwrap()
    );
    validate_tool(&db, member, "Read").unwrap();
    validate_tool(&db, member, "asktool").unwrap();
    for denied in ["Write", "Bash", "mcp_read", "plugin_tool", "read"] {
        assert!(validate_tool(&db, member, denied).is_err());
    }
    assert!(update_launch_review(
        &db,
        &lead,
        &review.review_id,
        confirmed.revision,
        vec![TeamLaunchReviewSelectionUpdate {
            name: "qa-person".into(),
            provider_id: "test-provider".into(),
            model_id: "test-model".into(),
            thinking_level: "off".into()
        }]
    )
    .is_err());
    super::lifecycle::cleanup_team_on_lead_delete(&db, &lead).unwrap();
    assert!(member_snapshot(&db, member).unwrap().is_none());
}

#[test]
fn automatic_plan_launch_has_config_and_legacy_proposals_stay_unbound() {
    let db = test_db();
    let lead = create_test_lead(&db);
    db.conn()
        .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
        .unwrap();
    configure(
        &db,
        json!({"schemaVersion":1,"userDefaults":{"researcher":{"tools":[],"instructions":"read-only research"}},"projectOverrides":{}}),
    );
    start_test_turn(&db, &lead, "plan-config-turn");
    let mut researcher = expert_proposal("Alex");
    researcher.preset_id = Some(ExpertTeamPresetId::Researcher);
    let (_, review) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: "plan-config-turn",
            strategy: "delegate",
            reason: "Research",
            members: Some(vec![researcher, expert_proposal("researcher")]),
        },
    )
    .unwrap();
    let review = review.unwrap();
    assert_eq!(review.status, "confirmed");
    let roster = list_team_members(&db, &lead).unwrap();
    let alex = roster.iter().find(|member| member.name == "Alex").unwrap();
    assert_eq!(
        member_snapshot(&db, &alex.member_session_id)
            .unwrap()
            .unwrap()
            .tools,
        Some(vec![])
    );
    assert!(validate_tool(&db, &alex.member_session_id, "Read").is_err());
    super::planning::validate_tool(&db, &alex.member_session_id, "Write").unwrap_err();
    let legacy = roster
        .iter()
        .find(|member| member.name == "researcher")
        .unwrap();
    assert!(member_snapshot(&db, &legacy.member_session_id)
        .unwrap()
        .is_none());
    validate_tool(&db, &legacy.member_session_id, "Read").unwrap();
    let raw = json!({"name":"Legacy","contextKind":"fresh","selection":{"providerId":"test-provider","modelId":"test-model","thinkingLevel":"off"}});
    let legacy: TeamLaunchReviewMember = serde_json::from_value(raw).unwrap();
    assert!(legacy.expert_config.is_none());
}
