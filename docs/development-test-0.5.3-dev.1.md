# Bridge 0.5.3-dev.1 local test build

Source commit: `6376df7df40d6d797c2141cd6031e85359fd3492` on
`feature/local-file-browser`. Intended firmware: Ember Link `0.3.8-dev.2`.

The optimized Apple Silicon macOS app is locally ad-hoc signed and verified; it
is not a notarized public installer. The archive contains the app bundle only,
not user configuration, pairing tokens or signing keys.

Archive: `Ember-Bridge-0.5.3-dev.1-macOS-arm64.zip`.
SHA-256: `ace9ecec9462d10ad5cf26c1973fb11c6507d0840c0c0830b28342d75724ebe7`.

Source validation passed: 31 frontend tests, 71 Rust unit/integration tests,
TypeScript/Vite production build, version consistency, and optimized app build.
The packaged app launched and its local API reported `0.5.3-dev.1`; saved
machines remained present. Its local signature verified after packaging.
Feature hardware evidence, the first-card investigation and the multi-day
reliability checklist are in [local file browser](local-file-browser.md).

Quit other Bridge copies before launching this test build. It uses the existing
Bridge configuration. Use a verified card and backed-up designs. Development
firmware publication/qualification is tracked separately in the Link repository.
This build does not add a Bridge app Development update channel or change the
stable updater feed. Stable remains Bridge 0.5.2 until review and qualification.

The exact numbered firmware and browser installer passed their own checks on
2026-10-02. The packaged app paired the freshly installed spare and passed 12
checks covering delivery, pagination, folder creation, file/folder moves and
renames, deletion, stale revisions and protective refusals. The Brother NQ1700E
previewed `FBREL2/REL038.PES` with no loss of responsiveness. After a normal
power cycle, all 71 retained designs matched expected SHA-256 hashes and Wi-Fi
was retained. The earlier reader FAT audit remains supporting evidence; it was
not repeated as a raw FAT audit after these final package checks.

Multi-day use, investigation of the first card's unexplained corruption, and
stable installer qualification remain pending. Do not promote on these checks
alone.
