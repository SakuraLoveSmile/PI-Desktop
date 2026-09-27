use serde::{Deserialize, Serialize};

pub const MAX_TEAM_MEMBERS: usize = 8;
pub const MAX_TEAM_TASKS: usize = 256;
pub const MAX_MEMBER_QUEUED_MESSAGES: i64 = 64;
pub const MAX_MESSAGE_BYTES: usize = 65536;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    pub team_session_id: String,
    pub revision: i64,
    pub paused: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamMember {
    pub team_session_id: String,
    pub member_session_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub context_kind: String, // "fresh" | "fork"
    pub phase: String,        // "provisioning" | "idle" | "running" | "failed" | "completed"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamTask {
    pub team_session_id: String,
    pub task_id: String,
    pub revision: i64,
    pub subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub status: String, // "pending" | "in_progress" | "completed" | "failed" | "cancelled"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_member_name: Option<String>,
    pub blocked_by: Vec<String>,
    pub write_scopes: Vec<String>,
    pub deleted: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamTaskReadiness {
    pub task_id: String,
    pub is_ready: bool,
    pub unresolved_blocked_by: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WriteScopeOverlap {
    pub scope: String,
    pub task_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct TeamRosterProjection {
    pub team_session_id: String,
    pub revision: i64,
    pub paused: bool,
    pub members: Vec<TeamMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamBoardProjection {
    pub team_session_id: String,
    pub revision: i64,
    pub tasks: Vec<TeamTask>,
    pub readiness: Vec<TeamTaskReadiness>,
    pub scope_overlaps: Vec<WriteScopeOverlap>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMessage {
    pub id: String,
    pub team_session_id: String,
    pub source_session_id: String,
    pub source_member_name: String,
    pub target_session_id: String,
    pub target_member_name: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    /// Delivery state is derived from the durable message and completion
    /// receipt records. `status` remains the underlying collaboration state.
    pub delivery_status: String, // "queued" | "accepted" | "acknowledged" | "completed" | "failed"
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}
