use regex::Regex;
use std::sync::LazyLock;

struct RedactPattern {
    regex: Regex,
    replacement: &'static str,
}

static REDACT_PATTERNS: LazyLock<Vec<RedactPattern>> = LazyLock::new(|| {
    vec![
        RedactPattern {
            regex: Regex::new(r"act_[a-zA-Z0-9_]{20,}").unwrap(),
            replacement: "[API_KEY_REDACTED]",
        },
        RedactPattern {
            regex: Regex::new(r"ws_[a-zA-Z0-9]{8,}").unwrap(),
            replacement: "[WORKSPACE_ID_REDACTED]",
        },
        RedactPattern {
            regex: Regex::new(r"org_[a-zA-Z0-9]{8,}").unwrap(),
            replacement: "[ORG_ID_REDACTED]",
        },
        // IPv4 addresses
        RedactPattern {
            regex: Regex::new(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b").unwrap(),
            replacement: "[IP_REDACTED]",
        },
        // Bearer tokens
        RedactPattern {
            regex: Regex::new(r"Bearer [A-Za-z0-9\-._~+/]+=*").unwrap(),
            replacement: "Bearer [TOKEN_REDACTED]",
        },
    ]
});

/// Sanitise a single log line by redacting sensitive patterns.
pub fn sanitise_log_line(line: &str) -> String {
    let mut out = line.to_string();
    for pattern in REDACT_PATTERNS.iter() {
        out = pattern.regex.replace_all(&out, pattern.replacement).to_string();
    }
    out
}

/// Sanitise multiple log lines.
pub fn sanitise_log_lines(lines: &[String]) -> Vec<String> {
    lines.iter().map(|l| sanitise_log_line(l)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_redacts_api_key() {
        let line = "Auth header: act_live_abcdef1234567890abcdef";
        let result = sanitise_log_line(line);
        assert_eq!(result, "Auth header: [API_KEY_REDACTED]");
    }

    #[test]
    fn test_redacts_workspace_id() {
        let line = "Connected to ws_abc12345678";
        let result = sanitise_log_line(line);
        assert_eq!(result, "Connected to [WORKSPACE_ID_REDACTED]");
    }

    #[test]
    fn test_redacts_org_id() {
        let line = "Org: org_xyz12345678";
        let result = sanitise_log_line(line);
        assert_eq!(result, "Org: [ORG_ID_REDACTED]");
    }

    #[test]
    fn test_redacts_ip() {
        let line = "Connecting to 192.168.1.100:8080";
        let result = sanitise_log_line(line);
        assert_eq!(result, "Connecting to [IP_REDACTED]:8080");
    }

    #[test]
    fn test_redacts_bearer_token() {
        let line = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc123";
        let result = sanitise_log_line(line);
        assert_eq!(result, "Authorization: Bearer [TOKEN_REDACTED]");
    }

    #[test]
    fn test_preserves_safe_content() {
        let line = "Tunnel connected successfully to linkedin.com";
        let result = sanitise_log_line(line);
        assert_eq!(result, line);
    }
}
