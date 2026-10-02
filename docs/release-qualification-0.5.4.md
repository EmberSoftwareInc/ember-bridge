# Ember Bridge 0.5.4 release qualification

Status: published as latest stable on 2026-10-02; final installers and public
updater downloads verified.

## Change

[PR #5](https://github.com/EmberSoftwareInc/ember-bridge/pull/5) fixes initial
Ember Link settings synchronization overwriting the first screen, orientation,
or status-light edit. The synchronization now runs during layout, before the
controls can receive input. Three deterministic regression cases fail with the
previous implementation and pass with the fix. The original failing interaction
also passed 500 repetitions locally after the fix; those temporary repetitions
are not part of the permanent test suite.

All 34 permanent frontend tests, version consistency checks, and the production
frontend build pass locally. Release CI repeats frontend and Rust checks on all
three platforms. The published 0.5.3 assets remain unchanged.

File management still requires filesystem protocol 1, currently Link
0.3.8-dev.2 in the opt-in Development channel. This desktop patch does not change
firmware channels or promote development firmware to Stable.

## Final artifact checks

- [x] All platform release builds and tests pass.
- [x] Hash all final assets; verify updater signatures and immutable feed URLs.
- [x] Windows NSIS/MSI and Linux AppImage signed 0.5.3-to-0.5.4 upgrades pass.
- [x] macOS signed upgrade, notarization, startup and saved configuration checks pass.
- [x] Publish the qualified assets and verify public downloads and the stable feed.

No Link firmware or web app source is changed by this release. Interactive
Windows/Linux UI testing, broad hardware compatibility and long-term endurance
are outside this patch qualification.

## Final source and evidence

Release tag `v0.5.4` targets `3a351f20ab34e3c4ed1ae5d05966cf2241d6743b`.
[Release workflow 37078351444](https://github.com/EmberSoftwareInc/ember-bridge/actions/runs/37078351444)
passed for universal macOS, Windows and Linux, including frontend and Rust tests.
All 14 final assets were downloaded and hashed. Detached updater signatures
verified against the production public key, and all 11 updater-feed entries
reference immutable 0.5.4 asset URLs with matching signatures.

Mac universal updater archive SHA-256:
`e8f9641697751cc209a1a4012f5964f4d8ac7ab82a93ab24cbae0fef68824a33`.
Final `latest.json` SHA-256:
`98942f68ea1d777bc18445a24a865ab643d030e85f5bdfb6deeb6b0ff55cb05d`.

[Qualification workflow 37079155147](https://github.com/EmberSoftwareInc/ember-bridge/actions/runs/37079155147)
passed actual signed 0.5.3-to-0.5.4 installation and updated-app startup for
Windows NSIS, Windows MSI and Linux AppImage. The production-key updater probe
used unchanged release bytes through a loopback feed.

The same signed upgrade passed on macOS using a disposable 0.5.3 app copy.
Strict deep code-signature verification passed, and Gatekeeper accepted the
updated app as a notarized Developer ID application. Normal launch reported
0.5.4 through the local health API. The complete saved Bridge configuration
compared unchanged against a private baseline. The Machines page displayed all
three saved machines and the Ember Link setup page rendered. This patch did not
repeat physical device-setting writes; the settings regression is covered by
its deterministic frontend cases. The installed app in Applications was not
replaced by this disposable qualification.

## Publication verification

[Ember Bridge v0.5.4](https://github.com/EmberSoftwareInc/ember-bridge/releases/tag/v0.5.4)
is the latest stable release. The public stable updater feed reports 0.5.4 and
matches the qualified feed byte for byte. All 14 assets were downloaded
anonymously after publication; sizes and SHA-256 hashes match the qualification
record. Published 0.5.3 and earlier assets were not changed.
