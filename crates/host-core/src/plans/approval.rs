use super::*;

pub(crate) fn plan_error(code: &str) -> anyhow::Error {
    anyhow!(code.to_string())
}

fn valid_permission_mode(value: &str) -> bool {
    matches!(value, "ask" | "accept-edits" | "auto")
}

fn valid_revision_draft(draft: &PlanRevisionDraft) -> bool {
    draft.text.len() <= PLAN_REVISION_DRAFT_MAX_TEXT_BYTES
        && draft.file_references.len() <= PLAN_REVISION_DRAFT_MAX_REFERENCES
        && draft.file_references.iter().all(|reference| {
            !reference.path.trim().is_empty()
                && reference.path.len() <= PLAN_REVISION_DRAFT_MAX_PATH_BYTES
                && !reference.name.trim().is_empty()
                && reference.name.len() <= PLAN_REVISION_DRAFT_MAX_NAME_BYTES
                && reference
                    .kind
                    .as_deref()
                    .is_none_or(|kind| matches!(kind, "image" | "file"))
                && reference
                    .mime_type
                    .as_deref()
                    .is_none_or(|mime| mime.len() <= PLAN_REVISION_DRAFT_MAX_MIME_TYPE_BYTES)
                && reference
                    .token
                    .as_deref()
                    .is_none_or(|token| token.len() <= PLAN_REVISION_DRAFT_MAX_TOKEN_BYTES)
        })
}

