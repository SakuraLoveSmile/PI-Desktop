//! User/project expert defaults and immutable member launch snapshots.
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

use super::model::{TeamMember, TeamMemberSelectionPartial};
use crate::{db::Database, sessions};

pub const CONFIGURABLE_TOOLS: &[&str] = &[
    "Read",
    "Glob",
    "Grep",
    "BrowserPreview",
    "Bash",
    "Edit",
    "Write",
];

pub const MEMBER_CONFIG_NS: &str = "team-member-expert-config-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum ExpertTeamPresetId {
    Researcher,
    Fullstack,
    Qa,
    Reviewer,
    Ui,
    Debugger,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExpertTeamRoleConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_level: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExpertTeamSettings {
    pub schema_version: u32,
    pub user_defaults: BTreeMap<ExpertTeamPresetId, ExpertTeamRoleConfig>,
    pub project_overrides: BTreeMap<String, BTreeMap<ExpertTeamPresetId, ExpertTeamRoleConfig>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExpertTeamConfigSnapshot {
    pub preset_id: ExpertTeamPresetId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
}

fn valid_id(value: &str, limit: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= limit
}

fn validate_role(config: &ExpertTeamRoleConfig) -> Result<()> {
    if config.provider_id.is_some() != config.model_id.is_some()
        || config
            .provider_id
            .as_ref()
            .is_some_and(|id| !valid_id(id, 128))
        || config
            .model_id
            .as_ref()
            .is_some_and(|id| !valid_id(id, 256))
    {
        return Err(anyhow!(
            "INVALID_PARAMS: expert provider/model must be a nonempty pair"
        ));
    }
    if let Some(level) = &config.thinking_level {
        sessions::validate_thinking_level(level)?;
    }
    if config
        .instructions
        .as_ref()
        .is_some_and(|text| text.chars().count() > 16000)
    {
        return Err(anyhow!(
            "INVALID_PARAMS: expert instructions exceed 16000 characters"
        ));
    }
    if let Some(tools) = &config.tools {
        let unique: std::collections::BTreeSet<_> = tools.iter().collect();
        if tools.len() > 256
            || unique.len() != tools.len()
            || tools
                .iter()
                .any(|name| !CONFIGURABLE_TOOLS.contains(&name.as_str()))
        {
            return Err(anyhow!("INVALID_PARAMS: invalid expert tool selection"));
        }
    }
    Ok(())
}

pub fn parse(value: &Value) -> Result<ExpertTeamSettings> {
    // Optional means absent, not null; this matches the renderer contract and
    // avoids silently interpreting malformed explicit values as inheritance.
    let user_roles = value.get("userDefaults").and_then(Value::as_object);
    let project_roles = value.get("projectOverrides").and_then(Value::as_object);
    for role in user_roles
        .into_iter()
        .flat_map(|roles| roles.values())
        .chain(
            project_roles
                .into_iter()
                .flat_map(|scopes| scopes.values())
                .filter_map(Value::as_object)
                .flat_map(|roles| roles.values()),
        )
    {
        if role
            .as_object()
            .is_some_and(|fields| fields.values().any(Value::is_null))
        {
            return Err(anyhow!(
                "INVALID_PARAMS: expert role fields must be omitted to inherit"
            ));
        }
    }
    let settings: ExpertTeamSettings = serde_json::from_value(value.clone())
        .map_err(|_| anyhow!("INVALID_PARAMS: invalid expertTeam settings"))?;
    if settings.schema_version != 1 || settings.project_overrides.len() > 1024 {
        return Err(anyhow!(
            "INVALID_PARAMS: invalid expertTeam schema version or scopes"
        ));
    }
    for (path, roles) in &settings.project_overrides {
        if !valid_id(path, 4096) {
            return Err(anyhow!("INVALID_PARAMS: invalid expert project scope"));
        }
        for role in roles.values() {
            validate_role(role)?;
        }
    }
    for role in settings.user_defaults.values() {
        validate_role(role)?;
    }
    Ok(settings)
}

/// Check newly selected references while preserving unchanged historical defaults.
/// A disabled provider or removed project must not block unrelated settings writes;
/// launching a new member still validates its resolved route independently.
pub fn validate_settings(db: &Database, value: &Value) -> Result<()> {
    let settings = parse(value)?;
    let old_app = db.get_setting("app")?;
    let old = old_app
        .as_ref()
        .and_then(|app| app.get("expertTeam"))
        .map(parse)
        .transpose()?;
    let projects = db.list_projects()?;
    for path in settings.project_overrides.keys() {
        let existed = old
            .as_ref()
            .is_some_and(|old| old.project_overrides.contains_key(path));
        if !existed && !projects.iter().any(|project| &project.path == path) {
            return Err(anyhow!(
                "INVALID_PARAMS: expert project scope is not in the Host catalog"
            ));
        }
    }
    for (preset, role) in &settings.user_defaults {
        let previous = old.as_ref().and_then(|old| old.user_defaults.get(preset));
        validate_changed_route(db, role, previous)?;
    }
    // Compare effective inherited pairs, not just raw override fields, so a
    // changed user default cannot silently create an unsupported project route.
    for (path, roles) in &settings.project_overrides {
        for (preset, project_role) in roles {
            let effective = merge(settings.user_defaults.get(preset), Some(project_role));
            let previous = old.as_ref().map(|old| {
                merge(
                    old.user_defaults.get(preset),
                    old.project_overrides
                        .get(path)
                        .and_then(|roles| roles.get(preset)),
                )
            });
            validate_changed_route(db, &effective, previous.as_ref())?;
        }
    }
    Ok(())
}

fn validate_changed_route(
    db: &Database,
    role: &ExpertTeamRoleConfig,
    old: Option<&ExpertTeamRoleConfig>,
) -> Result<()> {
    let unchanged = old.is_some_and(|old| {
        old.provider_id == role.provider_id
            && old.model_id == role.model_id
            && old.thinking_level == role.thinking_level
    });
    if !unchanged {
        if let (Some(provider), Some(model)) = (&role.provider_id, &role.model_id) {
            super::review::validate_member_route(
                db,
                provider,
                model,
                role.thinking_level.as_deref().unwrap_or("off"),
            )?;
        }
    }
    Ok(())
}

fn merge(
    user: Option<&ExpertTeamRoleConfig>,
    project: Option<&ExpertTeamRoleConfig>,
) -> ExpertTeamRoleConfig {
    let mut effective = user.cloned().unwrap_or_default();
    if let Some(project) = project {
        if project.provider_id.is_some() {
            effective.provider_id = project.provider_id.clone();
            effective.model_id = project.model_id.clone();
        }
        if project.thinking_level.is_some() {
            effective.thinking_level = project.thinking_level.clone();
        }
        if project.tools.is_some() {
            effective.tools = project.tools.clone();
        }
        if project.instructions.is_some() {
            effective.instructions = project.instructions.clone();
        }
    }
    effective
}

pub fn resolve(
    db: &Database,
    team: &str,
    preset: &ExpertTeamPresetId,
) -> Result<ExpertTeamRoleConfig> {
    let app = db
        .get_setting("app")?
        .unwrap_or_else(|| serde_json::json!({}));
    let Some(value) = app.get("expertTeam") else {
        return Ok(ExpertTeamRoleConfig::default());
    };
    let settings = parse(value)?;
    let session = sessions::get_session(db, team)?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: lead session not found"))?;
    let project = session
        .summary
        .project_path
        .as_ref()
        .and_then(|path| settings.project_overrides.get(path))
        .and_then(|roles| roles.get(preset));
    Ok(merge(settings.user_defaults.get(preset), project))
}

pub fn member_snapshot(db: &Database, member: &str) -> Result<Option<ExpertTeamConfigSnapshot>> {
    db.kv_get(MEMBER_CONFIG_NS, member)?
        .map(serde_json::from_value)
        .transpose()
        .map_err(Into::into)
}

/// Resolve a new expert's settings or retain an existing member's approved policy.
/// Defaults are captured at declaration; reused sessions keep their confirmed route.
pub(super) fn resolve_launch_config(
    db: &Database,
    team: &str,
    preset_id: Option<&ExpertTeamPresetId>,
    selection: Option<TeamMemberSelectionPartial>,
    reused_member: Option<&TeamMember>,
) -> Result<(TeamMemberSelectionPartial, Option<ExpertTeamConfigSnapshot>)> {
    let existing_config = reused_member
        .map(|member| member_snapshot(db, &member.member_session_id))
        .transpose()?
        .flatten();
    if let (Some(requested), Some(existing)) = (preset_id, &existing_config) {
        if requested != &existing.preset_id {
            return Err(anyhow!(
                "TEAM_MODEL_SELECTION_INVALID: an existing member's expert preset is immutable"
            ));
        }
    }
    // Existing members keep their approved snapshot; defaults apply only to
    // new members and are never a live link from settings to a session.
    let role_config = if reused_member.is_none() {
        preset_id
            .map(|preset| resolve(db, team, preset))
            .transpose()?
    } else {
        None
    };
    let expert_config = if reused_member.is_some() {
        existing_config
    } else {
        preset_id.map(|preset| ExpertTeamConfigSnapshot {
            preset_id: preset.clone(),
            tools: role_config.as_ref().and_then(|config| config.tools.clone()),
            instructions: role_config
                .as_ref()
                .and_then(|config| config.instructions.clone()),
        })
    };
    let mut sel = selection.unwrap_or_default();
    if sel.provider_id.is_some() != sel.model_id.is_some() {
        return Err(anyhow!(
            "TEAM_MODEL_SELECTION_INVALID: provider and model overrides must be supplied together"
        ));
    }
    if let Some(config) = role_config {
        if config.provider_id.is_some() {
            sel.provider_id = config.provider_id;
            sel.model_id = config.model_id;
        }
        if config.thinking_level.is_some() {
            sel.thinking_level = config.thinking_level;
        }
    }
    if let Some(member) = reused_member.filter(|_| expert_config.is_some()) {
        let summary = sessions::get_session(db, &member.member_session_id)?
            .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: reused member session not found"))?
            .summary;
        sel.provider_id = Some(summary.provider_id.ok_or_else(|| {
            anyhow!("TEAM_MODEL_SELECTION_INVALID: confirmed expert provider is missing")
        })?);
        sel.model_id = Some(summary.model_id.ok_or_else(|| {
            anyhow!("TEAM_MODEL_SELECTION_INVALID: confirmed expert model is missing")
        })?);
        sel.thinking_level = Some(summary.thinking_level);
    }
    if sel.provider_id.is_some() != sel.model_id.is_some() {
        return Err(anyhow!(
            "TEAM_MODEL_SELECTION_INVALID: provider and model overrides must be supplied together"
        ));
    }
    Ok((sel, expert_config))
}

/// Narrow a member's tool surface without changing any other permission gate.
pub fn validate_tool(db: &Database, session: &str, tool: &str) -> Result<()> {
    let Some(config) = member_snapshot(db, session)? else {
        return Ok(());
    };
    let Some(allowed) = config.tools else {
        return Ok(());
    };
    const REQUIRED: &[&str] = &[
        "send_message",
        "wait_for_updates",
        "task_create",
        "task_update",
        "task_list",
        "task_get",
        "team_status",
        "submit_research_result",
        "SubmitGoalReport",
        "UpdateGoalProgress",
        "asktool",
        "new_context",
        "EnterPlanMode",
        "EnterGoalMode",
        "SubmitPlan",
        "SubmitGoal",
        "ToolSearch",
    ];
    if REQUIRED.contains(&tool)
        || (CONFIGURABLE_TOOLS.contains(&tool) && allowed.iter().any(|name| name == tool))
    {
        return Ok(());
    }
    Err(anyhow!(
        "TEAM_UNAUTHORIZED: tool is disabled by the confirmed expert configuration"
    ))
}
