//! Channel and version policy shared by discovery and installation.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReleaseChannel {
    #[default]
    Stable,
    Dev,
}

impl ReleaseChannel {
    pub fn accepts(self, version: &str) -> bool {
        let Ok(v) = semver::Version::parse(version) else {
            return false;
        };
        if !v.build.is_empty() {
            return false;
        }
        match self {
            Self::Stable => v.pre.is_empty(),
            Self::Dev => v.pre.as_str().strip_prefix("dev.").is_some_and(|n| {
                !n.starts_with('0')
                    && n.bytes().all(|c| c.is_ascii_digit())
                    && n.parse::<u64>().is_ok_and(|n| n > 0)
            }),
        }
    }
}

pub fn install_action(current: &str, target: &str) -> &'static str {
    match (
        semver::Version::parse(current),
        semver::Version::parse(target),
    ) {
        (Ok(from), Ok(to)) if !from.pre.is_empty() && to.pre.is_empty() => "return_to_stable",
        (Ok(from), Ok(to)) if to < from => "downgrade",
        (Ok(_), Ok(_)) => "update",
        _ => "replace_unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stable_and_numbered_dev_are_disjoint() {
        for v in ["0.3.6", "10.0.0"] {
            assert!(ReleaseChannel::Stable.accepts(v));
            assert!(!ReleaseChannel::Dev.accepts(v));
        }
        for v in ["0.3.7-dev.1", "0.3.7-dev.10"] {
            assert!(ReleaseChannel::Dev.accepts(v));
            assert!(!ReleaseChannel::Stable.accepts(v));
        }
        for v in [
            "0.3.6-dev",
            "0.3.7-rc1",
            "0.3.7-dev.0",
            "0.3.7-dev.01",
            "0.3.7-dev.1+test",
            "garbage",
        ] {
            assert!(!ReleaseChannel::Dev.accepts(v));
            assert!(!ReleaseChannel::Stable.accepts(v));
        }
        assert_eq!(install_action("0.3.7-dev.10", "0.3.7-dev.2"), "downgrade");
        assert_eq!(install_action("0.3.7-dev.1", "0.3.6"), "return_to_stable");
        assert_eq!(install_action("0.3.6", "0.3.7-dev.1"), "update");
        assert_eq!(install_action("unknown", "0.3.6"), "replace_unknown");
    }
}
