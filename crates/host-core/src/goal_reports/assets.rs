use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub const MAX_SCREENSHOTS_PER_REPORT: usize = 12;
pub const MAX_ASSET_BYTES: usize = 8 * 1024 * 1024; // 8 MiB
pub const MAX_TOTAL_ASSET_BYTES: usize = 32 * 1024 * 1024; // 32 MiB
pub const MAX_CHUNK_LENGTH: usize = 256 * 1024; // 256 KiB

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoalReportAsset {
    pub screenshot_id: String,
    pub asset_id: String,
    pub evidence_id: String,
    pub relative_path: String,
    pub mime_type: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoalReportAssetChunk {
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eof: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

pub fn assets_dir(data_dir: &Path, session_id: &str, execution_id: &str) -> PathBuf {
    data_dir
        .join("goal_reports")
        .join(session_id)
        .join("assets")
        .join(execution_id)
}

fn detect_image_type(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("image/png", "png"))
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

fn find_candidate_file(data_dir: &Path, session_id: &str, ref_id: &str) -> Option<PathBuf> {
    let trimmed = ref_id.trim();
    if trimmed.is_empty() || Path::new(trimmed).is_absolute() {
        return None;
    }

    let is_safe_relative = |value: &str| {
        let path = Path::new(value);
        path.components()
            .all(|component| matches!(component, std::path::Component::Normal(_)))
    };
    let canonical_data_dir = fs::canonicalize(data_dir).ok()?;
    let canonical_file_under = |root: &Path, relative: &str| {
        if !is_safe_relative(relative) {
            return None;
        }
        let canonical_root = fs::canonicalize(root).ok()?;
        if !canonical_root.starts_with(&canonical_data_dir) {
            return None;
        }
        let candidate = fs::canonicalize(root.join(relative)).ok()?;
        candidate.starts_with(&canonical_root).then_some(candidate)
    };
    let attachment_ref = trimmed
        .strip_prefix("attachments/")
        .map(|_| trimmed.to_string());
    let session_owns_attachment = attachment_ref.as_deref().is_some_and(|wanted| {
        crate::transcripts::read_transcript(data_dir, session_id)
            .ok()
            .into_iter()
            .flatten()
            .flat_map(|record| record.blocks.as_array().cloned().unwrap_or_default())
            .any(|block| {
                block.get("type").and_then(Value::as_str) == Some("attachment")
                    && block.get("ref").and_then(Value::as_str) == Some(wanted)
            })
    });

    // 1. Check direct attachments folder: data_dir/attachments/<hash>
    if session_owns_attachment {
        let att_dir = data_dir.join("attachments");
        if let Some(candidate) = canonical_file_under(&att_dir, trimmed).filter(|p| p.is_file()) {
            return Some(candidate);
        }
        // Check if refId has prefix "attachments/"
        if let Some(stripped) = trimmed.strip_prefix("attachments/") {
            if let Some(candidate) =
                canonical_file_under(&att_dir, stripped).filter(|p| p.is_file())
            {
                return Some(candidate);
            }
        }
    }

    // 2. Check session scratch directory: data_dir/scratch/<session_id>/...
    if let Some(scratch_dir) = crate::scratch::session_dir(data_dir, session_id) {
        if let Some(candidate) = canonical_file_under(&scratch_dir, trimmed).filter(|p| p.is_file())
        {
            return Some(candidate);
        }
    }

    // 3. Check goal_reports staging/assets
    let session_reports_dir = data_dir.join("goal_reports").join(session_id);
    if let Some(candidate) =
        canonical_file_under(&session_reports_dir, trimmed).filter(|p| p.is_file())
    {
        return Some(candidate);
    }

    None
}

/// Resolves screenshot references to valid image files, copies them to the
/// report-owned assets directory, and returns the assets manifest plus any limitations.
pub fn resolve_and_save_assets(
    data_dir: &Path,
    session_id: &str,
    execution_id: &str,
    draft: &Value,
) -> (Vec<GoalReportAsset>, Vec<String>) {
    let mut assets = Vec::new();
    let mut warnings = Vec::new();

    let Some(screenshots) = draft.get("screenshots").and_then(Value::as_array) else {
        return (assets, warnings);
    };

    let evidences = draft.get("evidences").and_then(Value::as_array);
    let target_dir = assets_dir(data_dir, session_id, execution_id);

    let mut total_bytes = 0usize;

    for (idx, sc) in screenshots.iter().enumerate() {
        if idx >= MAX_SCREENSHOTS_PER_REPORT {
            warnings.push(format!(
                "Screenshot limit ({MAX_SCREENSHOTS_PER_REPORT}) reached; skipping remaining screenshots."
            ));
            break;
        }

        let Some(sc_id) = sc.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(ev_ref) = sc.get("evidenceRef").and_then(Value::as_str) else {
            continue;
        };

        // Find the evidence matching evidenceRef
        let matching_evidence = evidences.and_then(|evs| {
            evs.iter()
                .find(|ev| ev.get("id").and_then(Value::as_str) == Some(ev_ref))
        });

        let ref_id = matching_evidence
            .and_then(|ev| ev.get("refId").and_then(Value::as_str))
            .unwrap_or(ev_ref);

        let candidate_path = find_candidate_file(data_dir, session_id, ref_id);
        let Some(source_file) = candidate_path else {
            warnings.push(format!(
                "Screenshot '{sc_id}' (ref: {ev_ref}) was unavailable on disk."
            ));
            continue;
        };

        let file_bytes = match File::open(&source_file).and_then(|file| {
            let size = file.metadata()?.len();
            if size > MAX_ASSET_BYTES as u64 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::FileTooLarge,
                    format!("asset is {size} bytes"),
                ));
            }
            let mut bytes = Vec::with_capacity(size as usize);
            file.take((MAX_ASSET_BYTES + 1) as u64)
                .read_to_end(&mut bytes)?;
            Ok(bytes)
        }) {
            Ok(b) => b,
            Err(e) => {
                warnings.push(format!("Screenshot '{sc_id}' could not be read: {e}"));
                continue;
            }
        };

        if file_bytes.len() > MAX_ASSET_BYTES {
            warnings.push(format!(
                "Screenshot '{sc_id}' exceeds maximum image limit of 8 MiB ({} bytes).",
                file_bytes.len()
            ));
            continue;
        }

        if total_bytes + file_bytes.len() > MAX_TOTAL_ASSET_BYTES {
            warnings.push(format!(
                "Total screenshot asset limit of 32 MiB reached; skipping '{sc_id}'."
            ));
            continue;
        }

        let Some((mime_type, ext)) = detect_image_type(&file_bytes) else {
            warnings.push(format!(
                "Screenshot '{sc_id}' is not a recognized PNG, JPEG, or WebP image."
            ));
            continue;
        };

        let asset_id = format!("ast-{}", Uuid::new_v4().simple());
        let filename = format!("{asset_id}.{ext}");
        let asset_path = target_dir.join(&filename);

        if let Err(e) = fs::create_dir_all(&target_dir) {
            warnings.push(format!("Could not create assets directory: {e}"));
            continue;
        }

        if let Err(e) = fs::write(&asset_path, &file_bytes) {
            warnings.push(format!("Could not write asset file '{filename}': {e}"));
            continue;
        }

        let mut hasher = Sha256::new();
        hasher.update(&file_bytes);
        let sha256 = hex::encode(hasher.finalize());

        let rel_path = format!("goal_reports/{session_id}/assets/{execution_id}/{filename}");
        let size = file_bytes.len() as u64;
        total_bytes += file_bytes.len();

        assets.push(GoalReportAsset {
            screenshot_id: sc_id.to_string(),
            asset_id,
            evidence_id: ev_ref.to_string(),
            relative_path: rel_path,
            mime_type: mime_type.to_string(),
            bytes: size,
            sha256,
        });
    }

    (assets, warnings)
}

