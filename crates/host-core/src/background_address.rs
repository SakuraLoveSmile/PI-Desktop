//! The address a local server announces in its own output.
//!
//! Output is untrusted text, so the grammar is narrow: `http` or `https`, a loopback host and an explicit port.
//! Only `scheme://host:port` is kept, never a path, a query (it can carry a token) or user information.

/// How much of the previous read is joined to the next one, so a URL split across two reads is still found.
const TAIL_BYTES: usize = 256;

/// Watches both output streams of one process for the first loopback URL it prints.
#[derive(Debug, Default)]
pub(crate) struct AddressDetector {
    found: Option<String>,
    /// The raw end of each stream's earlier reads (stdout, stderr): a read can stop inside a URL or an escape sequence.
    tails: [String; 2],
}

impl AddressDetector {
    pub(crate) fn address(&self) -> Option<&str> {
        self.found.as_deref()
    }

    /// Returns the address on the one read that completes the first match, and `None` on every other read.
    pub(crate) fn feed(&mut self, stderr: bool, chunk: &str) -> Option<&str> {
        if self.found.is_some() {
            return None;
        }
        let index = usize::from(stderr);
        let mut window = std::mem::take(&mut self.tails[index]);
        window.push_str(chunk);
        match detect(&window) {
            Some(address) => {
                self.tails = Default::default();
                self.found = Some(address);
            }
            None => self.tails[index] = tail_of(&window).to_string(),
        }
        self.found.as_deref()
    }
}

fn tail_of(window: &str) -> &str {
    let mut start = window.len().saturating_sub(TAIL_BYTES);
    while !window.is_char_boundary(start) {
        start += 1;
    }
    &window[start..]
}

/// Drops terminal escape sequences, including one that splits a URL (a dev server may bold its port). A sequence cut
/// off by the end of the text is dropped as well.
fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.next() {
            // Control sequence: parameter and intermediate bytes, then one final byte.
            Some('[') => {
                for next in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&next) {
                        break;
                    }
                }
            }
            // Operating system command: ends at BEL, or at ESC and the one character after it.
            Some(']') => {
                while let Some(next) = chars.next() {
                    if next == '\u{7}' {
                        break;
                    }
                    if next == '\u{1b}' {
                        chars.next();
                        break;
                    }
                }
            }
            // Character-set selection and similar take one more character.
            Some('(' | ')' | '*' | '+' | '#' | '%') => {
                chars.next();
            }
            _ => {}
        }
    }
    out
}

/// The first loopback URL in `text`, as `scheme://host:port` with `0.0.0.0` and `[::]` read as `localhost`.
pub(crate) fn detect(text: &str) -> Option<String> {
    let clean = strip_ansi(text);
    let bytes = clean.as_bytes();
    clean.match_indices("://").find_map(|(at, _)| {
        let (scheme, start) = scheme_before(bytes, at)?;
        // `xhttp://` and `git+http://` are other schemes, not this one.
        let before = start.checked_sub(1).map(|index| bytes[index]);
        if before.is_some_and(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.')) {
            return None;
        }
        let (host, port) = loopback_authority(&clean[at + 3..])?;
        Some(format!("{scheme}://{host}:{port}"))
    })
}

fn scheme_before(bytes: &[u8], at: usize) -> Option<(&'static str, usize)> {
    [("https", 5usize), ("http", 4usize)]
        .into_iter()
        .find_map(|(scheme, len)| {
            let start = at.checked_sub(len)?;
            bytes[start..at]
                .eq_ignore_ascii_case(scheme.as_bytes())
                .then_some((scheme, start))
        })
}

