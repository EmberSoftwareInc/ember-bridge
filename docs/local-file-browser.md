# Local Ember Link file browser

Implemented on `feature/local-file-browser` in Bridge and Link firmware.
No cloud, account, web app or enrollment changes are included.

## Using Files

1. Select an Ember Link on the **Files** page. Direct Brother Wi-Fi connections
   keep using **Send**; this browser does not manage Brother internal storage.
2. Leave the embroidery machine idle and close its USB design list. If Link is
   attached to a computer, eject the drive before each read or change. Confirm
   this in the page.
3. Read the card, open folders, and use the breadcrumbs to navigate.
4. Create folders, rename entries, or move them to an existing folder. The move
   destination is an exact path from Card, such as `Projects/Flowers`; an empty
   destination means Card. Moving retains the filename. Rename retains neither
   an extension automatically nor a backup, so keep the design's extension.
5. Delete requires another explicit confirmation. Only files and empty folders
   can be deleted. Nothing recursively erases a directory.
6. Add designs through **Send a design**, then move them from Card into folders.
   Reopen the embroidery machine's USB list after changes.

New firmware advertising `fileSystemProtocolVersion: 1` is required. Older Link
firmware displays update guidance. Existing uploads and root-file APIs continue
working. Firmware and Bridge releases must be published separately.

## Safety and operation boundaries

Every browse, page load, refresh, or mutation explicitly asks the dongle to
claim the card and reconnect USB afterward. There is no background directory
polling. The page keeps its displayed snapshot until the next user action.
Machine status is checked once when selecting a device, with an explicit retry
on connection failure; it does not poll during file operations.

Bridge verifies the requested serial, follows discovery if an address moved,
and rechecks the live serial and protocol capability immediately before use.
The existing local origin/token checks, lifecycle lock and operation gate apply.
Queued transfers must finish or be cancelled first. The new firmware route
always requires Link's pairing token, including in hotspot setup mode.

File requests have a 1 KiB body limit. Paths are relative, printable ASCII,
at most 255 bytes, up to eight components, each at most 127 bytes. Traversal,
absolute paths, reserved/internal names, FAT-invalid names, short-name aliases,
noncanonical casing and symlinks are rejected. Case-only rename is not supported;
use a distinct intermediate name. No move silently overwrites a destination.

Folders return 32 entries per page, with a 4,096-entry scan limit per folder.
Oversized folders fail explicitly. Unsupported/system entries are hidden and
counted, not silently treated as deletable files. Populated folder moves also
validate the resulting subtree against path/depth and traversal-work limits.

Mutation requests include the reviewed source-directory revision. Firmware
rescans under exclusive card ownership before making a change. The revision
includes a boot nonce and actionable directory metadata; pagination also checks
it. Hidden host metadata is excluded to tolerate macOS USB reconnects. This
is an optimistic metadata check, not a cryptographic content version: another
USB host can replace bytes while preserving size and FAT timestamps. Keep the
machine idle/eject the drive as instructed, and refresh after external changes.

Writes are never retried automatically and redirects are not followed. A lost
response, I/O error, or USB handoff error clears actionable rows and requires
inspection/refresh. Moving is a same-volume FAT rename, not copy-then-delete.
These are not journaled FAT transactions: unexpected power loss during directory
metadata updates can still require filesystem repair. Do not unplug during an
operation. No undo, trash, bulk deletion, download or stitch preview is included.

## Local API

Bridge: `POST /api/link/filesystem?ip=...&manufacturer=emberconnect&serial=...`
(authenticated localhost API). It forwards a single authenticated request to
Link's `POST /api/fs`. JSON examples:

```json
{"op":"list","path":"Projects","confirmedIdle":true}
{"op":"list","path":"Projects","offset":32,"revision":"0123456789abcdef","confirmedIdle":true}
{"op":"mkdir","path":"Projects/Flowers","revision":"0123456789abcdef","confirmedIdle":true}
{"op":"move","path":"Projects/rose.pes","destination":"Projects/Flowers/rose.pes","revision":"0123456789abcdef","confirmedIdle":true}
{"op":"delete","path":"Projects/rose.pes","revision":"0123456789abcdef","confirmedIdle":true}
```

