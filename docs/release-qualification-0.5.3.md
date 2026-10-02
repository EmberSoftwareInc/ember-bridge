# Ember Bridge 0.5.3 release qualification

Status: published as latest stable on 2026-10-02; final installers and public
updater downloads verified.

## Changes and compatibility

Adds local Ember Link file browsing, folder creation, file/folder rename and
move, and deletion of files or empty folders. Requires firmware advertising
filesystem protocol 1, currently Link 0.3.8-dev.2 in the opt-in Development
channel. This Bridge release does not promote that firmware to Stable or change
a device's selected firmware channel. Older firmware receives update guidance.
Existing sending, USB setup and direct Brother Wi-Fi remain supported.

Mutations require an idle-machine confirmation, paired device identity and a
current directory revision. No overwrite, recursive deletion, redirect or
automatic replay of writes is permitted. There is no cloud file management.

## Supporting checks

The feature passed 31 frontend tests, 71 Rust tests, frontend production build
and an optimized macOS development package. The packaged 0.5.3-dev.1 app and exact
Link 0.3.8-dev.2 image passed 12 hardware checks, a nested Brother NQ1700E preview,
and a post-restart comparison of all 71 retained design hashes. Wi-Fi persisted.
These are development-package checks, not final 0.5.3 installer qualification.
See [development test](development-test-0.5.3-dev.1.md) and
[local file browser](local-file-browser.md).

The first test card's corruption remains unexplained. A second card passed
supporting FAT integrity checks and the final-image file comparisons. Multi-day
reliability and broad machine compatibility remain unqualified; no firmware
stable-promotion claim follows from this desktop release.

## Final artifact checks

- [x] Record release source commit and build workflow.
- [x] All platform builds and automated tests pass.
- [x] Download and hash final assets; validate updater entries and signatures.
- [x] Windows NSIS/MSI and Linux AppImage signed 0.5.2-to-0.5.3 upgrades pass.
- [x] macOS signed upgrade, notarization, startup and configuration preservation pass.
- [x] Final macOS Files UI and older-firmware compatibility check pass.
- [x] Publish exact qualified assets and verify the public stable updater feed.

## Final source and build

Release tag `v0.5.3` targets `4925451e18a74ae4558fef807dba1c4e945b9c53`.
[PR #4](https://github.com/EmberSoftwareInc/ember-bridge/pull/4) merged at
`023ab17fad0e66269d3b31f72ed4800f0cb3e648`. The only subsequent change in the
release source isolates a setup test's mocked timeouts from React's monotonic
scheduling clock. The first Windows run failed an LED-save assertion; an unchanged
retry passed that assertion but failed the screen-save error-feedback assertion.
No assertion was removed or weakened. All 31 frontend tests and 71 Rust tests
passed on every platform after the test-isolation fix.

The initial unpublished draft and tag were replaced before publication. All
final assets were rebuilt from the corrected tag by
[release workflow 37074719408](https://github.com/EmberSoftwareInc/ember-bridge/actions/runs/37074719408),
which passed for universal macOS, Windows and Linux. Published historical
releases were not changed. Application code is unchanged from the PR merge.

All 14 final assets were downloaded and hashed. Every detached updater signature
verified against the production public key. All 11 updater-feed entries reference
immutable 0.5.3 asset URLs and match their detached signatures.

Mac universal updater archive SHA-256:
`3074ecc04eef86588d2bfad7fcf39006aa306a8920961db6a5c324f97c9b6cc9`.
Final `latest.json` SHA-256:
`b0c27d8ff6bfef6cd64d5bef3422d820f94cf4284b265ed5872552bfed986bae`.

## Exact installer qualification

[Qualification workflow 37075724607](https://github.com/EmberSoftwareInc/ember-bridge/actions/runs/37075724607)
passed real signed 0.5.2-to-0.5.3 installation and updated-app startup for Windows
NSIS, Windows MSI and Linux AppImage. The disposable updater probe verifies the
production signature and installs actual draft release bytes using a loopback
feed; only download URLs are changed.

On macOS, the real updater installed the final signed archive over a disposable
copy of 0.5.2. Strict deep code-signature verification passed; Gatekeeper accepted
the updated app as a notarized Developer ID application. Normal launch produced
a healthy local API reporting 0.5.3. The complete saved Bridge configuration
compared unchanged against a private baseline, including pairing and channel
preferences; all three saved machines remained present.

The final signed Mac app's Files page read the spare Link's card root, navigated
into `FBREL2`, and displayed `REL038.PES`. The drive was ejected before each read
and safely unmounted afterward. No mutations were performed in this final UI
check. Mutation, machine-preview and file-hash evidence from the identical app
source's development package remains supporting evidence described above.
Old-firmware capability rejection passed automated backend tests without sending
a filesystem mutation; a separate physical old-firmware test was not performed.

Interactive Windows/Linux UI, repeated upgrades, multi-day endurance, and broad
machine compatibility remain outside these checks. The Link firmware release
channels and web app repository were not modified by this desktop release.

## Publication verification

[Ember Bridge v0.5.3](https://github.com/EmberSoftwareInc/ember-bridge/releases/tag/v0.5.3)
is published as the latest stable release. The public `latest/download/latest.json`
returns version 0.5.3 and matches the qualified feed byte for byte. All 14 assets
were downloaded anonymously after publication; their sizes and SHA-256 hashes
match the qualification record. Release notes state the Files firmware requirement
and remaining development-firmware reliability limitations.

## Post-publication setup-state regression

The documentation-only follow-up triggered
[CI run 37076845524](https://github.com/EmberSoftwareInc/ember-bridge/actions/runs/37076845524),
which failed the screen-settings save test: the selected 180-degree orientation
was submitted as 0 degrees. The earlier timer-isolation change was insufficient.

Local reproduction and event tracing found an application-state race: the
initial passive settings synchronization effect could run after the first edit,
overwriting that edit with the reported device values. This affects initial
screen, orientation and LED edits; it does not change the verified installer
signatures or the earlier file-operation qualification results.

The follow-up fix synchronizes settings in a layout effect before the controls
can receive input. Three deterministic first-interaction regression cases fail
with the old synchronization and pass with the fix. The original failing sequence
also passed 500 repetitions after the fix. Published 0.5.3 assets remain unchanged;
distributing this application fix requires a subsequent patch release.
