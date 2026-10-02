# Ember Bridge 0.5.3 release qualification

Status: preparing final signed installers. Not yet qualified for publication.

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

- [ ] Record release source commit and build workflow.
- [ ] All platform builds and automated tests pass.
- [ ] Download and hash final assets; validate updater entries and signatures.
- [ ] Windows NSIS/MSI and Linux AppImage signed 0.5.2-to-0.5.3 upgrades pass.
- [ ] macOS signed upgrade, notarization, startup and configuration preservation pass.
- [ ] Final macOS Files UI and older-firmware compatibility check pass.
- [ ] Publish exact qualified assets and verify the public stable updater feed.
