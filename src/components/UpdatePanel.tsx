import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Section, ErrorNote } from "./ui";
export function UpdatePanel() {
  const [update, setUpdate] = useState<{
    version: string;
    notes: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (install: boolean) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (install && update) {
        await invoke("install_update", { version: update.version });
      } else {
        const available = await invoke<typeof update>("check_update");
        setUpdate(available);
        setMessage(
          available
            ? `Version ${available.version} is available.`
            : "You are up to date.",
        );
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="App updates">
      <p>
        Updates are verified with Ember’s release signature before installation.
        Finish your transfers and USB setup before restarting.
      </p>
      {message && <p role="status">{message}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {update?.notes && <pre className="release-notes">{update.notes}</pre>}
      <button disabled={busy} onClick={() => void run(false)}>
        {busy ? "Working…" : "Check for updates"}
      </button>{" "}
      {update && (
        <button
          className="primary"
          disabled={busy}
          onClick={() => void run(true)}
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
