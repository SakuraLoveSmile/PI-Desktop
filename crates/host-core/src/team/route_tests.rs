use super::review_selection::validate_member_route;
use super::test_support::expert_proposal;
use super::tests::{create_test_lead, finish_test_turn, start_test_turn, test_db};
use super::*;
use crate::{db::Database, providers, sessions};
use serde_json::{json, Value};

fn registered_route(db: &Database, config: Value) {
    db.conn()
        .execute(
            "INSERT INTO providers (id, name, config_json, created_at, updated_at)
             VALUES ('route-provider', 'Route provider', ?1, 0, 0)",
            [config.to_string()],
        )
        .unwrap();
    providers::cache_discovered_models(
        db,
        "route-provider",
        &[providers::DiscoveredModelInput {
            model_id: "route-model".into(),
            display_name: "Route model".into(),
            capabilities: vec!["reasoning".into()],
            context_window: None,
        }],
    )
    .unwrap();
}

fn launch_with_selection(config: Value, thinking_level: &str) {
    let db = test_db();
    let lead = create_test_lead(&db);
    registered_route(&db, config);
    start_test_turn(&db, &lead, "route-review-turn");
    let (_, review) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: "route-review-turn",
            strategy: "delegate",
            reason: "Review and confirm the selected expert route",
            members: Some(vec![expert_proposal("route-worker")]),
        },
    )
    .unwrap();
    finish_test_turn(&db, "route-review-turn");
    let review = review.unwrap();
    let updated = update_launch_review(
        &db,
        &lead,
        &review.review_id,
        review.revision,
        vec![TeamLaunchReviewSelectionUpdate {
            name: "route-worker".into(),
            provider_id: "route-provider".into(),
            model_id: "route-model".into(),
            thinking_level: thinking_level.into(),
        }],
    )
    .unwrap();
    let (confirmed, decision) =
        confirm_launch_review(&db, &lead, &updated.review_id, updated.revision).unwrap();
    assert_eq!(confirmed.status, "confirmed");
    assert_eq!(decision.member_session_ids.len(), 1);
    let member = sessions::get_session(&db, &decision.member_session_ids[0])
        .unwrap()
        .unwrap()
        .summary;
    assert_eq!(member.provider_id.as_deref(), Some("route-provider"));
    assert_eq!(member.model_id.as_deref(), Some("route-model"));
    assert_eq!(member.thinking_level, thinking_level);
}

#[test]
fn launch_route_ignores_legacy_provider_reasoning_overrides() {
    launch_with_selection(
        json!({
            "models": [{"id": "route-model", "thinkingLevels": ["off", "high"]}],
            "compatibility": {"supportsReasoning": false, "supportedThinkingLevels": ["off"]}
        }),
        "high",
    );
}

#[test]
fn launch_route_allows_omit_for_an_off_only_binding() {
    launch_with_selection(
        json!({"models": [{"id": "route-model", "thinkingLevels": ["off"]}]}),
        "omit",
    );
}

#[test]
fn launch_route_allows_manual_thinking_for_an_empty_binding() {
    launch_with_selection(
        json!({"models": [{"id": "route-model", "thinkingLevels": []}]}),
        "high",
    );
}

#[test]
fn launch_route_preserves_explicit_level_restrictions() {
    let db = test_db();
    registered_route(
        &db,
        json!({
            "models": [{"id": "route-model", "thinkingLevels": ["off", "low"]}],
            "compatibility": {"supportedThinkingLevels": ["off", "high"]}
        }),
    );
    validate_member_route(&db, "route-provider", "route-model", "low").unwrap();
    for level in ["high", "xhigh", "max", "not-a-level"] {
        assert!(validate_member_route(&db, "route-provider", "route-model", level).is_err());
    }
}

#[test]
fn launch_route_does_not_infer_levels_from_cached_capability_labels() {
    let db = test_db();
    registered_route(&db, json!({}));
    for level in ["off", "omit"] {
        validate_member_route(&db, "route-provider", "route-model", level).unwrap();
    }
    assert!(validate_member_route(&db, "route-provider", "route-model", "high").is_err());
}

#[test]
fn launch_route_rejects_unavailable_routes_even_without_thinking() {
    let db = test_db();
    registered_route(
        &db,
        json!({"models": [{"id": "route-model", "thinkingLevels": []}]}),
    );
    for level in ["off", "omit", "high"] {
        assert!(validate_member_route(&db, "missing-provider", "route-model", level).is_err());
        assert!(validate_member_route(&db, "route-provider", "missing-model", level).is_err());
    }
    db.conn()
        .execute(
            "UPDATE providers SET enabled = 0 WHERE id = 'route-provider'",
            [],
        )
        .unwrap();
    for level in ["off", "omit", "high"] {
        assert!(validate_member_route(&db, "route-provider", "route-model", level).is_err());
    }
}

#[test]
fn member_turn_route_rejection_explains_the_confirmed_route_and_keeps_it_admissible() {
    let db = test_db();
    let lead = create_test_lead(&db);
    let lead_turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let (_, review) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &lead_turn,
            strategy: "delegate",
            reason: "Approve a fixed member route",
            members: Some(vec![expert_proposal("route-worker")]),
        },
    )
    .unwrap();
    let review = review.unwrap();
    let (_, decision) =
        confirm_launch_review(&db, &lead, &review.review_id, review.revision).unwrap();
    let member = &decision.member_session_ids[0];
    for (provider, model) in [(Some("other-provider"), None), (None, Some("other-model"))] {
        let error = sessions::begin_turn(&db, member, provider, model)
            .unwrap_err()
            .to_string();
        assert!(error.starts_with("TEAM_APPROVAL_REQUIRED:"));
        assert!(error.contains("nextStep:"));
        assert!(error.contains("team_status"));
        assert!(error.contains("confirmed provider/model"));
        assert!(!sessions::session_has_running_turn(&db, member).unwrap());
    }
    sessions::begin_turn(&db, member, Some("test-provider"), Some("test-model")).unwrap();
}
