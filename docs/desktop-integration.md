# Desktop integration and releases (0.5.0)

The repository was transferred, preserving history and releases, to
https://github.com/EmberSoftwareInc/ember-bridge. Update existing clones with:

```sh
git remote set-url origin https://github.com/EmberSoftwareInc/ember-bridge.git
```

The bundle ID remains `app.ember.bridge` so saved machines, API credentials,
dongle pairing tokens, and launch-at-login settings continue to use the same
application identity. Internal manufacturer ID `emberconnect` remains stable;
the consumer-facing hardware name is Ember Link. Both old and new mDNS services
and health names are accepted.

## Product boundary

Bridge is a standalone local app: USB Wi-Fi setup and local pairing, device
discovery, transfers, file management, diagnostics, and USB firmware installation.
It requires no Ember account and issues no cloud claim, configuration, enable,
or disable commands. Existing cloud enrollment stays unchanged. App updates from
GitHub update Bridge itself, not the dongle's cloud service.

Direct Brother Wi-Fi remains supported. The authenticated browser API and pairing
flow remain available so Ember's web editor can send locally through Bridge,
including to supported Brother machines without a dongle. Browser integration is
optional for desktop users. All cloud-service control belongs to the Ember web app.

## Browser launch

Use an ordinary user-clicked link such as:

```html
<a href="ember-bridge://connect">Open Ember Bridge</a>
```

Supported destinations: `open` (Machines), `connect` (Settings), `setup` (USB
setup). Extra paths, query strings, fragments, credentials, ports, and other
commands are rejected. No token, filename, account credential, or transfer is
accepted via a URL. Launching does not approve pairing. Continue the existing
origin-gated `/api/pair` flow and require desktop approval. Keep a download link
visible if the app is not installed; browsers cannot reliably prove installation.
Single-instance handling brings the existing window forward. macOS registers
the scheme from the installed bundle; Windows/Linux register at app startup.

## API additions

Existing endpoints and `apiVersion: 1` remain. Integrations must tolerate these
additional job states: `waiting`, `cancelled`, `needs_reconciliation`.

- `POST /api/send?ip=…&filename=…&manufacturer=…&serial=…&overwrite=true` accepts
  explicit identity and replacement confirmation. Omit `overwrite` normally;
  existing names on Link fail with `file_exists` unless replacement was approved.
  Saved/discovered identities are used if an older caller omits identity fields.
- `POST /api/jobs/{id}/cancel` cancels queued/waiting jobs only.
- `POST /api/jobs/{id}/resolve` with JSON `{ "delivered": true }` (or false) records
  the user's check of an uncertain outcome. It never resends a design.
- `DELETE /api/files?ip=…&filename=…&manufacturer=…&serial=…&confirmed=true` deletes
  a file only after explicit confirmation and identity verification. Check
  `info.capabilities.canDeleteFiles` first.
- Capabilities also include `overwritesByName`; file pickers should use `formats`.
- Saved machines gain optional `serial` and `previousIps`. Use the current address
  returned by discovery/status; identity checks protect sends through old aliases.

New mutations use the existing token/Origin protection. Status/discovery return
`device_busy` while another machine operation is active. Poll after completion,
without overlapping requests or showing late results for another selected target.
The queue retries explicit dongle `busy`/`storage_busy` replies for about 60 seconds;
it never retries transport failures after an upload request. There is no automatic
cloud fallback. A cloud sender and Bridge still require firmware-level conditional
writes for atomic “create only” semantics; preflight replacement checks cannot
eliminate that race.

## App updates

Settings checks the published GitHub release's `latest.json`. Tauri verifies every
update against the public key in `src-tauri/tauri.conf.json`. Installation requires
an explicit user click, an empty transfer queue, and no active USB setup/update.
It restarts Bridge. The first release with this updater must be installed manually;
0.4.2 cannot discover updates itself.

The transferred repository retains Apple signing/notarization secrets. A distinct
`TAURI_SIGNING_PRIVATE_KEY` Actions secret signs updater artifacts. Its matching
local recovery copy is `.release-keys/bridge.key` (owner-only, gitignored); back it
up to the organization’s secret manager. Never commit or publish it. Losing this
key prevents installed clients from accepting future updates signed with a new
key. Updater signatures do not replace Apple notarization or Windows code signing.

The release workflow tests all three platforms, builds installers and signed
updater artifacts, and assembles `latest.json` on a **draft** release. Publish only
after checking all platform artifacts and signatures. An unpublished first release
may make the in-app check report that no signed release is available yet.

For a local build, pass the private-key **path**, avoiding shell command substitution:

```sh
TAURI_SIGNING_PRIVATE_KEY="$PWD/.release-keys/bridge.key" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" npm run tauri build -- --bundles app
```

Contributors can build without organization keys:

```sh
npm run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

## macOS Dock behavior

0.4.2 requested `Accessory` activation policy at runtime but lacked `LSUIElement`
in its bundle. 0.5.0 declares both. Closing the window hides it; the menu-bar Quit
command exits the process. A Dock item explicitly kept by a user is a separate
Dock preference and is not removed by this app. Development builds, another
installed copy, and stale Launch Services registrations can also confuse testing.
Check the bundle version/path before comparing behavior.

## Release qualification

Automated tests cover URL validation, polling races, queue persistence/capacity,
cancellation, uncertain delivery, busy retry, identity mismatch/rediscovery, and
mock-device HTTP contracts. Real Brother and Link transfers, concurrent cloud/local
traffic, OS login startup, Windows/Linux URL handling, and an installed update from
one published signed version to the next still need release qualification. No
firmware or cloud-backend deployment is required for this desktop branch.

## Local validation performed

On macOS, the packaged 0.5.0 app retained the existing saved machine, launched via
`ember-bridge://connect` from a stopped state, and handled `ember-bridge://setup`
in the running instance. The process reported accessory activation policy; the
bundle contains `LSUIElement=true`. Starting with `--minimized` showed zero
visible standard windows and retained accessory policy, matching the login
startup path. Update checking shows a recoverable message
while the first signed release remains unpublished. A signed `.app.tar.gz`
updater artifact was built locally. The existing `/Applications` installation
was left intact; the development bundle is under
`src-tauri/target/release/bundle/macos/Ember Bridge.app`.
