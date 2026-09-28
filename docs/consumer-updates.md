# Consumer update flows

## Bridge itself

Bridge checks its signed GitHub app feed when the UI starts and every six hours
while it is running. A Settings badge announces the available version. Settings
shows release notes, a manual retry, and **Install [version] and restart**. Checks
never install automatically. A network failure is shown on Settings and can be
retried; it does not turn into an “up to date” result. The available version is
rechecked at install time. Queued transfers and active USB/device operations block
installation. The existing signed release workflow and first-install requirement
are unchanged. Qualify one published signed app release upgrading to another on
macOS, Windows and Linux before advertising automatic updates as production-ready.

## Ember Link

- **Machines → Firmware** beside a saved, identified Ember Link checks over local
  Wi-Fi. The machine's saved serial is required; scan and save it if missing.
  Pairing must already exist. Firmware reads/installs never silently pair a device.
- **Ember Link → Firmware** checks over USB setup. Connect normally, then double
  press BOOT within one second. The existing path-based installer remains under
  **Advanced USB recovery** for support and older firmware.
- Firmware buttons check on mount and every six hours and show **Firmware update
  available** when there is a compatible recommendation. An explicit check dialog
  explains offline, unpublished-catalog, compatibility and recovery errors.
- The dialog shows installed/recommended versions, release notes and a required
  confirmation that the embroidery machine is idle. Clicking **Update firmware**
  downloads the approved image, validates its length/hash and application identity,
  transfers it, and checks the resulting version, serial, changed OTA slot and
  healthy boot. Keep Link powered and Bridge open. No cloud enrollment is changed.
- A local Wi-Fi install issues one POST only. A lost response is followed by boot
  checks, never an automatic retry. An unconfirmed outcome requires checking the
  device, rescanning if its IP changed, or connecting over USB. It is not success.
- The new public compatibility fields arrive in Link **0.3.5-dev**. Earlier images
  need one signed USB bootstrap update before automatic local release selection.
  Cloud-capable older images retain their existing cloud updater.

The public feed is
`https://github.com/EmberSoftwareInc/ember-link/releases/latest/download/link-releases.json`.
It is a schema-1 object with a `releases` list. Each entry is the exact manifest
created by Link's signature-verifying tool, plus a tagged GitHub `url`. There is
one recommendation per board/layout/signing-key combination. The choice is an
operator-approved recommendation, not a numeric version maximum; an explicitly
approved rollback can therefore be offered. A recommendation equal to the running
version is not offered. An empty list withdraws public recommendations.

Only HTTPS requests to the configured Ember GitHub repository and GitHub asset
redirect hosts are accepted for firmware. Responses are bounded. Download URLs,
file paths and image bytes are never accepted from the browser's localhost API.
Local pairing credentials are sent only to the identity-checked LAN device with
redirects and system proxies disabled. Firmware independently checks its RSA
signature before changing the boot slot. Public metadata contains no credentials.

## Release handoff

Use `ember-link/tools/firmware_manifest.py --download-url ...` to produce the
verified manifest and `tools/release_catalog.py` to assemble recommendations.
The cloud developer passes this same catalog to
`ember-app/backend/ember-link/publish-firmware.mjs --catalog ...`; it rejects an
artifact or recommendation that differs. `--dry-run` verifies inputs without AWS.
See the firmware repo's `docs/consumer-releases.md` for commands and publication order.

GitHub publication and AWS publication are separate operator actions, not an atomic
cross-service transaction. Publish the same catalog/artifact set to both, check
both, and avoid claiming instantaneous parity during a rollout. Production images
must use the production signing key already trusted by shipped devices.

## Validation on 2026-09-28

The local implementation has UI, Rust compatibility/integrity/boot-confirmation,
cloud authorization/catalog/badge, and firmware-native regression coverage. A
signed 0.3.5-dev image and catalog were generated and accepted by the publisher's
no-AWS dry run. No release was published and no device was flashed in this change.
Hardware Wi-Fi updates, power interruption, the earlier rollback watchdog finding,
and real platform app-upgrade qualification remain release gates. Old USB and
cloud successes do not qualify this new Wi-Fi consumer flow.