/// Reads a chunk of a report screenshot asset for local and remote streaming.
pub fn read_asset_chunk(
    data_dir: &Path,
    session_id: &str,
    execution_id: &str,
    screenshot_id: &str,
    offset: u64,
    length: Option<usize>,
) -> GoalReportAssetChunk {
    let safe_component = |value: &str| {
        !value.is_empty()
            && Path::new(value)
                .components()
                .all(|component| matches!(component, std::path::Component::Normal(_)))
    };
    if !safe_component(session_id) || !safe_component(execution_id) {
        return GoalReportAssetChunk {
            state: "unavailable".to_string(),
            asset_id: None,
            mime_type: None,
            total_bytes: None,
            offset: Some(offset),
            length: None,
            sha256: None,
            data_base64: None,
            eof: None,
            session_id: Some(session_id.to_string()),
            detail: Some("ASSET_NOT_FOUND: invalid report identity".to_string()),
        };
    }
    let report_path = data_dir
        .join("goal_reports")
        .join(session_id)
        .join(format!("{execution_id}.json"));

    if !report_path.exists() {
        return GoalReportAssetChunk {
            state: "not_found".to_string(),
            asset_id: None,
            mime_type: None,
            total_bytes: None,
            offset: Some(offset),
            length: None,
            sha256: None,
            data_base64: None,
            eof: None,
            session_id: Some(session_id.to_string()),
            detail: Some("REPORT_NOT_FOUND: goal report does not exist".to_string()),
        };
    }

    let report_content = match fs::read_to_string(&report_path) {
        Ok(c) => c,
        Err(e) => {
            return GoalReportAssetChunk {
                state: "corrupt".to_string(),
                asset_id: None,
                mime_type: None,
                total_bytes: None,
                offset: Some(offset),
                length: None,
                sha256: None,
                data_base64: None,
                eof: None,
                session_id: Some(session_id.to_string()),
                detail: Some(format!("REPORT_CORRUPT: could not read report JSON: {e}")),
            };
        }
    };

    let report_json: Value = match serde_json::from_str(&report_content) {
        Ok(v) => v,
        Err(e) => {
            return GoalReportAssetChunk {
                state: "corrupt".to_string(),
                asset_id: None,
                mime_type: None,
                total_bytes: None,
                offset: Some(offset),
                length: None,
                sha256: None,
                data_base64: None,
                eof: None,
                session_id: Some(session_id.to_string()),
                detail: Some(format!("REPORT_CORRUPT: report JSON invalid: {e}")),
            };
        }
    };

    let assets_array = report_json.get("assets").and_then(Value::as_array);
    let matched_asset = assets_array.and_then(|arr| {
        arr.iter().find(|item| {
            item.get("screenshotId").and_then(Value::as_str) == Some(screenshot_id)
                || item.get("assetId").and_then(Value::as_str) == Some(screenshot_id)
        })
    });

    let Some(asset_val) = matched_asset else {
        return GoalReportAssetChunk {
            state: "unavailable".to_string(),
            asset_id: None,
            mime_type: None,
            total_bytes: None,
            offset: Some(offset),
            length: None,
            sha256: None,
            data_base64: None,
            eof: None,
            session_id: Some(session_id.to_string()),
            detail: Some(format!(
                "ASSET_NOT_FOUND: asset for '{screenshot_id}' not found in report"
            )),
        };
    };

    let asset_id = asset_val
        .get("assetId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mime_type = asset_val
        .get("mimeType")
        .and_then(Value::as_str)
        .unwrap_or("image/png")
        .to_string();
    let rel_path = asset_val
        .get("relativePath")
        .and_then(Value::as_str)
        .unwrap_or("");
    let expected_sha256 = asset_val
        .get("sha256")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let asset_root = data_dir
        .join("goal_reports")
        .join(session_id)
        .join("assets")
        .join(execution_id);
    let canonical_data_dir = match fs::canonicalize(data_dir) {
        Ok(path) => path,
        Err(_) => {
            return GoalReportAssetChunk {
                state: "unavailable".to_string(),
                asset_id: Some(asset_id),
                mime_type: Some(mime_type),
                total_bytes: None,
                offset: Some(offset),
                length: None,
                sha256: Some(expected_sha256),
                data_base64: None,
                eof: None,
                session_id: Some(session_id.to_string()),
                detail: Some("ASSET_FILE_MISSING: data directory is missing".to_string()),
            };
        }
    };
    let canonical_root = match fs::canonicalize(&asset_root) {
        Ok(path) if path.starts_with(&canonical_data_dir) => path,
        _ => {
            return GoalReportAssetChunk {
                state: "unavailable".to_string(),
                asset_id: Some(asset_id),
                mime_type: Some(mime_type),
                total_bytes: None,
                offset: Some(offset),
                length: None,
                sha256: Some(expected_sha256),
                data_base64: None,
                eof: None,
                session_id: Some(session_id.to_string()),
                detail: Some("ASSET_FILE_MISSING: asset directory on disk is missing".to_string()),
            };
        }
    };
    let full_asset_path = data_dir.join(rel_path);
    let full_asset_path = match fs::canonicalize(&full_asset_path) {
        Ok(path) if path.starts_with(&canonical_root) && path.is_file() => path,
        _ => {
            return GoalReportAssetChunk {
                state: "unavailable".to_string(),
                asset_id: Some(asset_id),
                mime_type: Some(mime_type),
                total_bytes: None,
                offset: Some(offset),
                length: None,
                sha256: Some(expected_sha256),
                data_base64: None,
                eof: None,
                session_id: Some(session_id.to_string()),
                detail: Some("ASSET_FILE_MISSING: asset file on disk is missing".to_string()),
            };
        }
    };

    let mut file = match File::open(&full_asset_path) {
        Ok(f) => f,
        Err(e) => {
            return GoalReportAssetChunk {
                state: "corrupt".to_string(),
                asset_id: Some(asset_id),
                mime_type: Some(mime_type),
                total_bytes: None,
                offset: Some(offset),
                length: None,
                sha256: Some(expected_sha256),
                data_base64: None,
                eof: None,
                session_id: Some(session_id.to_string()),
                detail: Some(format!("ASSET_OPEN_FAILED: {e}")),
            };
        }
    };

    let metadata = match file.metadata() {
        Ok(m) => m,
        Err(e) => {
            return GoalReportAssetChunk {
                state: "corrupt".to_string(),
                asset_id: Some(asset_id),
                mime_type: Some(mime_type),
                total_bytes: None,
                offset: Some(offset),
                length: None,
                sha256: Some(expected_sha256),
                data_base64: None,
                eof: None,
                session_id: Some(session_id.to_string()),
                detail: Some(format!("ASSET_METADATA_FAILED: {e}")),
            };
        }
    };

    let total_bytes = metadata.len();
    if offset >= total_bytes {
        return GoalReportAssetChunk {
            state: "ready".to_string(),
            asset_id: Some(asset_id),
            mime_type: Some(mime_type),
            total_bytes: Some(total_bytes),
            offset: Some(offset),
            length: Some(0),
            sha256: Some(expected_sha256),
            data_base64: Some(String::new()),
            eof: Some(true),
            session_id: Some(session_id.to_string()),
            detail: None,
        };
    }

    if let Err(e) = file.seek(SeekFrom::Start(offset)) {
        return GoalReportAssetChunk {
            state: "corrupt".to_string(),
            asset_id: Some(asset_id),
            mime_type: Some(mime_type),
            total_bytes: Some(total_bytes),
            offset: Some(offset),
            length: None,
            sha256: Some(expected_sha256),
            data_base64: None,
            eof: None,
            session_id: Some(session_id.to_string()),
            detail: Some(format!("ASSET_SEEK_FAILED: {e}")),
        };
    }

    let chunk_limit = length
        .unwrap_or(MAX_CHUNK_LENGTH)
        .clamp(1, MAX_CHUNK_LENGTH);
    let bytes_to_read = (total_bytes - offset).min(chunk_limit as u64) as usize;
    let mut buf = vec![0u8; bytes_to_read];
    let read_bytes = match file.read(&mut buf) {
        Ok(n) => n,
        Err(e) => {
            return GoalReportAssetChunk {
                state: "corrupt".to_string(),
                asset_id: Some(asset_id),
                mime_type: Some(mime_type),
                total_bytes: Some(total_bytes),
                offset: Some(offset),
                length: None,
                sha256: Some(expected_sha256),
                data_base64: None,
                eof: None,
                session_id: Some(session_id.to_string()),
                detail: Some(format!("ASSET_READ_FAILED: {e}")),
            };
        }
    };
    buf.truncate(read_bytes);

    let eof = offset + (read_bytes as u64) >= total_bytes;
    let data_base64 = B64.encode(&buf);

    GoalReportAssetChunk {
        state: "ready".to_string(),
        asset_id: Some(asset_id),
        mime_type: Some(mime_type),
        total_bytes: Some(total_bytes),
        offset: Some(offset),
        length: Some(read_bytes),
        sha256: Some(expected_sha256),
        data_base64: Some(data_base64),
        eof: Some(eof),
        session_id: Some(session_id.to_string()),
        detail: None,
    }
}
