# Ember Bridge 0.5.2 release qualification

Status: qualified for stable publication. The signed installer checks and final
macOS application check are complete. The release uses the exact assets built
from tag `v0.5.2` at `cbcc5e5790de36dac9ced9fee9a7f433be43caa2`.

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

## Signed artifact checks

The [release build](https://github.com/EmberSoftwareInc/ember-bridge/actions/runs/36651250000)
passed for macOS universal, Windows, and Linux. All 14 assets were downloaded and
hashed before qualification. Every updater-feed entry references the expected
immutable 0.5.2 asset and matches its detached signature file.

The [installer qualification workflow](https://github.com/EmberSoftwareInc/ember-bridge/actions/runs/36654573427)
passed the real signed 0.5.1-to-0.5.2 upgrade, installation, and updated-application
startup for Windows NSIS, Windows MSI, and Linux AppImage. The probe verifies the
production updater signature and installs the actual release bytes into a
disposable directory. Its loopback feed changes download URLs only, allowing
private draft assets to be tested without publishing them.

On macOS, the same real updater upgraded a disposable copy of signed 0.5.1 to
0.5.2. Strict code-signature verification passed, and Gatekeeper accepted the
bundle as a notarized Developer ID application. Normal Launch Services startup
displayed the application; the local API reported 0.5.2. Both saved machines
remained visible, and the complete configuration compared unchanged against a
private baseline, including pairing and channel preferences.

The signed application's Link firmware panel reached the physical dongle over
local Wi-Fi, displayed Stable and installed version 0.3.6, and correctly reported
no different compatible recommendation. This check did not install firmware;
the earlier physical USB round trip is documented separately above.

These checks do not cover interactive Windows/Linux UI, repeated local Wi-Fi
firmware installation, physical power cuts, or multi-day endurance. The Ember
web app repository is outside this change.
