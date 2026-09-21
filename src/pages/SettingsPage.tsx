/**
 * Settings page: pairing (API endpoint + token for Ember), CORS origin
 * allowlist, and bridge health.
 */

import { UpdatePanel } from "../components/UpdatePanel";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import type { Settings } from "../api/types";
import { useBridge } from "../hooks/useBridge";
import { ErrorNote, Pill, Section } from "../components/ui";

export function SettingsPage() {
  const { client } = useBridge();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [origins, setOrigins] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    client
      .settings()
      .then((s) => {
        setSettings(s);
        setOrigins(s.allowedOrigins.join("\n"));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [client]);

  if (!client) return null;

  const health = client.info;

  const copyToken = async () => {
    if (!settings) return;
    await navigator.clipboard.writeText(settings.apiToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const saveOrigins = async () => {
    setSaveState("idle");
    setError(null);
    try {
      const list = origins
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      await client.updateSettings(list);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch (e) {
      setSaveState("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Section title="Bridge">
        <dl className="kv">
          <dt>Local API</dt>
          <dd>
            http://127.0.0.1:{health.port}{" "}
            {health.serverRunning ? (
              <Pill tone="ok">running</Pill>
            ) : (
              <Pill tone="err">
                stopped{health.serverError ? ` — ${health.serverError}` : ""}
              </Pill>
            )}
          </dd>
          <dt>Version</dt>
          <dd>{health.version}</dd>
        </dl>
      </Section>

      <Section title="Connect Ember to this computer">
        <p>
          In the Ember web app, choose Ember Bridge to connect your machine.
          When this app asks, check the website address and click Approve.
        </p>
        <p className="dim">
          Opening Bridge from a website only opens the app. You still approve
          each new pairing request here.
        </p>
        <p className="dim">
          Ember Link cloud setup connects a dongle to your account and works
          without Bridge. The USB setup here connects it to Wi-Fi and pairs it
          with this computer for local transfers.
        </p>
        <button onClick={() => void openUrl("https://connect.emberdesign.net")}>
          Open Ember Link cloud setup
        </button>
      </Section>
      <UpdatePanel />
      <details>
        <summary>Advanced connection settings</summary>
        <Section title="Manual pairing token">
          <p className="dim">
            For integrations that cannot use the approval flow, this token
            grants access to your machines. Keep it private.
          </p>
          <div className="token-row">
            <code className="token">
              {settings
                ? tokenVisible
                  ? settings.apiToken
                  : "•".repeat(32)
                : "loading…"}
            </code>
            <button onClick={() => setTokenVisible((v) => !v)}>
              {tokenVisible ? "Hide" : "Show"}
            </button>
            <button onClick={copyToken} disabled={!settings}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </Section>

        <Section title="Allowed web origins">
          <p className="dim">
            Browser pages may only call the bridge from these origins (one per
            line, e.g. <code>https://ember.example</code>). Localhost and this
            app are always allowed.
          </p>
          <textarea
            rows={4}
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
            placeholder="https://ember.example"
            spellCheck={false}
          />
          <div>
            <button className="primary" onClick={saveOrigins}>
              {saveState === "saved" ? "Saved ✓" : "Save origins"}
            </button>
          </div>
        </Section>
      </details>
    </div>
  );
}
