//! Assertions on Bash output captured through a login shell.
//!
//! `bash -lc` runs the user's login profile before the command, and that
//! profile may write to the captured streams. x-cmd, for example, prints a
//! notice to stderr whenever `CLAUDECODE` is set, which is always true inside
//! Claude Code. Comparing whole streams would therefore depend on the
//! developer's profile, so a command announces where its own output starts and
//! assertions compare only what follows that marker.

/// Printed on stdout and stderr before a test command's own output.
const OUTPUT_START: &str = "__pi_test_output_start__";

/// Prefixes `command` with the output marker on both streams.
pub(crate) fn mark_output(command: &str) -> String {
    let prefix = if cfg!(windows) {
        format!(
            "[Console]::Out.Write('{OUTPUT_START}'); \
             [Console]::Error.Write('{OUTPUT_START}'); "
        )
    } else {
        format!("printf '{OUTPUT_START}'; printf '{OUTPUT_START}' >&2; ")
    };
    format!("{prefix}{command}")
}

/// Returns what the command wrote after its marker. Panics when the marker is
/// absent, so a stream that never went through [`mark_output`] fails loudly
/// instead of passing only on machines whose profile prints nothing.
pub(crate) fn after_output_start(stream: &serde_json::Value) -> &str {
    let text = stream.as_str().expect("captured output is a string");
    match text.split_once(OUTPUT_START) {
        Some((_, output)) => output,
        None => panic!("output marker missing from captured stream: {text:?}"),
    }
}
