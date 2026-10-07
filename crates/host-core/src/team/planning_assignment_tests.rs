//! Research ownership requirements and legacy task recovery.
use super::planning_tests::{research, setup, task};
use super::test_support::{complete_approved_expert_turn, expert_proposal};
use super::{planning::*, tests::*, *};
use crate::sessions;

#[test]
fn active_plan_task_creation_requires_researcher_owner_without_partial_writes() {
    let (db, lead, members) = setup();
    let owned = task(&db, &lead, &members[0]);
    let initial = get(&db, &lead).unwrap().unwrap();
    for phase in ["researching", "aggregating", "clarifying"] {
        if phase == "aggregating" {
            submit(
                &db,
                SubmitResearch {
                    team: &lead,
                    caller: &members[0].member_session_id,
                    planning_id: &initial.planning_id,
                    round_id: &initial.round_id,
                    task_id: &owned.task_id,
                    expected_revision: owned.revision,
                    result: research(),
                },
            )
            .unwrap();
        } else if phase == "clarifying" {
            question(&db, &lead, &lead, &initial.round_id, "question", true).unwrap();
        }
        let state = serde_json::to_value(get(&db, &lead).unwrap()).unwrap();
        assert_eq!(state["phase"], phase);
        let revision = get_team(&db, &lead).unwrap().unwrap().revision;
        for owner in [None, Some(lead.as_str())] {
            let err = create_team_task(
                &db,
                CreateTaskParams {
                    team_session_id: &lead,
                    caller_session_id: &lead,
                    task_id: Some("unassigned"),
                    subject: "Inspect source",
                    description: None,
                    blocked_by: None,
                    write_scopes: None,
                    owner_session_id: owner,
                    owner_member_name: None,
                },
            )
            .unwrap_err();
            assert!(err.to_string().contains("TEAM_RESEARCH_INVALID"));
            assert!(err.to_string().contains("ownerMemberName"));
        }
        assert!(get_team_task(&db, &lead, "unassigned").unwrap().is_none());
        assert_eq!(get_team(&db, &lead).unwrap().unwrap().revision, revision);
        assert_eq!(
            serde_json::to_value(get(&db, &lead).unwrap()).unwrap(),
            state
        );
    }
}

#[test]
fn lead_can_repair_legacy_unassigned_task_with_cas_and_researcher_can_submit() {
    let db = test_db();
    let lead = create_test_lead(&db);
    ensure_team(&db, &lead).unwrap();
    // Generic Agent tasks retain their unassigned semantics. The same durable
    // task represents a legacy unassigned Plan task once research starts.
    let legacy = create_team_task(
        &db,
        CreateTaskParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            task_id: Some("legacy"),
            subject: "Inspect authentication",
            description: None,
            blocked_by: None,
            write_scopes: None,
            owner_session_id: None,
            owner_member_name: None,
        },
    )
    .unwrap();
    assert!(legacy.owner_session_id.is_none());
    db.conn()
        .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
        .unwrap();
    start_test_turn(&db, &lead, "repair-turn");
    declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: "repair-turn",
            strategy: "delegate",
            reason: "Recover existing research task",
            members: Some(vec![expert_proposal("researcher")]),
        },
    )
    .unwrap();
    let member = list_team_members(&db, &lead).unwrap().remove(0);
    complete_approved_expert_turn(&db, &lead, &member.member_session_id);
    let state = get(&db, &lead).unwrap().unwrap();
    let submit_result = |revision| {
        submit(
            &db,
            SubmitResearch {
                team: &lead,
                caller: &member.member_session_id,
                planning_id: &state.planning_id,
                round_id: &state.round_id,
                task_id: &legacy.task_id,
                expected_revision: revision,
                result: research(),
            },
        )
    };
    assert!(submit_result(legacy.revision)
        .unwrap_err()
        .to_string()
        .contains("TEAM_UNAUTHORIZED"));
    let assign = |caller, revision| {
        update_team_task(
            &db,
            UpdateTaskParams {
                team_session_id: &lead,
                caller_session_id: caller,
                task_id: &legacy.task_id,
                expected_revision: revision,
                subject: None,
                description: None,
                status: None,
                owner_session_id: None,
                owner_member_name: Some(Some(&member.name)),
                blocked_by: None,
                write_scopes: None,
                deleted: None,
            },
        )
    };
    assert!(assign(&member.member_session_id, legacy.revision)
        .unwrap_err()
        .to_string()
        .contains("TEAM_UNAUTHORIZED"));
    assert!(assign(&lead, legacy.revision + 1)
        .unwrap_err()
        .to_string()
        .contains("TEAM_TASK_REVISION_CONFLICT"));
    assert!(get(&db, &lead)
        .unwrap()
        .unwrap()
        .expected_task_ids
        .is_empty());
    let assigned = assign(&lead, legacy.revision).unwrap();
    assert_eq!(assigned.owner_member_name.as_deref(), Some("researcher"));
    assert_eq!(
        get(&db, &lead).unwrap().unwrap().expected_task_ids,
        vec![legacy.task_id.clone()]
    );
    submit_result(assigned.revision).unwrap();
    let board = get_team_board_projection(&db, &lead).unwrap();
    assert_eq!(board.tasks[0].status, "completed");
    assert_eq!(
        board.tasks[0].owner_member_name.as_deref(),
        Some("researcher")
    );
    assert_eq!(
        projection(&db, &lead, &lead).unwrap()["completedResearchTasks"],
        1
    );
    validate_submission(&db, &lead).unwrap();
}

#[test]
fn owned_research_task_creation_rolls_back_if_enrolment_cannot_persist() {
    let (db, lead, members) = setup();
    let state = serde_json::to_value(get(&db, &lead).unwrap()).unwrap();
    let revision = get_team(&db, &lead).unwrap().unwrap().revision;
    db.conn().execute_batch("CREATE TRIGGER reject_research_enrolment BEFORE UPDATE ON kv WHEN NEW.ns='team-planning-v1' BEGIN SELECT RAISE(ABORT,'injected enrolment failure'); END;").unwrap();
    let create = || {
        create_team_task(
            &db,
            CreateTaskParams {
                team_session_id: &lead,
                caller_session_id: &lead,
                task_id: Some("atomic-research"),
                subject: "Inspect source",
                description: None,
                blocked_by: None,
                write_scopes: None,
                owner_session_id: None,
                owner_member_name: Some(&members[0].name),
            },
        )
    };
    assert!(create()
        .unwrap_err()
        .to_string()
        .contains("injected enrolment failure"));
    assert!(list_team_tasks(&db, &lead).unwrap().is_empty());
    assert_eq!(get_team(&db, &lead).unwrap().unwrap().revision, revision);
    assert_eq!(
        serde_json::to_value(get(&db, &lead).unwrap()).unwrap(),
        state
    );
    db.conn()
        .execute_batch("DROP TRIGGER reject_research_enrolment;")
        .unwrap();
    let created = create().unwrap();
    assert_eq!(
        get(&db, &lead).unwrap().unwrap().expected_task_ids,
        vec![created.task_id]
    );
}
