# Ember Bridge 0.5.2 release qualification

Status: candidate preparation. Keep the GitHub release as a draft until the
signed installer checks and final macOS application check are complete.

## Changes

Link firmware updates now have Stable and Development selectors, saved per
dongle in Bridge. Stable is the default. Development requires explicit consent;
changing channels does not install firmware. Returning to stable or installing
an older recommendation requires separate confirmation. Installation rechecks
the device version, selected channel, release identity, and image hash.

This preference is independent of the cloud service's device preference.
Bridge's own application updater continues to use stable releases.

## Completed source and hardware checks

The channel implementation passed 36 Rust unit tests, 31 Rust integration tests,
and 24 frontend tests, a frontend
production build, and a local macOS application build. A physical LilyGO
T-Dongle-S3 completed Bridge USB installation of the production-signed
0.3.7-dev.1 firmware and an explicitly approved return to stable 0.3.6.
Fresh independent cloud reports confirmed both versions and healthy boots.
Display and LED settings were preserved, and both design files matched hashes
recorded before the Bridge updates.

After the return to 0.3.6, the owner confirmed a saved design preview opened on
the Brother NQ1700E and the machine stayed responsive. This is not a separate
machine-preview qualification of the development image. No stitching was tested.
The physical tests used the macOS test build before the 0.5.2 version bump.

## Draft artifact checks

The release workflow builds signed updater artifacts for macOS universal,
Windows, and Linux. Run the installer qualification workflow on the candidate
ref with `candidate=0.5.2` and `previous=0.5.1` after all draft assets exist.
It tests the real signed upgrade and updated application startup for Windows
NSIS/MSI and Linux AppImage in disposable environments. It does not publish.

Before stable publication, also verify the macOS signed update, code signature,
notarization, and normal application launch. Record the actual workflow results
and remaining limitations here; a successful source build alone is insufficient.

These checks do not cover interactive Windows/Linux UI, repeated local Wi-Fi
firmware installation, physical power cuts, or multi-day endurance. The Ember
web app repository is outside this change.
