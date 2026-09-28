# Stable release qualification — 2026-09-28

Status: complete for stable publication. Bridge 0.5.1 is published as stable.
The web app repository is outside this work and has not been changed.

## Application artifacts

The macOS universal, Windows and Linux 0.5.1 release builds passed CI. One Linux
frontend assertion failed on the first run; the same test passed locally and the
targeted Linux rerun passed without source changes. That timing failure remains
visible in the workflow history.

An earlier Linux launch check found that failure to register the custom URL
scheme aborted startup when `update-desktop-database` was absent. Version 0.5.1
logs that optional registration failure and continues local setup and transfers.

A disposable copy of the signed Mac 0.4.2 application was updated to 0.5.1 using
the real Tauri updater and the production public key. The installed bundle passed
strict codesign verification and Gatekeeper's notarization assessment. Its local
API reported 0.5.1, and launching through macOS Launch Services displayed the UI
with both existing saved machines preserved. Direct command-line launch initially
showed a blank window; normal OS relaunch resolved it, and this observation is not
being counted as a successful UI launch.

Linux's real signed AppImage update from 0.4.2 to 0.5.1 passed byte-for-byte artifact
verification and updated-application startup. Windows signed upgrades and updated-app startup passed for both NSIS and MSI
installers in [the final matrix](https://github.com/EmberSoftwareInc/ember-bridge/actions/runs/36495549172). The standalone Windows probe needed its own
Common Controls manifest; this test-harness correction does not change the signed
application artifacts.

The probe uses a mock Tauri application context, the real updater library, real
signed release bytes and real platform installers. Its loopback feed substitutes
only download URLs so draft artifacts can be tested before publication. This is
installer integration and startup testing, not automated interactive UI testing
on Windows or Linux. The workflow has explicitly approved write permission solely
to access private draft releases; it does not publish releases.

## Link firmware delivery

Link's exact production-signed 0.3.5 image installed over an isolated HTTPS cloud
service and confirmed its boot. Physical interrupted-download, pre-boot-selection,
and pending-boot checks passed. The production key rejects development-key images.
See Ember Link's release qualification and production-signing documents for the
full evidence and SDK key-rotation limitation.

The Link repository and 0.3.5 prerelease are public with the owner's explicit
approval. Anonymous downloads of its catalog and firmware matched the qualified
bytes. Full guided Bridge Wi-Fi and USB updates passed using a private build
whose only functional change is reading that immutable prerelease catalog URL.
Both displayed successful installation and healthy-boot confirmation; independent
device inspection verified the requested version, changed slot, and confirmed boot.
Stable builds retain the standard public latest-release endpoint.

## Final publication

The owner confirmed Link's missing-card warning and successful recovery after
reinserting the card while unplugged. On the exact production-signed 0.3.5 image,
the final generated EL035.PES square previewed on the Brother NQ1700E and the
machine remained responsive. No stitching was initiated.

[Bridge 0.5.1](https://github.com/EmberSoftwareInc/ember-bridge/releases/tag/v0.5.1)
and [Link 0.3.5](https://github.com/EmberSoftwareInc/ember-link/releases/tag/v0.3.5)
are published as stable with the exact qualified assets. Anonymous latest-release
endpoints returned the qualified Link catalog/image and Bridge updater feed.
Every Bridge platform mapping points to immutable 0.5.1 assets. The normal signed
Mac application was restored after the private guided-update fixture checks.

Production AWS/cloud-service deployment is separate and has not been performed.
The disposable local cloud test profile was disabled while retaining the dongle's
local Wi-Fi and pairing settings. Qualification does not claim multi-day endurance
coverage or interactive Windows/Linux UI coverage beyond installer/startup tests.