/// `host:port` at the start of `rest`: a loopback host, a port from 1 to 65535 without leading zeros and a clean end.
/// A port that runs to the end of the text may continue in the next read, and a character such as `@` after it
/// means the host was really user information, so neither is a match.
fn loopback_authority(rest: &str) -> Option<(String, u16)> {
    let (host, after) = match rest.strip_prefix('[') {
        Some(inner) => {
            let end = inner.find(']')?;
            (format!("[{}]", &inner[..end]), &inner[end + 1..])
        }
        None => {
            let end = rest
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '-'))
                .unwrap_or(rest.len());
            (rest[..end].to_string(), &rest[end..])
        }
    };
    let host = loopback_host(&host)?;
    let digits = after.strip_prefix(':')?;
    let end = digits.find(|c: char| !c.is_ascii_digit())?;
    if end == 0 || digits.starts_with('0') {
        return None;
    }
    let port: u16 = digits[..end].parse().ok()?;
    let next = digits[end..].chars().next()?;
    let clean_end = next.is_whitespace()
        || matches!(
            next,
            '/' | '?' | '#' | '"' | '\'' | '`' | ')' | '>' | '<' | ',' | ';' | '.'
        );
    clean_end.then_some((host, port))
}

fn loopback_host(host: &str) -> Option<String> {
    if host.eq_ignore_ascii_case("localhost") || host == "[::]" {
        return Some("localhost".into());
    }
    if host == "[::1]" {
        return Some(host.into());
    }
    let octets: Vec<&str> = host.split('.').collect();
    if octets.len() != 4 {
        return None;
    }
    let mut value = [0u8; 4];
    for (slot, text) in value.iter_mut().zip(&octets) {
        if text.is_empty()
            || (text.len() > 1 && text.starts_with('0'))
            || !text.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        *slot = text.parse().ok()?;
    }
    match value {
        [0, 0, 0, 0] => Some("localhost".into()),
        [127, ..] => Some(host.into()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(text: &str) -> Option<String> {
        detect(text)
    }

    #[test]
    fn announcements_of_common_dev_servers_are_read_as_origins() {
        let cases = [
            // Vite with colour forced on: the port is bold, so escape sequences sit inside the URL.
            ("  \u{1b}[32m➜\u{1b}[39m  \u{1b}[1mLocal\u{1b}[22m:   \u{1b}[36mhttp://localhost:\u{1b}[1m5173\u{1b}[22m/\u{1b}[39m\n", "http://localhost:5173"),
            ("   - Local:        http://localhost:3000\n", "http://localhost:3000"),
            ("Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...\n", "http://localhost:8000"),
            ("INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)\n", "http://127.0.0.1:8000"),
            (" * Running on http://127.0.0.1:5000\n", "http://127.0.0.1:5000"),
            ("* Listening on http://[::1]:3000\n", "http://[::1]:3000"),
            ("listening on http://[::]:8080/\n", "http://localhost:8080"),
            ("ready on https://localhost:8443/app\n", "https://localhost:8443"),
            ("Open HTTP://LOCALHOST:3000/ now\n", "http://localhost:3000"),
            ("see \"http://127.0.0.2:4000\" for details\n", "http://127.0.0.2:4000"),
            ("Visit http://localhost:3000.\n", "http://localhost:3000"),
        ];
        for (text, expected) in cases {
            assert_eq!(found(text).as_deref(), Some(expected), "{text:?}");
        }
    }

    #[test]
    fn path_query_and_fragment_never_reach_the_address() {
        assert_eq!(
            found("http://localhost:8888/lab?token=s3cret#frag\n").as_deref(),
            Some("http://localhost:8888")
        );
        assert_eq!(
            found("http://localhost:8888?token=s3cret\n").as_deref(),
            Some("http://localhost:8888")
        );
    }

    #[test]
    fn only_an_explicit_loopback_http_origin_with_a_clean_end_matches() {
        let rejected = [
            "http://localhost/\n",
            "http://localhost:0/\n",
            "http://localhost:65536/\n",
            "http://localhost:03000/\n",
            "http://localhost:30a0/\n",
            "http://localhost:3000abc\n",
            "http://localhost:3000%40evil.test/\n",
            "http://user:pw@localhost:3000/\n",
            "http://localhost:3000@evil.test/\n",
            "http://127.0.0.1:80@localhost:3000/\n",
            "http://localhost:3000:3000@localhost:3000/\n",
            "http://localhost.evil.test:3000/\n",
            "http://evil.test:3000/\n",
            "http://192.168.1.5:5173/\n",
            "http://10.0.0.1:80/\n",
            "http://128.0.0.1:80/\n",
            "http://127.1:3000/\n",
            "http://0127.0.0.1:3000/\n",
            "http://127.0.0.1.evil.test:3000/\n",
            "http://[::2]:3000/\n",
            "http://[fe80::1]:3000/\n",
            "ftp://localhost:21/\n",
            "ws://localhost:3000/\n",
            "xhttp://localhost:3000/\n",
            "git+http://localhost:3000/\n",
            "localhost:3000\n",
            "listening on port 3000\n",
        ];
        for text in rejected {
            assert_eq!(found(text), None, "{text:?}");
        }
    }

    #[test]
    fn a_url_that_may_still_be_growing_waits_for_its_end() {
        assert_eq!(found("Local: http://localhost:3000"), None);
        assert_eq!(found("Local: http://localhost:30"), None);
        assert_eq!(found("Local: http://localhost:3000\u{1b}["), None);
        assert_eq!(
            found("Local: http://localhost:3000\u{1b}[39m\n").as_deref(),
            Some("http://localhost:3000")
        );
    }

    #[test]
    fn the_first_match_wins_and_a_rejected_candidate_does_not_hide_a_later_one() {
        let text = "Network: http://192.168.1.2:5173/ Local: http://localhost:5173/ then http://localhost:9999/\n";
        assert_eq!(found(text).as_deref(), Some("http://localhost:5173"));
        let text = "proxy http://user:pw@localhost:1/ up at http://127.0.0.1:2000/\n";
        assert_eq!(found(text).as_deref(), Some("http://127.0.0.1:2000"));
    }

    #[test]
    fn a_url_split_across_reads_is_found_once_and_never_changes() {
        let mut detector = AddressDetector::default();
        assert_eq!(detector.feed(false, "Local: http://loc"), None);
        assert_eq!(detector.feed(false, "alhost:30"), None);
        assert_eq!(detector.feed(false, "00/\n"), Some("http://localhost:3000"));
        assert_eq!(detector.address(), Some("http://localhost:3000"));
        assert_eq!(
            detector.feed(false, "Local: http://localhost:4000/\n"),
            None
        );
        assert_eq!(detector.address(), Some("http://localhost:3000"));
    }

    #[test]
    fn an_escape_sequence_split_across_reads_is_still_removed() {
        let mut detector = AddressDetector::default();
        assert_eq!(detector.feed(false, "http://localhost:\u{1b}"), None);
        assert_eq!(detector.feed(false, "[1m5173\u{1b}[22"), None);
        assert_eq!(detector.feed(false, "m/\n"), Some("http://localhost:5173"));
    }

    #[test]
    fn the_two_streams_never_join_each_other() {
        let mut detector = AddressDetector::default();
        assert_eq!(detector.feed(false, "Local: http://local"), None);
        assert_eq!(detector.feed(true, "host:3000/\n"), None);
        assert_eq!(detector.address(), None);
        assert_eq!(
            detector.feed(true, "Local: http://localhost:3001/\n"),
            Some("http://localhost:3001")
        );
    }

    #[test]
    fn what_is_carried_between_reads_stays_bounded_and_on_a_character_boundary() {
        let mut detector = AddressDetector::default();
        for _ in 0..40 {
            assert_eq!(detector.feed(false, &"日志输出 ".repeat(40)), None);
            assert!(detector.tails[0].len() <= TAIL_BYTES);
        }
        assert_eq!(
            detector.feed(false, "http://localhost:7000/\n"),
            Some("http://localhost:7000")
        );
    }
}
