/// Domains the tunnel will forward traffic to.
/// This list is intentionally hardcoded — it cannot be changed
/// at runtime, via config file, or by the relay server.
/// Changing it requires recompiling the application.
pub const ALLOWED_DOMAINS: &[&str] = &[
    "linkedin.com",
    "www.linkedin.com",
    "api.linkedin.com",
    "instagram.com",
    "www.instagram.com",
    "i.instagram.com",
    "graph.instagram.com",
    "twitter.com",
    "www.twitter.com",
    "api.twitter.com",
    "x.com",
    "www.x.com",
    "api.x.com",
    "tiktok.com",
    "www.tiktok.com",
    "m.tiktok.com",
    "google.com",
    "www.google.com",
    "google.ca",
    "maps.googleapis.com",
    "accounts.google.com",
];

/// Returns true if the given hostname is in the allowlist.
/// Checks exact matches only. Does NOT allow arbitrary subdomains.
pub fn is_allowed(host: &str) -> bool {
    let host = host.to_lowercase();
    ALLOWED_DOMAINS.iter().any(|allowed| host == *allowed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exact_match() {
        assert!(is_allowed("linkedin.com"));
        assert!(is_allowed("www.linkedin.com"));
        assert!(is_allowed("api.linkedin.com"));
        assert!(is_allowed("m.tiktok.com"));
    }

    #[test]
    fn test_case_insensitive() {
        assert!(is_allowed("LinkedIn.com"));
        assert!(is_allowed("WWW.GOOGLE.COM"));
    }

    #[test]
    fn test_rejects_arbitrary() {
        assert!(!is_allowed("evil.com"));
        assert!(!is_allowed("notlinkedin.com"));
        assert!(!is_allowed("linkedin.com.evil.com"));
        assert!(!is_allowed("api.actium.io"));
        assert!(!is_allowed("localhost"));
        assert!(!is_allowed("192.168.1.1"));
        assert!(!is_allowed("127.0.0.1"));
    }
}