/// Expire approvals at the first read or mutation boundary that observes
/// them. The state transition and audit record share one transaction so a
/// timed-out approval can never remain actionable after its error is visible.
pub fn expire_pending_approvals(db: &Database) -> Result<()> {
    let now = now_ms();
    let tx = db.conn().unchecked_transaction()?;
    let expired: Vec<(String, String, String, String)> = {
        let mut stmt = tx.prepare_cached(
            "SELECT request_id, session_id, turn_id, tool_call_id
             FROM plan_approvals
             WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?1",
        )?;
        let rows = stmt.query_map(params![now], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    tx.execute(
        "UPDATE plan_approvals
         SET status = 'expired', resolved_at = ?1, updated_at = ?1,
             error_code = 'PLAN_APPROVAL_TIMEOUT', version = version + 1
         WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?1",
        params![now],
    )?;
    for (proposal_id, session_id, turn_id, tool_call_id) in expired {
        audit::append_tx(
            &tx,
            "plan_approval_expired",
            Some(&session_id),
            json!({
                "proposalId": proposal_id,
                "sessionId": session_id,
                "turnId": turn_id,
                "toolCallId": tool_call_id,
                "status": STATUS_EXPIRED,
                "errorCode": "PLAN_APPROVAL_TIMEOUT"
            }),
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn gate_session_configure(
    db: &Database,
    session_id: &str,
    requested_mode: &str,
    requested_provider_id: Option<&str>,
    requested_model_id: Option<&str>,
    requested_thinking_level: Option<&str>,
    requested_permission_mode: Option<&str>,
) -> Result<()> {
    expire_pending_approvals(db)?;
    let Some((
        current_mode,
        current_provider_id,
        current_model_id,
        current_thinking_level,
        current_permission_mode,
    )) = db
        .conn()
        .query_row(
            "SELECT mode, provider_id, model_id, thinking_level, permission_mode
             FROM sessions WHERE id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?
    else {
        return Ok(());
    };
    let requested_mode = sessions::normalize_mode(Some(requested_mode));
    let mode_changes = current_mode != requested_mode;
    let provider_changes = requested_provider_id
        .is_some_and(|provider| current_provider_id.as_deref() != Some(provider));
    let model_changes =
        requested_model_id.is_some_and(|model| current_model_id.as_deref() != Some(model));
    let thinking_changes =
        requested_thinking_level.is_some_and(|level| level != current_thinking_level);
    let permission_changes =
        requested_permission_mode.is_some_and(|permission| permission != current_permission_mode);
    if !mode_changes
        && !provider_changes
        && !model_changes
        && !thinking_changes
        && !permission_changes
    {
        return Ok(());
    }
    let blocked: bool = db.conn().query_row(
        "SELECT EXISTS(
             SELECT 1 FROM plan_approvals
             WHERE session_id = ?1 AND status = 'pending' AND ?2
          ) OR EXISTS(
              SELECT 1 FROM plan_approvals
              WHERE session_id = ?1 AND execution_state IN ('queued', 'running')
          ) OR EXISTS(
              SELECT 1 FROM turns
              WHERE session_id = ?1 AND status = 'running'
          )",
        params![session_id, mode_changes || permission_changes],
        |row| row.get(0),
    )?;
    if blocked {
        return Err(plan_error("PLAN_CONFIGURATION_BLOCKED"));
    }
    Ok(())
}

impl PlanManager {
    pub fn enter(
        &self,
        db: &Database,
        session_id: &str,
        turn_id: &str,
        tool_call_id: &str,
        kind: &str,
    ) -> Result<()> {
        if session_id.trim().is_empty()
            || turn_id.trim().is_empty()
            || tool_call_id.trim().is_empty()
        {
            return Err(plan_error("PLAN_INVALID_ARGUMENT"));
        }
        let Some(kind) = normalize_kind(kind) else {
            return Err(plan_error("PLAN_INVALID_ARGUMENT"));
        };
        let Some(mode) = sessions::session_mode(db, session_id)? else {
            return Err(plan_error("PLAN_SESSION_NOT_FOUND"));
        };
        if mode != "agent" {
            return Err(plan_error("PLAN_ALREADY_ACTIVE"));
        }
        let now = now_ms();
        let tx = db.conn().unchecked_transaction()?;
        let changed = tx
            .prepare_cached(
                "UPDATE sessions SET mode = ?4, updated_at = ?1
             WHERE id = ?2 AND mode = 'agent'
               AND EXISTS (
                 SELECT 1 FROM turns
                 WHERE id = ?3 AND session_id = ?2 AND status = 'running'
               )
               AND NOT EXISTS (
                 SELECT 1 FROM plan_approvals
                 WHERE session_id = ?2 AND execution_state IN ('queued', 'running')
               )",
            )?
            .execute(params![now, session_id, turn_id, kind])?;
        if changed == 0 {
            return Err(plan_error("PLAN_APPROVAL_STALE"));
        }
        audit::append_tx(
            &tx,
            "plan_entered",
            Some(session_id),
            json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "toolCallId": tool_call_id,
                "kind": kind,
                "mode": kind
            }),
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn submit(&self, db: &Database, params: PlanSubmitParams<'_>) -> Result<PlanProposal> {
        let PlanSubmitParams {
            workspace_root,
            session_id,
            turn_id,
            tool_call_id,
            kind,
            title,
            markdown,
            question,
            artifact_workspace_kind,
        } = params;
        if session_id.trim().is_empty()
            || turn_id.trim().is_empty()
            || tool_call_id.trim().is_empty()
            || title.trim().is_empty()
            || markdown.trim().is_empty()
            || question.trim().is_empty()
        {
            return Err(plan_error("PLAN_INVALID_ARGUMENT"));
        }
        let Some(kind) = normalize_kind(kind) else {
            return Err(plan_error("PLAN_INVALID_ARGUMENT"));
        };
        let Some(artifact_workspace_kind) = normalize_workspace_kind(artifact_workspace_kind)
        else {
            return Err(plan_error("PLAN_INVALID_ARGUMENT"));
        };
        if markdown.len() > PLAN_MAX_MARKDOWN_BYTES {
            return Err(plan_error("PLAN_MARKDOWN_TOO_LARGE"));
        }
        expire_pending_approvals(db)?;
        // Agent mode has no contract to submit; the other contract mode does,
        // but not this one — those are different failures for the model.
        match session_submit_kind(db, session_id)? {
            None => return Err(plan_error("PLAN_NOT_ACTIVE")),
            Some(active) if active != kind => return Err(plan_error("PLAN_KIND_MISMATCH")),
            Some(_) => {}
        }
        if !live_turn_belongs_to_session(db, session_id, turn_id)? {
            return Err(plan_error("PLAN_APPROVAL_STALE"));
        }
        let has_pending: bool = db.conn().query_row(
            "SELECT EXISTS(
             SELECT 1 FROM plan_approvals
             WHERE session_id = ?1 AND status = 'pending'
         )",
            params![session_id],
            |row| row.get(0),
        )?;
        if has_pending {
            return Err(plan_error("PLAN_ALREADY_PENDING"));
        }

        let (mut artifact, path) = publish_artifact(workspace_root, kind, title, markdown)?;
        artifact.workspace_kind = Some(artifact_workspace_kind.to_string());
        let id = Uuid::new_v4().to_string();
        let now = now_ms();
        let insert_result = (|| -> Result<()> {
            let tx = db.conn().unchecked_transaction()?;
            tx.prepare_cached(
                "INSERT INTO plan_approvals (
                 request_id, session_id, turn_id, tool_call_id, kind, plan_json,
                 title, question, status, created_at, updated_at, expires_at,
                 artifact_relative_path, artifact_sha256, artifact_size_bytes,
                 version, artifact_workspace_kind
             ) VALUES (?1, ?2, ?3, ?4, ?13, ?5, ?6, ?7, 'pending', ?8, ?8,
                       ?9, ?10, ?11, ?12, 1, ?14)",
            )?
            .execute(params![
                id,
                session_id,
                turn_id,
                tool_call_id,
                markdown,
                title.trim(),
                question.trim(),
                now,
                now + PLAN_APPROVAL_TIMEOUT_MS,
                artifact.relative_path,
                artifact.sha256,
                artifact.size_bytes as i64,
                kind,
                artifact_workspace_kind,
            ])?;
            tx.execute(
                "UPDATE plan_approvals SET revision_state = 'submitted',
                 updated_at = ?1, version = version + 1
                 WHERE session_id = ?2 AND revision_turn_id = ?3 AND revision_state = 'started'",
                params![now, session_id, turn_id],
            )?;
            artifacts::record_tx(
                &tx,
                session_id,
                &artifact.relative_path,
                "write",
                Some(turn_id),
            )?;
            audit::append_tx(
                &tx,
                "plan_submitted",
                Some(session_id),
                json!({
                    "proposalId": id,
                    "sessionId": session_id,
                    "turnId": turn_id,
                    "toolCallId": tool_call_id,
                    "kind": kind,
                    "title": title.trim(),
                    "question": question.trim(),
                    "artifact": artifact,
                }),
            )?;
            tx.commit()?;
            Ok(())
        })();
        if let Err(error) = insert_result {
            let _ = fs::remove_file(path);
            return Err(error);
        }
        get_proposal(db, &id)?.ok_or_else(|| plan_error("PLAN_NOT_FOUND"))
    }

    pub fn pending_for_session(
        &self,
        db: &Database,
        session_id: Option<&str>,
    ) -> Result<Vec<PlanProposal>> {
        expire_pending_approvals(db)?;
        let sql = format!(
            "SELECT {PROPOSAL_COLUMNS}
         FROM plan_approvals
         WHERE status = 'pending'
           AND (?1 IS NULL OR session_id = ?1)
         ORDER BY created_at DESC"
        );
        let mut stmt = db.conn().prepare_cached(&sql)?;
        let rows = stmt.query_map(params![session_id], proposal_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn history_for_session(
        &self,
        db: &Database,
        session_id: &str,
    ) -> Result<Vec<PlanProposal>> {
        expire_pending_approvals(db)?;
        let sql = format!(
            "SELECT {PROPOSAL_COLUMNS} FROM plan_approvals
             WHERE session_id = ?1 ORDER BY created_at DESC LIMIT 100"
        );
        let mut stmt = db.conn().prepare_cached(&sql)?;
        let rows = stmt.query_map(params![session_id], proposal_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn state_for_session(&self, db: &Database, session_id: &str) -> Result<String> {
        expire_pending_approvals(db)?;
        let Some(mode) = sessions::session_mode(db, session_id)? else {
            return Err(plan_error("PLAN_SESSION_NOT_FOUND"));
        };
        if mode == "agent" {
            return Ok("inactive".into());
        }
        if !self.pending_for_session(db, Some(session_id))?.is_empty() {
            return Ok("awaiting_approval".into());
        }
        Ok("planning".into())
    }

    /// The contract kind the session is currently authoring (`plan`/`goal`), or
    /// `None` in Agent mode. Renderers need this to label a planning state.
    pub fn active_kind(&self, db: &Database, session_id: &str) -> Result<Option<&'static str>> {
        session_submit_kind(db, session_id)
    }

    #[cfg(test)]
    pub fn resolution_for(
        &self,
        db: &Database,
        proposal_id: &str,
    ) -> Result<Option<PlanResolution>> {
        expire_pending_approvals(db)?;
        let Some(proposal) = get_proposal(db, proposal_id)? else {
            return Ok(None);
        };
        if proposal.status == STATUS_PENDING {
            return Ok(None);
        }
        Ok(Some(resolution_from_proposal(proposal)?))
    }

    pub fn resolve(&self, db: &Database, params: PlanResolveParams<'_>) -> Result<PlanResolution> {
        self.resolve_with_options(db, params, PlanResolveOptions::default())
    }

    pub fn resolve_with_options(
        &self,
        db: &Database,
        params: PlanResolveParams<'_>,
        options: PlanResolveOptions<'_>,
    ) -> Result<PlanResolution> {
        let PlanResolveParams {
            workspace_root,
            proposal_id,
            session_id,
            turn_id,
            tool_call_id,
            version,
            action,
            target_permission_mode,
        } = params;
        expire_pending_approvals(db)?;
        let Some(current) = get_proposal(db, proposal_id)? else {
            return Err(plan_error("PLAN_NOT_FOUND"));
        };
        // The stored kind is authoritative: it decides both the artifact
        // directory to verify and the mode the approval must leave behind.
        let kind = normalize_kind(&current.kind).unwrap_or(KIND_PLAN);
        if current.session_id != session_id
            || current.turn_id != turn_id
            || current.tool_call_id != tool_call_id
        {
            return Err(plan_error("PLAN_APPROVAL_STALE"));
        }
        if !matches!(
            action,
            "approve" | "reject" | "request_changes" | "schedule"
        ) {
            return Err(plan_error("PLAN_INVALID_ACTION"));
        }
        if current.status == STATUS_EXPIRED {
            return Err(plan_error("PLAN_APPROVAL_TIMEOUT"));
        }
        let approving = matches!(action, "approve" | "schedule");
        let selected = if approving {
            let Some(selected) = target_permission_mode else {
                return Err(plan_error("PLAN_PERMISSION_MODE_REQUIRED"));
            };
            if !valid_permission_mode(selected) {
                return Err(plan_error("PLAN_PERMISSION_MODE_INVALID"));
            }
            Some(selected)
        } else {
            None
        };
        if current.status != STATUS_PENDING {
            let stored_action = if action == "schedule" {
                "approve"
            } else {
                action
            };
            let same_binding = (!approving
                || options
                    .execution_provider_id
                    .is_none_or(|value| current.execution_provider_id.as_deref() == Some(value)))
                && (!approving
                    || options
                        .execution_model_id
                        .is_none_or(|value| current.execution_model_id.as_deref() == Some(value)));
            let same_schedule = action != "schedule"
                || (current.schedule_state.is_some()
                    && current.schedule_timezone.as_deref() == options.schedule_timezone
                    && options
                        .scheduled_for
                        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                        .map(|value| value.timestamp_millis())
                        == current
                            .scheduled_for
                            .as_deref()
                            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                            .map(|value| value.timestamp_millis()));
            let same_revision = action != "request_changes"
                || options.revision_intent.is_none_or(|value| {
                    serde_json::from_value::<PlanRevisionIntentInput>(value.clone()).ok()
                        == current
                            .revision_intent
                            .as_ref()
                            .map(|intent| intent.input.clone())
                });
            let same_resolution = current.action.as_deref() == Some(stored_action)
                && (!approving || current.target_permission_mode.as_deref() == selected)
                && same_binding
                && same_schedule
                && same_revision;
            if same_resolution {
                return resolution_from_proposal(current);
            }
            return Err(plan_error("PLAN_APPROVAL_CONFLICT"));
        }
        if version.is_some_and(|version| version != current.version) {
            return Err(plan_error("PLAN_APPROVAL_STALE"));
        }

        if approving {
            let workspace_root =
                workspace_root.ok_or_else(|| plan_error("PLAN_WORKSPACE_REQUIRED"))?;
            let artifact = current
                .artifact
                .clone()
                .ok_or_else(|| plan_error("PLAN_ARTIFACT_NOT_READY"))?;
            verify_artifact(workspace_root, kind, &artifact)?;
        }
        let scheduled_at = if action == "schedule" {
            let instant = options
                .scheduled_for
                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                .ok_or_else(|| plan_error("PLAN_SCHEDULE_TIME_INVALID"))?
                .timestamp_millis();
            if instant <= now_ms() {
                return Err(plan_error("PLAN_SCHEDULE_TIME_PAST"));
            }
            let timezone = options.schedule_timezone.unwrap_or("").trim();
            if timezone.is_empty()
                || timezone.len() > 128
                || !timezone
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_+-./".contains(&byte))
            {
                return Err(plan_error("PLAN_SCHEDULE_TIMEZONE_INVALID"));
            }
            Some((instant, timezone))
        } else {
            None
        };
        let execution_provider_id = if approving {
            options
                .execution_provider_id
                .or(current.planning_provider_id.as_deref())
                .filter(|value| !value.trim().is_empty())
        } else {
            None
        };
        let execution_model_id = if approving {
            options
                .execution_model_id
                .or(current.planning_model_id.as_deref())
                .filter(|value| !value.trim().is_empty())
        } else {
            None
        };
        if action == "schedule" && (execution_provider_id.is_none() || execution_model_id.is_none())
        {
            return Err(plan_error("PLAN_EXECUTION_MODEL_REQUIRED"));
        }
        let revision_intent_json = if action == "request_changes" {
            options
                .revision_intent
                .map(|value| -> Result<String> {
                    let intent: PlanRevisionIntentInput = serde_json::from_value(value.clone())
                        .map_err(|_| plan_error("PLAN_REVISION_INVALID"))?;
                    if intent.content.trim().is_empty()
                        || intent.content.len() > PLAN_MAX_MARKDOWN_BYTES
                        || !matches!(
                            intent.thinking_level.as_str(),
                            "off"
                                | "minimal"
                                | "low"
                                | "medium"
                                | "high"
                                | "xhigh"
                                | "max"
                                | "omit"
                        )
                        || normalize_kind(&intent.target_kind).is_none()
                        || (kind == KIND_GOAL && intent.target_kind != KIND_GOAL)
                        || intent.provider_id.as_deref().unwrap_or("").is_empty()
                        || intent.model_id.as_deref().unwrap_or("").is_empty()
                        || intent
                            .draft
                            .as_ref()
                            .is_some_and(|draft| !valid_revision_draft(draft))
                    {
                        return Err(plan_error("PLAN_REVISION_INVALID"));
                    }
                    serde_json::to_string(&intent).map_err(Into::into)
                })
                .transpose()?
        } else {
            if options.revision_intent.is_some() {
                return Err(plan_error("PLAN_REVISION_INVALID"));
            }
            None
        };
        let now = now_ms();
        let status = match action {
            "approve" | "schedule" => STATUS_APPROVED,
            "request_changes" => STATUS_CHANGES_REQUESTED,
            _ => STATUS_REJECTED,
        };
        let stored_action = if action == "schedule" {
            "approve"
        } else {
            action
        };
        let execution_id = (action == "approve").then(|| Uuid::new_v4().to_string());
        let tx = db.conn().unchecked_transaction()?;
        if approving {
            let active_execution: bool = tx.query_row(
                "SELECT EXISTS(
                 SELECT 1 FROM plan_approvals
                 WHERE session_id = ?1 AND execution_state IN ('queued', 'running')
             )",
                params![session_id],
                |row| row.get(0),
            )?;
            if active_execution {
                return Err(plan_error("PLAN_EXECUTION_ACTIVE"));
            }
            let changed = tx
                .prepare_cached(
                    "UPDATE sessions
                 SET mode = 'agent', permission_mode = ?1, updated_at = ?2
                 WHERE id = ?3 AND mode = ?4",
                )?
                .execute(params![selected, now, session_id, kind])?;
            if changed == 0 {
                return Err(plan_error("PLAN_NOT_ACTIVE"));
            }
        }
        let changed = tx
            .prepare_cached(
                "UPDATE plan_approvals
              SET status = ?1, action = ?2, target_permission_mode = ?3,
                  resolved_at = ?4, updated_at = ?4,
                  error_code = NULL, version = version + 1,
                  execution_id = ?5, execution_state = ?6,
                  execution_provider_id = ?13, execution_model_id = ?14,
                  revision_intent_json = ?15, revision_state = ?16
              WHERE request_id = ?7 AND session_id = ?8 AND turn_id = ?9
                AND tool_call_id = ?10 AND status = 'pending' AND version = ?11
                 AND expires_at > ?12",
            )?
            .execute(params![
                status,
                stored_action,
                selected,
                now,
                execution_id,
                (action == "approve").then_some(EXECUTION_QUEUED),
                proposal_id,
                session_id,
                turn_id,
                tool_call_id,
                current.version,
                now,
                execution_provider_id,
                execution_model_id,
                revision_intent_json,
                revision_intent_json.as_ref().map(|_| "ready"),
            ])?;
        if changed != 1 {
            return Err(plan_error("PLAN_APPROVAL_STALE"));
        }
        if let Some((scheduled_for, timezone)) = scheduled_at {
            tx.execute(
                "INSERT INTO plan_execution_schedules
                 (proposal_id, scheduled_for, timezone, state, updated_at)
                 VALUES (?1, ?2, ?3, 'scheduled', ?4)",
                params![proposal_id, scheduled_for, timezone, now],
            )?;
        }
        audit::append_tx(
            &tx,
            "plan_approval_resolved",
            Some(session_id),
            json!({
                "proposalId": proposal_id,
                "sessionId": session_id,
                "turnId": turn_id,
                "toolCallId": tool_call_id,
                "kind": kind,
                "action": action,
                "status": status,
                "targetPermissionMode": selected,
                "executionId": execution_id,
                "executionState": (action == "approve").then_some(EXECUTION_QUEUED),
                "scheduledFor": scheduled_at.map(|(instant, _)| ms_to_ts(instant)),
                "revisionIntentStored": revision_intent_json.is_some(),
            }),
        )?;
        tx.commit()?;
        let proposal =
            get_proposal(db, proposal_id)?.ok_or_else(|| plan_error("PLAN_NOT_FOUND"))?;
        let mut resolution = resolution_from_proposal(proposal)?;
        if action == "schedule" {
            resolution.action = Some("schedule".to_string());
        }
        Ok(resolution)
    }

    pub fn begin_revision_turn(
        &self,
        db: &Database,
        proposal_id: &str,
        session_id: &str,
        content: &str,
        provider_id: &str,
        model_id: &str,
    ) -> Result<(String, bool)> {
        let tx = db.conn().unchecked_transaction()?;
        let proposal =
            get_proposal(db, proposal_id)?.ok_or_else(|| plan_error("PLAN_NOT_FOUND"))?;
        if proposal.session_id != session_id || proposal.status != STATUS_CHANGES_REQUESTED {
            return Err(plan_error("PLAN_REVISION_STALE"));
        }
        let intent = proposal
            .revision_intent
            .ok_or_else(|| plan_error("PLAN_REVISION_NOT_FOUND"))?;
        if intent.input.content != content
            || intent.input.provider_id.as_deref() != Some(provider_id)
            || intent.input.model_id.as_deref() != Some(model_id)
            || sessions::session_mode(db, session_id)?.as_deref()
                != Some(intent.input.target_kind.as_str())
        {
            return Err(plan_error("PLAN_REVISION_STALE"));
        }
        if intent.state == "started" || intent.state == "submitted" {
            let turn_id = intent
                .turn_id
                .ok_or_else(|| plan_error("PLAN_REVISION_STALE"))?;
            tx.commit()?;
            return Ok((turn_id, true));
        }
        if intent.state != "ready" && intent.state != "failed" {
            return Err(plan_error("PLAN_REVISION_STALE"));
        }
        let turn_id = sessions::begin_turn(db, session_id, Some(provider_id), Some(model_id))?;
        let updated = tx.execute(
            "UPDATE plan_approvals SET revision_state = 'started', revision_turn_id = ?1,
             revision_error_code = NULL, updated_at = ?2, version = version + 1
             WHERE request_id = ?3 AND revision_state IN ('ready', 'failed')",
            params![turn_id, now_ms(), proposal_id],
        )?;
        if updated != 1 {
            return Err(plan_error("PLAN_REVISION_STALE"));
        }
        tx.commit()?;
        Ok((turn_id, false))
    }

    pub fn mark_revision_failed(
        &self,
        db: &Database,
        proposal_id: &str,
        session_id: &str,
        error_code: &str,
    ) -> Result<bool> {
        let error_code = error_code.trim();
        if error_code.is_empty() || error_code.len() > 128 {
            return Err(plan_error("PLAN_REVISION_INVALID"));
        }
        let changed = db.conn().execute(
            "UPDATE plan_approvals SET revision_state = 'failed', revision_error_code = ?1,
             updated_at = ?2, version = version + 1
             WHERE request_id = ?3 AND session_id = ?4
               AND revision_state IN ('ready', 'started')
               AND NOT EXISTS (SELECT 1 FROM turns
                 WHERE id = plan_approvals.revision_turn_id AND status = 'running')",
            params![error_code, now_ms(), proposal_id, session_id],
        )?;
        Ok(changed == 1)
    }

    pub fn finish_revision_turn(
        &self,
        db: &Database,
        turn_id: &str,
        error_code: &str,
    ) -> Result<Option<PlanProposal>> {
        let proposal_id: Option<String> = db
            .conn()
            .query_row(
                "UPDATE plan_approvals
             SET revision_state = 'failed', revision_error_code = ?1,
                 updated_at = ?2, version = version + 1
             WHERE revision_turn_id = ?3 AND revision_state = 'started'
               AND EXISTS (SELECT 1 FROM turns WHERE id = ?3 AND status != 'running')
             RETURNING request_id",
                params![error_code, now_ms(), turn_id],
                |row| row.get(0),
            )
            .optional()?;
        proposal_id
            .map(|id| get_proposal(db, &id))
            .transpose()
            .map(Option::flatten)
    }

    pub fn abort_session(&self, db: &Database, session_id: &str) -> Result<bool> {
        expire_pending_approvals(db)?;
        let ids: Vec<String> = {
            let mut stmt = db.conn().prepare_cached(
                "SELECT request_id FROM plan_approvals
             WHERE session_id = ?1 AND status = 'pending'",
            )?;
            let rows = stmt.query_map(params![session_id], |row| row.get(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        if ids.is_empty() {
            return Ok(false);
        }
        let now = now_ms();
        let tx = db.conn().unchecked_transaction()?;
        for id in &ids {
            let changed = tx
                .prepare_cached(
                    "UPDATE plan_approvals
                 SET status = 'interrupted', resolved_at = ?1, updated_at = ?1,
                     error_code = 'PLAN_APPROVAL_INTERRUPTED', version = version + 1
                 WHERE request_id = ?2 AND status = 'pending'",
                )?
                .execute(params![now, id])?;
            if changed == 1 {
                let session_id_for_audit: String = tx.query_row(
                    "SELECT session_id FROM plan_approvals WHERE request_id = ?1",
                    params![id],
                    |row| row.get(0),
                )?;
                audit::append_tx(
                    &tx,
                    "plan_approval_terminal",
                    Some(&session_id_for_audit),
                    json!({
                        "proposalId": id,
                        "status": STATUS_INTERRUPTED,
                        "errorCode": "PLAN_APPROVAL_INTERRUPTED"
                    }),
                )?;
            }
        }
        tx.commit()?;
        Ok(true)
    }
}
