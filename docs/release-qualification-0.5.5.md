# Ember Bridge 0.5.5 release qualification

Status: published as latest stable on 2026-10-19; final installers and public
updater downloads verified. Publication timestamp: `2026-10-19T21:26:40Z`.

## Scope

Preserves connection probe failures instead of misreporting a changed device
identity, adds resolution failure and rediscovery diagnostics, and gates the
always-visible Ember Link tab's pulse on local USB detection. Selecting the tab
or requesting reduced motion suppresses the pulse. USB presence is polled every
two seconds using the existing port enumeration, without opening the device.

The release was prepared in an isolated worktree from the 0.5.4 publication
commit. Pending Windows signing workflow, scripts and documentation changes are
excluded; the release workflow is byte-for-byte identical to 0.5.4. Machine
timeouts, retry policy and firmware channels are unchanged. This patch does not
establish or fix the cause of the SE700's network stalls.

## Source and automated checks

Release tag `v0.5.5` targets `ed1dcf9776a651cc9d047abb79eb2fed52686512`.
[Release workflow 39325529485](https://github.com/EmberSoftwareInc/ember-bridge/actions/runs/39325529485)
passed universal macOS, Windows and Linux builds, including frontend and Rust
checks. [Main CI 39325530572](https://github.com/EmberSoftwareInc/ember-bridge/actions/runs/39325530572)
also passed.

All 34 frontend tests, 75 Rust tests, the production frontend build, bundle check
and version consistency checks pass locally. Regression coverage includes
preserving timeout/unreachable/protocol errors, rediscovery recovery, and refusal
of mismatched or ambiguous identities.

## Final artifacts and upgrade checks

All 14 assets were downloaded and hashed. All six detached updater signatures
verified against the production public key, including their trusted comments.
All 11 updater-feed entries reference immutable 0.5.5 URLs with matching signatures.

Mac universal updater archive SHA-256:
`245c30891b931104beee1676abc9675b3a7be46aecfc0b4d7127c226d96e2616`.
Final `latest.json` SHA-256:
`d0497b336449e3611f7d45796d13f65bafe618fdc07b0b81d885af2fa71d20a4`.

[Qualification workflow 39326659536](https://github.com/EmberSoftwareInc/ember-bridge/actions/runs/39326659536)
passed actual signed 0.5.4-to-0.5.5 installation and updated-app startup for
Windows NSIS, Windows MSI and Linux AppImage. Each updated app reported 0.5.5
through its local health API. The production-key updater probe used unchanged
release bytes through a loopback feed.

The same signed upgrade passed on macOS using a disposable 0.5.4 app copy. Strict
deep code-signature verification passed, Gatekeeper accepted the updated app as
a notarized Developer ID application, and the binary contains both arm64 and
x86_64 architectures. The updated app launched and reported 0.5.5 through its
local health API. The complete saved configuration compared unchanged. The
installed 0.5.4 app was briefly closed while idle and reopened after the check;
its installation was not replaced.

Physical USB plug/unplug interaction, customer SE700 hardware reproduction,
interactive Windows/Linux UI and long-term endurance were not repeated in this
release qualification.

## Publication verification

[Ember Bridge v0.5.5](https://github.com/EmberSoftwareInc/ember-bridge/releases/tag/v0.5.5)
is published as the latest stable release. The public stable updater feed reports
0.5.5 and matches the qualified feed byte for byte. All 14 assets were downloaded
anonymously after publication; sizes and SHA-256 hashes match the qualification
record. Published 0.5.4 and earlier releases were not changed.
