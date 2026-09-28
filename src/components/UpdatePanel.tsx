import { useAppUpdates } from "../hooks/useAppUpdates";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Section, ErrorNote } from "./ui";
export function UpdatePanel() {
  const { update, busy, checked, error, check, install } = useAppUpdates();
  const message = update ? `Version ${update.version} is available.` : checked ? "You are up to date." : null;
  return (
    <Section title="App updates">
      <p>
        Bridge checks at startup and every six hours. Updates are verified with Ember’s release signature before installation.
        Finish your transfers and USB setup before restarting.
      </p>
      {message && <p role="status">{message}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {update?.notes && <pre className="release-notes">{update.notes}</pre>}
      <button disabled={busy} onClick={() => void check()}>
        {busy ? "Working…" : "Check for updates"}
      </button>{" "}
      {update && (
        <button
          className="primary"
          disabled={busy}
          onClick={() => void install()}
        >
          Install {update.version} and restart
        </button>
      )}{" "}
      <button
        onClick={() =>
          void openUrl(
            "https://github.com/EmberSoftwareInc/ember-bridge/releases",
          )
        }
      >
        Release notes
      </button>
    </Section>
  );
}
