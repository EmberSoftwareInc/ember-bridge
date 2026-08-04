/**
 * Logs page: incremental polling of the app's ring-buffer log.
 */

import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "../api/types";
import { useBridge } from "../hooks/useBridge";
import { EmptyState } from "../components/ui";
import { formatTime } from "../lib/format";

export function LogsPage() {
  const { client } = useBridge();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const lastSeq = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!client) return;
    let stopped = false;
    const poll = async () => {
      try {
        const result = await client.logs(lastSeq.current);
        if (stopped || result.entries.length === 0) return;
        lastSeq.current = result.lastSeq;
        setEntries((prev) => [...prev, ...result.entries].slice(-1000));
      } catch {
        // Transient; next poll retries.
      }
    };
    poll();
    const handle = setInterval(poll, 1000);
    return () => {
      stopped = true;
      clearInterval(handle);
    };
  }, [client]);

  // Keep the newest entry in view.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [entries]);

  const copyDiagnostics = async () => {
    if (!client) return;
    setCopyState("copying");
    try {
      const [status, logs] = await Promise.all([client.status(), client.logs(0)]);
      const lines = [
        "Ember Bridge diagnostics",
        `Generated: ${new Date().toISOString()}`,
        `Bridge version: ${status.version}`,
        `API version: ${status.apiVersion}`,
        `Platform: ${navigator.userAgent}`,
        `API: ${status.server.running ? "running" : "stopped"} on port ${status.server.port}`,
        `API error: ${status.server.error ?? "none"}`,
        `Uptime: ${status.uptimeSeconds} seconds`,
        `Saved machines: ${status.savedMachines}`,
        `Pending uploads: ${status.pendingUploads}`,
        "",
        "Activity log:",
        ...logs.entries.map(
          (entry) =>
            `${new Date(entry.timestampMs).toISOString()} ${entry.level.toUpperCase()} ${entry.message}`,
        ),
      ];
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
    }
  };

  return (
    <div className="page page-logs">
      <div className="log-toolbar">
        <div>
          <strong>Support diagnostics</strong>
          <div className="dim">Includes system details and activity, but no API token or WiFi password.</div>
        </div>
        <button onClick={() => void copyDiagnostics()} disabled={!client || copyState === "copying"}>
          {copyState === "copying"
            ? "Collecting…"
            : copyState === "copied"
              ? "Copied!"
              : copyState === "error"
                ? "Copy failed — retry"
                : "Copy diagnostics"}
        </button>
      </div>
      {entries.length === 0 ? (
        <EmptyState>No activity yet.</EmptyState>
      ) : (
        <div className="log-view" ref={scroller}>
          {entries.map((entry) => (
            <div key={entry.seq} className={`log-entry log-${entry.level}`}>
              <span className="log-time">{formatTime(entry.timestampMs)}</span>
              <span className="log-level">{entry.level}</span>
              <span className="log-message">{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
