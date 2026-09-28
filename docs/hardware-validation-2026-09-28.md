# Bridge hardware validation — 2026-09-28

These checks use a local debug bundle built from the `codex/bridge-modernization`
working tree. No release was published and the installed application was not
replaced. The test bundle is under `src-tauri/target/debug/bundle/macos/`.

## Setup and update fixes

- Each USB device session owns its setup form. Disconnects/device swaps discard
  old scan and provisioning results and clear the password field.
- Wi-Fi setup and scans stay disabled throughout a USB firmware update and its
  boot check. The update remains visible during expected USB disappearance.
- An event-listener failure releases the update lock.
- The updater reacquires the same USB serial identity, then requires a changed
  OTA slot and `pendingVerify: false`. Signature acceptance alone, a rollback to
  the old slot, or another device returning does not qualify as update success.
- USB setup instructions describe the double-press gesture and FAT32 card.

## Automated checks

- 11 frontend tests cover sending, polling, setup disconnect/swap recovery,
  update locking, listener failure, an unconfirmed reboot and idle Wi-Fi status
  refresh without overwriting edited fields.
- 59 Rust tests pass (28 library, 18 API, 13 dongle-client tests), including
  rejection of old-slot, unconfirmed and mismatched-device boot results.
- TypeScript, Vite and frontend bundle verification pass; macOS debug app builds.
- The first sandboxed socket-based test run was blocked by OS permissions;
  running with local networking enabled passes.

## Direct Brother Wi-Fi transfer

Machine: Brother NQ1700E, firmware 1.71. The user confirmed the Link dongle was
unplugged and the Brother was idle on Wi-Fi. The updated Bridge app identified
it and read its available storage. The initial status probe briefly reported
unreachable, then polling recovered without restarting the app; the cause of
that transient response was not established.

Used the normal desktop Send screen and file picker to send generated
`BRDIRECT.PES` (1,335-byte, approximately 20 mm triangle; SHA-256
`6828cd74d2147c4f19704c1ec1c0ec20f625f01b5f82898819b8b479c7513a39`).
Bridge's queue reached `done`, reported `32769.PES` as the assigned machine
filename, and the device file list showed that file with corresponding memory
usage. The user confirmed that the triangle previews successfully on the
Brother with the Link dongle unplugged. This validates the desktop Bridge →
local Wi-Fi → Brother storage → preview path. No user designs were sent or
deleted, and no stitching was initiated.

## Bridge USB update

Bridge detected Link 0.3.2-dev over USB setup and scanned nearby Wi-Fi networks.
The first status snapshot was taken before Wi-Fi finished joining and remained
stale; added an idle-only refresh that preserves the user's form edits.

Through Bridge's Firmware update section, reinstalled the existing signed
0.3.2-dev image (SHA-256
`1f449d3a93bbdf7d7e0b8416da68cd510bfd3057d88fd842eba44009d6c455f2`).
The card was safely unmounted first. Verified in the actual app that network,
Connect and firmware controls stayed disabled during the update, then became
available when Bridge reported a successful restart. An independent USB read
confirmed the slot changed from `ota_1` to `ota_0`, `pendingVerify` is false,
USB setup mode survived the software restart, and Wi-Fi/cloud are still online.
This was a same-version signed reinstall, not a power-interruption test.

## Bridge USB provisioning and pairing

The user entered the Wi-Fi password directly in Bridge and confirmed “Dongle
ready—paired with Bridge.” The saved-machines screen contains the paired Ember Link,
and authenticated Bridge status successfully reads the Link identity and its
existing card files. A first status call returned HTTP 502 just after setup;
a subsequent info/status check succeeded. No cause for that transient was
established. The card was safely unmounted before moving back to the machine.

## Bridge local Link transfer

After the user moved Link back to the Brother, Bridge reacquired it on local
Wi-Fi and listed the existing files. Sent generated `BRLOCAL.PES` through the
normal desktop file picker and Send screen: 1,371 bytes, square design, SHA-256
`c945d4e3c55356f8b15580397c859335e8843d689ebb704cea3beb032ed0a452`.
The local Bridge queue reached `done`, reporting all bytes sent and the filename
preserved as `BRLOCAL.PES`. This used the local authenticated dongle API, not
cloud delivery. The user confirmed the square previews successfully on the
Brother. Then selected a generated triangle under the same filename: Bridge
asked “Replace BRLOCAL.PES on this device?” before sending. After confirming,
the replacement job reached `done` with 1,335 bytes. The user reopened the USB
list and confirmed `BRLOCAL.PES` now previews as a triangle, validating that the
Brother saw the replacement rather than the cached square.

Deleted only `BRLOCAL.PES` through Bridge's authenticated local delete endpoint,
with the expected Link manufacturer/serial and explicit confirmation parameter.
The request succeeded, the subsequent file list omitted `BRLOCAL.PES`, and the
other filenames were unchanged: the original design and `ELCHECK.PES` remained.
Bridge's actual UI refreshed to show two files. The physical deletion used the
API; the UI confirmation behavior is covered by automated tests. No stitching
was initiated.

## Remaining hardware checks

- Cloud/local contention, interrupted operations and prolonged reliability.
- Browser-to-Bridge pairing/sending and installed-release desktop integration.
