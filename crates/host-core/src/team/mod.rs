#![allow(unused_imports)]
pub mod board;
pub mod lifecycle;
pub mod mailbox;
pub mod model;
pub mod review;
pub mod roster;
#[cfg(test)]
mod tests;

pub use board::{
    create_team_task, get_team_board_projection, get_team_task, list_team_tasks, update_team_task,
    CreateTaskParams, UpdateTaskParams,
};
pub use lifecycle::{
    can_delete_session, cleanup_team_on_lead_delete, ensure_team, get_team, pause_team, resume_team,
};
pub use mailbox::{
    ack_team_message, get_team_message, list_member_messages, list_pending_team_messages,
    send_team_message, team_plugin_origin, SendMessageParams,
};
pub use model::{
    Team, TeamBoardProjection, TeamMember, TeamMessage, TeamRosterProjection, TeamTask,
    TeamTaskReadiness, WriteScopeOverlap, MAX_MEMBER_QUEUED_MESSAGES, MAX_MESSAGE_BYTES,
    MAX_TEAM_MEMBERS, MAX_TEAM_TASKS,
};
pub use model::{
    TeamCoordinationError, TeamExecutionDecision, TeamLaunchReview, TeamLaunchReviewMember,
    TeamLaunchReviewSelectionUpdate, TeamMemberSelection, TeamMemberSelectionPartial,
    TeamProposedMember, MAX_TEAM_STRATEGY_REASON_CHARS, TEAM_EXECUTION_DECISION_SCHEMA_VERSION,
    TEAM_LAUNCH_REVIEW_SCHEMA_VERSION,
};
pub use review::{
    cancel_launch_review, confirm_launch_review, declare_team_strategy, get_execution_decision,
    get_launch_review, interrupt_pending_reviews_on_boot, update_launch_review,
    DeclareStrategyParams, TEAM_EXECUTION_DECISION_NS, TEAM_LAUNCH_REVIEW_NS,
};
pub use roster::{
    create_team_member, gate_session_configure, get_team_member_by_name,
    get_team_member_by_session_id, list_team_members, update_member_phase, validate_member_name,
    validate_team_lead, validate_team_participant, CreateMemberParams,
};
