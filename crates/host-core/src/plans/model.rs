use super::*;

/// A valid Team Plan may yield until queued expert input enters a Lead turn.
#[derive(Debug)]
pub enum PlanSubmissionResult {
    Submitted(Box<PlanProposal>),
    TeamMessagesPending { pending_messages_count: i64 },
}

pub const PLAN_MAX_MARKDOWN_BYTES: usize = 512 * 1024;
pub const PLAN_REVISION_DRAFT_MAX_REFERENCES: usize = 32;
pub const PLAN_REVISION_DRAFT_MAX_TEXT_BYTES: usize = 512 * 1024;
pub const PLAN_REVISION_DRAFT_MAX_PATH_BYTES: usize = 4096;
pub const PLAN_REVISION_DRAFT_MAX_NAME_BYTES: usize = 512;
pub const PLAN_REVISION_DRAFT_MAX_MIME_TYPE_BYTES: usize = 128;
pub const PLAN_REVISION_DRAFT_MAX_TOKEN_BYTES: usize = 256;

pub const STATUS_PENDING: &str = "pending";
pub const STATUS_APPROVED: &str = "approved";
pub const STATUS_REJECTED: &str = "rejected";
pub const STATUS_CHANGES_REQUESTED: &str = "changes_requested";
pub const STATUS_EXPIRED: &str = "expired";
pub const STATUS_INTERRUPTED: &str = "interrupted";

pub const EXECUTION_QUEUED: &str = "queued";
pub const EXECUTION_RUNNING: &str = "running";
pub const EXECUTION_COMPLETED: &str = "completed";
pub const EXECUTION_INTERRUPTED: &str = "interrupted";

/// Approval kinds (D198). Plan and Goal share this pipeline; the kind decides
/// the operating mode that owns the approval and the artifact directory.
pub const KIND_PLAN: &str = "plan";
pub const KIND_GOAL: &str = "goal";

pub const WORKSPACE_KIND_PROJECT: &str = "project";
pub const WORKSPACE_KIND_SCRATCH: &str = "scratch";

pub fn normalize_workspace_kind(value: &str) -> Option<&'static str> {
    match value {
        WORKSPACE_KIND_PROJECT => Some(WORKSPACE_KIND_PROJECT),
        WORKSPACE_KIND_SCRATCH => Some(WORKSPACE_KIND_SCRATCH),
        _ => None,
    }
}

/// Map a wire kind onto a `'static` literal so SQL and paths can never carry
/// caller-controlled text.
pub fn normalize_kind(value: &str) -> Option<&'static str> {
    match value {
        KIND_PLAN => Some(KIND_PLAN),
        KIND_GOAL => Some(KIND_GOAL),
        _ => None,
    }
}

/// The approval kind a session's durable mode submits, if any.
pub fn kind_for_mode(mode: &str) -> Option<&'static str> {
    normalize_kind(mode)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanArtifact {
    pub relative_path: String,
    pub sha256: String,
    pub size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanProposal {
    pub id: String,
    pub session_id: String,
    pub turn_id: String,
    pub tool_call_id: String,
    /// `plan` or `goal`; legacy rows read back as `plan`.
    pub kind: String,
    pub plan: String,
    pub markdown: String,
    pub title: String,
    pub question: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_permission_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact: Option<PlanArtifact>,
    pub version: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planning_provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planning_model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_for: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_timezone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_kind: Option<String>,
    pub revision_intent: Option<PlanRevisionIntent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanRevisionIntentInput {
    pub content: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub thinking_level: String,
    pub target_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft: Option<PlanRevisionDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanRevisionDraft {
    pub text: String,
    pub file_references: Vec<PlanRevisionDraftFileReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanRevisionDraftFileReference {
    pub path: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanRevisionIntent {
    #[serde(flatten)]
    pub input: PlanRevisionIntentInput,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanExecution {
    pub id: String,
    pub proposal_id: String,
    pub session_id: String,
    /// `plan` or `goal`; selects the execution instruction in the sidecar.
    /// `plan` or `goal`; selects the execution instruction in the sidecar.
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_kind: Option<String>,
    pub plan: String,
    pub title: String,
    pub question: String,
    pub artifact: PlanArtifact,
    pub target_permission_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_model_id: Option<String>,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanResolution {
    pub status: String,
    pub proposal: PlanProposal,
    pub action: Option<String>,
    pub target_permission_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution: Option<PlanExecution>,
}

#[derive(Debug, Default)]
pub struct PlanManager;

pub struct PlanSubmitParams<'a> {
    pub workspace_root: &'a Path,
    pub session_id: &'a str,
    pub turn_id: &'a str,
    pub tool_call_id: &'a str,
    /// Contract kind being submitted; must match the session's durable mode.
    pub kind: &'a str,
    pub title: &'a str,
    pub markdown: &'a str,
    pub question: &'a str,
    pub artifact_workspace_kind: &'a str,
}

pub struct PlanResolveParams<'a> {
    pub workspace_root: Option<&'a Path>,
    pub proposal_id: &'a str,
    pub session_id: &'a str,
    pub turn_id: &'a str,
    pub tool_call_id: &'a str,
    pub version: Option<i64>,
    pub action: &'a str,
    pub target_permission_mode: Option<&'a str>,
}

#[derive(Debug, Default)]
pub struct PlanResolveOptions<'a> {
    pub execution_provider_id: Option<&'a str>,
    pub execution_model_id: Option<&'a str>,
    pub scheduled_for: Option<&'a str>,
    pub schedule_timezone: Option<&'a str>,
    pub revision_intent: Option<&'a Value>,
    pub execution_kind: Option<&'a str>,
}
