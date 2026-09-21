/**
 * Send page: pick the target machine, pick a design file, check the
 * machine's storage, send, and watch the upload queue with live progress.
 *
 * The target picker writes the same shared selection the Machines page
 * uses, so choosing a machine in either place keeps both in sync.
 */

import { useEffect, useRef, useState } from "react";
import type { JobRecord, MachinesResponse, MachineStatus } from "../api/types";
import { useBridge } from "../hooks/useBridge";
import { usePolling } from "../hooks/usePolling";
import {
  EmptyState,
  ErrorNote,
  Pill,
  ProgressBar,
  Section,
} from "../components/ui";
import { formatBytes, formatTime, machineLabel } from "../lib/format";

export function SendPage() {
  const { client, selectedIp, setSelectedIp } = useBridge();

  const machines = usePolling<MachinesResponse>(
    client ? () => client.machines() : null,
    5000,
  );
  const machineStatus = usePolling<MachineStatus>(
    client && selectedIp ? () => client.machineStatus(selectedIp) : null,
    10000,
    selectedIp,
  );
  const jobs = usePolling<JobRecord[]>(
    client ? () => client.jobs() : null,
    1000,
  );

  // Saved machines first, then discovered ones not already saved.
  const saved = machines.data?.saved ?? [];
  const targets = [
    ...saved.map((m) => ({
      ip: m.ip,
      label: machineLabel({ nickname: m.nickname, ip: m.ip }),
    })),
    ...(machines.data?.discovered ?? [])
      .filter((d) => !saved.some((s) => s.ip === d.info.identity.ip))
      .map((d) => ({
        ip: d.info.identity.ip,
        label: machineLabel({
          name: d.info.identity.name,
          ip: d.info.identity.ip,
        }),
      })),
  ];

  // The single-machine household shouldn't need a click: default to the
  // first known machine. Never auto-clear — a briefly-offline machine keeps
  // its selection and shows its status error instead.
  const firstIp = targets[0]?.ip ?? null;
  useEffect(() => {
    if (!selectedIp && firstIp) setSelectedIp(firstIp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIp, firstIp]);

  // Follow a saved serial when discovery finds its new address.
  useEffect(() => {
    const moved = saved.find((m) => m.previousIps?.includes(selectedIp ?? ""));
    if (moved && !saved.some((m) => m.ip === selectedIp))
      setSelectedIp(moved.ip);
  }, [saved, selectedIp, setSelectedIp]);

  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [confirmAction, setConfirmAction] = useState<{
    label: string;
    run: () => Promise<void>;
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [sending, setSending] = useState(false);

  if (!client) return null;

  const send = async (overwrite = false) => {
    if (!file || !selectedIp || !machineStatus.data) return;
    if (
      !overwrite &&
      machineStatus.data.info.capabilities.overwritesByName &&
      machineStatus.data.storage.files.some(
        (n) => n.toLowerCase() === file.name.toLowerCase(),
      )
    ) {
      setConfirmAction({
        label: `Replace ${file.name} on this device?`,
        run: () => send(true),
      });
      return;
    }
    setSendError(null);
    setSending(true);
    try {
      await client.send(
        selectedIp,
        file.name,
        await file.arrayBuffer(),
        machineStatus.data.info.identity,
        overwrite,
      );
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await jobs.refresh();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const storage = machineStatus.data?.storage;
  const info = machineStatus.data?.info;

  return (
    <div className="page">
      {confirmAction && (
        <div
          className="confirmation"
          role="alertdialog"
          aria-label="Confirm device action"
        >
          <p>{confirmAction.label}</p>
          <button disabled={actionBusy} onClick={() => setConfirmAction(null)}>
            Cancel
          </button>{" "}
          <button
            className="danger"
            disabled={actionBusy}
            onClick={async () => {
              setActionBusy(true);
              try {
                await confirmAction.run();
                setConfirmAction(null);
              } catch (e) {
                setSendError(e instanceof Error ? e.message : String(e));
              } finally {
                setActionBusy(false);
              }
            }}
          >
            {actionBusy ? "Working…" : "Confirm"}
          </button>
        </div>
      )}
      <Section title="Target machine">
        {targets.length === 0 && !selectedIp ? (
          <EmptyState>
            No machines known yet — scan on the Machines page, or set up a
            dongle.
          </EmptyState>
        ) : (
          <select
            className="machine-select"
            value={selectedIp ?? ""}
            onChange={(e) => setSelectedIp(e.target.value || null)}
          >
            {/* Keep a vanished-but-selected machine choosable rather than
                silently retargeting the send. */}
            {selectedIp && !targets.some((t) => t.ip === selectedIp) && (
              <option value={selectedIp}>
                {selectedIp} (not seen right now)
              </option>
            )}
            {targets.map((t) => (
              <option key={t.ip} value={t.ip}>
                {t.label}
              </option>
            ))}
          </select>
        )}
        {!selectedIp ? null : machineStatus.error ? (
          <ErrorNote>
            {selectedIp}: {machineStatus.error}
          </ErrorNote>
        ) : !machineStatus.data ? (
          <EmptyState>Contacting {selectedIp}…</EmptyState>
        ) : (
          <>
            <div className="target-header">
              <strong>
                {info?.identity.name ?? info?.identity.model} · {selectedIp}
              </strong>
              <Pill tone="ok">online</Pill>
            </div>
            {storage && (
              <>
                <div className="storage-line">
                  <span>
                    Memory: {formatBytes(storage.usedBytes)} used of{" "}
                    {formatBytes(storage.totalBytes)}
                  </span>
                  <span className="dim">
                    {formatBytes(storage.freeBytes)} free
                  </span>
                </div>
                <ProgressBar
                  value={storage.usedBytes}
                  max={storage.totalBytes}
                />
                {storage.files.length > 0 && (
                  <div className="device-files">
                    <label>
                      Files on device ({storage.files.length})
                      <input
                        type="search"
                        placeholder="Search files"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <ul>
                      {storage.files
                        .filter((name) =>
                          name.toLowerCase().includes(search.toLowerCase()),
                        )
                        .map((name) => (
                          <li key={name}>
                            <span>{name}</span>
                            {info?.capabilities.canDeleteFiles &&
                              info.identity.serial && (
                                <button
                                  className="danger"
                                  onClick={() =>
                                    setConfirmAction({
                                      label: `Delete ${name} from ${info.identity.name ?? "this device"}? This cannot be undone.`,
                                      run: async () => {
                                        await client.deleteFile(
                                          info.identity.ip,
                                          name,
                                          info.identity.manufacturer,
                                          info.identity.serial!,
                                        );
                                        await machineStatus.refresh();
                                      },
                                    })
                                  }
                                >
                                  Delete
                                </button>
                              )}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Section>

      <Section title="Send a design">
        {sendError && <ErrorNote>{sendError}</ErrorNote>}
        <div className="send-controls">
          <input
            ref={fileInput}
            type="file"
            accept={
              info?.capabilities.formats.map((f) => `.${f}`).join(",") ||
              undefined
            }
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            className="primary"
            onClick={() => void send()}
            disabled={!file || !selectedIp || !machineStatus.data || sending}
          >
            {sending ? "Queuing…" : "Send to machine"}
          </button>
        </div>
        {file && (
          <p className="dim">
            {file.name} · {formatBytes(file.size)}
          </p>
        )}
      </Section>

      <Section title="Upload queue">
        {!jobs.data || jobs.data.length === 0 ? (
          <EmptyState>Nothing sent yet.</EmptyState>
        ) : (
          <ul className="job-list">
            {jobs.data.map((job) => (
              <li key={job.id} className="job-row">
                <div className="job-line">
                  <span className="job-name">{job.filename}</span>
                  <span className="dim">→ {job.ip}</span>
                  <JobStatePill job={job} />
                  <span className="dim job-time">
                    {formatTime(job.createdAtMs)}
                  </span>
                </div>
                {job.state === "uploading" && (
                  <ProgressBar value={job.sentBytes} max={job.totalBytes} />
                )}
                {job.state === "done" && job.storedAs && (
                  <p className="dim">Stored on machine as {job.storedAs}</p>
                )}
                {(job.state === "failed" ||
                  job.state === "needs_reconciliation") &&
                  job.error && <p className="job-error">{job.error}</p>}
                {(job.state === "queued" || job.state === "waiting") && (
                  <button
                    onClick={() => {
                      void client
                        .cancelJob(job.id)
                        .then(() => jobs.refresh())
                        .catch((e) => setSendError(String(e)));
                    }}
                  >
                    Cancel transfer
                  </button>
                )}
                {job.state === "needs_reconciliation" && (
                  <div>
                    <p>
                      Check the file on the device before continuing. This
                      transfer will not be sent again automatically.
                    </p>
                    <button
                      onClick={() =>
                        setConfirmAction({
                          label:
                            "Confirm you checked the device and the file arrived?",
                          run: async () => {
                            await client.resolveJob(job.id, true);
                            await jobs.refresh();
                          },
                        })
                      }
                    >
                      The file arrived
                    </button>{" "}
                    <button
                      onClick={() =>
                        setConfirmAction({
                          label:
                            "Confirm you checked the device and the file did not arrive?",
                          run: async () => {
                            await client.resolveJob(job.id, false);
                            await jobs.refresh();
                          },
                        })
                      }
                    >
                      The file did not arrive
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function JobStatePill({ job }: { job: JobRecord }) {
  switch (job.state) {
    case "waiting":
      return <Pill tone="warn">waiting for device</Pill>;
    case "cancelled":
      return <Pill tone="muted">cancelled</Pill>;
    case "needs_reconciliation":
      return <Pill tone="warn">check device</Pill>;
    case "queued":
      return <Pill tone="muted">queued</Pill>;
    case "uploading":
      return (
        <Pill tone="warn">
          uploading · {formatBytes(job.sentBytes)} /{" "}
          {formatBytes(job.totalBytes)}
        </Pill>
      );
    case "done":
      return <Pill tone="ok">done</Pill>;
    case "failed":
      return <Pill tone="err">failed</Pill>;
  }
}