Root is `""`. For mutations, revision is from the source parent (for mkdir,
from the destination parent). Success returns that parent's refreshed first
page before giving the card back, avoiding a second remount. A list response
contains `path`, `revision`, `entries: [{name,kind,size}]`, `total`, `hidden`, and
`nextOffset` (number or null). Firmware errors have stable `error.code` values;
Bridge maps them to safe, actionable text.

## Validation and physical qualification

Local checks: firmware native ASan/UBSan suites; ESP-IDF firmware build; Bridge
Rust unit/API/mock-dongle tests; React tests; TypeScript and Vite production
build; simulated browser UI flow. The new checks cover unsafe paths, symlinks,
case conflicts, unchanged source data on failures, stale snapshots, pagination,
nonrecursive deletion, identity/capability checks, authentication, no replay or
redirect, confirmation gates and late responses after selecting another device.

Before release, use a backed-up spare FAT32 card:

- List, create, rename, move a design into/out of folders; compare its bytes.
- Move a populated folder; confirm collisions/nonempty deletes leave files intact.
- Confirm nested designs are visible and preview on the Brother NQ1700E.
- Exercise enough files for multiple pages, busy transfers, Wi-Fi interruption,
  and a changed directory between listing and action.
- Check reconnects while idle, old-firmware guidance, and filesystem integrity.
- Run deliberate power-cut qualification only with a disposable/backed-up card.

Folder compatibility and naming limits also depend on the embroidery machine.
Cloud browsing/operations require a separate future protocol and backend change.

### Hardware results (2026-10-02)

Tested with local firmware `0.3.8-dev.1-files.2`, the Bridge feature build,
a LILYGO T-Dongle-S3, and a Brother NQ1700E. These results precede the final
versioned release packages; those packages require separate qualification.

Passed on the second 120 MiB FAT32 card:

- Reader writes and two remount comparisons of 36 generated files.
- Dongle USB writes and two remount comparisons of 71 generated files.
- Fifteen Bridge API checks covering directory listing, 35-file pagination,
  create, rename, move into/out of folders, populated-folder moves, file/empty
  folder deletion, stale revisions, collision protection and nonempty-folder
  refusal. Most requests completed in under a second.
- Native Bridge listing, nested navigation and folder creation.
- Root and moved nested square previews on the Brother; the machine remained
  responsive in both checks.
- Final independent-reader audit: `fsck_msdos -n` exited 0, both FAT copies
  matched, and all 70 remaining generated files matched names and SHA-256 hashes.
  The checker’s only `Warning:` line was its file-count/free-space summary.

Testing exposed two corrected issues: hidden macOS metadata churn caused false
stale revisions, and periodic device-status requests competed with file operations.
Native and React regression tests cover these corrections. A concurrent UI
connection check correctly rejected a file request as busy; the test inspected
current state before resuming, without automatically retrying the mutation.

The first card developed malformed directory entries during the larger USB-write
fixture test. Original designs remained byte-identical to backups. An independent
reader saw the same damage; a saved raw image contained damaged directory records,
orphaned clusters and differences between FAT copies, including unused space.
Two subsequent full reader reads matched that image exactly. The cause remains
unresolved. The card/image are preserved privately and were not repaired or
formatted. This failure must not be represented as a proven defective card or a
proven firmware defect. The second card was initially unmountable, then formatted
with explicit owner permission before the passing comparison.

No power-cut safety, multi-day endurance, stitch-out, or broad machine-compatibility
claim follows from these checks. Cloud behavior was not changed or tested.

## Development reliability check

Use the second, verified card and keep backups. Record the exact firmware/app
versions and the date of each session. Use generated or backed-up designs.

For at least three normal-use sessions over several days:

1. Send a new design through Bridge and preview it on the Brother.
2. With the machine idle and its USB list closed, create a folder, rename/move a
   design, move it back, and delete only a disposable file and an empty folder.
3. Reopen the machine’s USB list and preview the moved design.
4. Reconnect Link normally once all operations have finished. Check its files,
   Wi-Fi, and display/LED preferences are retained.
5. Record errors, missing/duplicate entries, unexpected disconnects or changed
   file contents. Do not automatically repeat a change after an uncertain result.

At the end, compare retained design hashes on a reader and run a read-only FAT
check. Any corruption, unexplained data change or machine freeze blocks stable
promotion. Preserve the card and logs before repair. Stable release qualification
also needs review of the unresolved first-card failure and testing of the exact
stable packages. Firmware prerelease testing is opt-in; no automatic stable
upgrade or new Bridge app update channel is introduced.
