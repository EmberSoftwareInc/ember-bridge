/**
 * App shell: sidebar navigation + page router (plain state, no router
 * dependency — five static pages don't warrant one).
 */

import { useEffect, useState } from "react";
import { BridgeProvider, useBridge } from "./hooks/useBridge";
import { usePolling } from "./hooks/usePolling";
import type { BridgeStatus, PendingPairing } from "./api/types";
import type { BridgeClient } from "./api/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import emberIcon from "./assets/ember-icon.svg";
import { MachinesPage } from "./pages/MachinesPage";
import { SetupPage } from "./pages/SetupPage";
import { SendPage } from "./pages/SendPage";
import { LogsPage } from "./pages/LogsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { HelpPage } from "./pages/HelpPage";
import "./App.css";

type Page = "machines" | "setup" | "send" | "logs" | "settings" | "help";

const PAGES: { id: Page; label: string }[] = [
  { id: "machines", label: "Machines" },
  { id: "send", label: "Send" },
  { id: "logs", label: "Logs" },
  { id: "settings", label: "Settings" },
  { id: "help", label: "Help" },
];

/**
 * Approve/Deny prompt for a browser's pairing request. Rendered above every
 * page — a pairing request should be impossible to miss, and approval must
 * live in this window precisely because no web page can reach into it.
 */
function PairingBanner({ client }: { client: BridgeClient }) {
  const pending = usePolling<PendingPairing | null>(
    () => client.pairingPending(),
    2000,
  );
  const [busy, setBusy] = useState(false);

  if (!pending.data) return null;
  const request = pending.data;

  const respond = async (approve: boolean) => {
    setBusy(true);
    try {
      await client.respondPairing(request.id, approve);
    } catch {
      // Request expired or was already answered; the next poll clears it.
    } finally {
      setBusy(false);
      void pending.refresh();
    }
  };

  return (
    <div className="pairing-banner">
      <div className="pairing-text">
        <strong>{request.origin}</strong>
        {request.appName !== "Unnamed app" && ` (${request.appName})`} wants to
        connect to machines on your local network.
      </div>
      <div className="pairing-actions">
        <button
          className="danger"
          disabled={busy}
          onClick={() => respond(false)}
        >
          Deny
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => respond(true)}
        >
          Approve
        </button>
      </div>
    </div>
  );
}

function Shell() {
  const { client, connectError, selectedIp } = useBridge();
  const [page, setPage] = useState<Page>("machines");
  const status = usePolling<BridgeStatus>(
    client ? () => client.status() : null,
    5000,
  );

  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    const navigate = async () => {
      const next = await invoke<string | null>("take_navigation");
      if (!stopped && next && ["machines", "settings", "setup"].includes(next))
        setPage(next as Page);
    };
    void listen("bridge-navigation", () => {
      void navigate();
    }).then((off) => {
      if (stopped) {
        off();
        return;
      }
      unlisten = off;
      void navigate();
    });
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);

  if (connectError) {
    return (
      <div className="boot-error">
        <h1>Ember Bridge</h1>
        <p>Could not reach the app backend: {connectError}</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <img className="brand-mark" src={emberIcon} alt="" /> Ember Bridge
        </div>
        {PAGES.map((p) => (
          <button
            key={p.id}
            className={`nav-item ${page === p.id ? "active" : ""}`}
            onClick={() => setPage(p.id)}
          >
            {p.label}
            {p.id === "send" && (status.data?.pendingUploads ?? 0) > 0 && (
              <span className="badge">{status.data!.pendingUploads}</span>
            )}
          </button>
        ))}
        {
          <button
            className={`nav-item setup-cta ${page === "setup" ? "active" : ""}`}
            onClick={() => setPage("setup")}
          >
            Set up Ember Link
          </button>
        }
        <div className="sidebar-footer">
          <div
            className={`dot ${status.data?.server.running ? "dot-ok" : "dot-err"}`}
          />
          {status.data?.server.running
            ? "Local bridge ready"
            : "Bridge offline"}
          {selectedIp && <div className="dim">Target: {selectedIp}</div>}
        </div>
      </nav>
      <main className="content">
        {client && <PairingBanner client={client} />}
        {page === "machines" && (
          <MachinesPage
            onSetup={() => setPage("setup")}
            onSend={() => setPage("send")}
          />
        )}
        {page === "setup" && <SetupPage onReady={() => setPage("machines")} />}
        {page === "send" && <SendPage />}
        {page === "logs" && <LogsPage />}
        {page === "settings" && <SettingsPage />}
        {page === "help" && <HelpPage />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BridgeProvider>
      <Shell />
    </BridgeProvider>
  );
}
