# Ember Bridge 0.5.5 release qualification

Status: preparing release on 2026-10-19.

## Scope

Preserves connection probe failures instead of misreporting a changed device
identity, adds resolution failure and rediscovery diagnostics, and gates the
always-visible Ember Link tab's pulse on local USB detection. Selecting the tab
or requesting reduced motion suppresses the pulse. USB presence is polled every
two seconds using the existing port enumeration, without opening the device.

The release is prepared in an isolated worktree from the 0.5.4 publication
commit. Pending Windows signing workflow, scripts and documentation changes are
excluded. Machine timeouts, retry policy and firmware channels are unchanged.
This patch does not establish or fix the cause of the SE700's network stalls.

## Validation

- 34 frontend tests, production build, bundle check and version consistency pass.
- 75 Rust tests pass, including timeout/unreachable/protocol error preservation,
  rediscovery recovery and refusal of mismatched or ambiguous identities.
- Platform release builds, final artifact signatures, upgrade qualification and
  public download verification remain pending.
