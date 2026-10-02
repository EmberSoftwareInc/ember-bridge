import { useEffect, useRef, useState } from "react";
import type { BridgeClient } from "../api/client";
import type { LinkFileEntry, LinkFileOperation, LinkFolder, MachineStatus, MachinesResponse } from "../api/types";
import { useBridge } from "../hooks/useBridge";
import { usePolling } from "../hooks/usePolling";
import { EmptyState, ErrorNote, Section } from "../components/ui";
import { formatBytes, machineLabel } from "../lib/format";

const join = (folder: string, name: string) => folder ? `${folder}/${name}` : name;
const parent = (path: string) => path.split("/").slice(0, -1).join("/");
type Edit = { kind: "mkdir" | "rename" | "move" | "delete"; entry?: LinkFileEntry };

export function FilesPage({ onSend }: { onSend: () => void }) {
  const { client, selectedIp, setSelectedIp } = useBridge();
  const machines = usePolling<MachinesResponse>(client ? () => client.machines() : null, 5000);
  // Identify once per selection. Periodic status checks share Bridge's operation
  // gate and can interrupt an in-flight file action or clear its confirmation UI.
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [observed, setObserved] = useState<{ip: string | null; data: MachineStatus | null; error: string | null}>({ip:null,data:null,error:null});
  useEffect(() => {
    let stopped = false;
    setObserved({ip:selectedIp,data:null,error:null});
    if(client && selectedIp) void client.machineStatus(selectedIp).then(
      data => { if(!stopped) setObserved({ip:selectedIp,data,error:null}); },
      error => { if(!stopped) setObserved({ip:selectedIp,data:null,error:error instanceof Error ? error.message : String(error)}); },
    );
    return () => { stopped = true; };
  }, [client, selectedIp, connectionAttempt]);
  const status = observed.ip === selectedIp ? observed : {data:null,error:null};
  const saved = machines.data?.saved ?? [];
  const targets = [...saved.filter(m => !m.manufacturer || m.manufacturer === "emberconnect").map(m => ({ ip: m.ip, label: machineLabel(m) })),
    ...(machines.data?.discovered ?? []).filter(d => d.info.identity.manufacturer === "emberconnect" && !saved.some(m => m.ip === d.info.identity.ip)).map(d => ({ ip: d.info.identity.ip, label: machineLabel(d.info.identity) }))];
  const first = targets[0]?.ip;
  useEffect(() => { if (!selectedIp && first) setSelectedIp(first); }, [selectedIp, first, setSelectedIp]);
  const identity = status.data?.info.identity;
  return <div className="page">
    <Section title="Files on Ember Link">
      <p>Organize the designs on your dongle over local Wi-Fi.</p>
      <label>Ember Link<select className="machine-select" value={selectedIp ?? ""} onChange={e => setSelectedIp(e.target.value || null)}>
        <option value="">Choose a dongle</option>
        {selectedIp && !targets.some(t => t.ip === selectedIp) && <option value={selectedIp}>{selectedIp}</option>}
        {targets.map(t => <option key={t.ip} value={t.ip}>{t.label}</option>)}
      </select></label>
      {identity?.manufacturer === "emberconnect" && status.data && Number.isFinite(status.data.storage.freeBytes) && <p className="dim">{formatBytes(status.data.storage.freeBytes)} free of {formatBytes(status.data.storage.totalBytes)}</p>}
      {machines.error && <ErrorNote>{machines.error}</ErrorNote>}
      {status.error && <><ErrorNote>{status.error}</ErrorNote><button onClick={() => setConnectionAttempt(n => n+1)}>Check connection</button></>}
      {!selectedIp && <EmptyState>Select a Link, or add one on the Machines page.</EmptyState>}
      {identity && identity.manufacturer !== "emberconnect" && <EmptyState>This file browser is for Ember Link dongles. Direct Brother connections still use the Send page.</EmptyState>}
    </Section>
    {client && identity?.manufacturer === "emberconnect" && identity.serial && selectedIp && !status.error && <DeviceFiles key={`${selectedIp}:${identity.serial}`} client={client} ip={selectedIp} serial={identity.serial} onSend={onSend} />}
  </div>;
}

function DeviceFiles({ client, ip, serial, onSend }: { client: BridgeClient; ip: string; serial: string; onSend: () => void }) {
  const [idle, setIdle] = useState(false);
  const [folder, setFolder] = useState<LinkFolder | null>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [value, setValue] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const execute = async (operation: LinkFileOperation, append = false) => {
    if (!idle || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice("");
    try {
      const result = await client.filesystem(ip, serial, operation);
      if (!alive.current) return;
      if (!("entries" in result)) throw new Error("The response was incomplete. Refresh the folder to check the result.");
      setFolder(old => append && old && old.revision === result.revision ? { ...result, entries: [...old.entries, ...result.entries] } : result);
      setPath(result.path); setEdit(null);
      if (operation.op !== "list") setNotice("Saved on Link. Reopen the machine’s USB design list to see the change.");
    } catch (e) {
      if (alive.current) {
        setFolder(null); setEdit(null);
        setError(`${e instanceof Error ? e.message : String(e)} No automatic retry was made. Refresh this folder before making another change.`);
      }
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const open = (next: string) => { setPath(next); void execute({ op: "list", path: next }); };
  const startEdit = (kind: Edit["kind"], entry?: LinkFileEntry) => {
    setEdit({kind, entry}); setValue(kind === "rename" ? entry!.name : ""); setConfirmed(false);
  };
  const submit = () => {
    if (!folder || !edit) return;
    const base = { revision: folder.revision, path: edit.entry ? join(path, edit.entry.name) : join(path, value) };
    if (edit.kind === "delete") { if (confirmed) void execute({ ...base, op: "delete" }); }
    else if (edit.kind === "mkdir") void execute({ ...base, op: "mkdir" });
    else void execute({ ...base, op: "move", destination: edit.kind === "rename" ? join(path, value) : join(value, edit.entry!.name) });
  };
  const nameValid = !!value && value.length <= 127 && !/[\\/:*?"<>|\x00-\x1f]/.test(value) && !/^[.~]|[. ]$/.test(value);
  return <Section title="Card contents" actions={<button onClick={onSend} disabled={busy}>Send a design…</button>}>
    <div className="files-safety">
      <p>Opening folders and changing files briefly disconnects and reconnects Link’s USB drive. Keep the embroidery machine idle and close its USB design list. If Link is connected to a computer, eject the drive before each read or change.</p>
      <label className="files-check"><input type="checkbox" checked={idle} disabled={busy} onChange={e => { setIdle(e.target.checked); setEdit(null); }} />The machine is idle, or I have ejected the drive on my computer</label>
    </div>
    {error && <ErrorNote>{error}</ErrorNote>}
    {notice && <p role="status">{notice}</p>}
    <div className="files-toolbar">
      <nav aria-label="Folder path" className="files-breadcrumbs"><button disabled={!idle || busy} onClick={() => open("")}>Card</button>{path.split("/").filter(Boolean).map((part, i, all) => <span key={i}> / <button disabled={!idle || busy} onClick={() => open(all.slice(0, i+1).join("/"))}>{part}</button></span>)}</nav>
      <div className="files-actions"><button disabled={!idle || busy} onClick={() => open(path)}>{folder ? "Refresh folder" : "Read folder"}</button><button disabled={!idle || busy || !folder} onClick={() => startEdit("mkdir")}>New folder</button></div>
    </div>
    {busy && <p role="status">Working with Link…</p>}
    {!folder && !busy && <EmptyState>{idle ? "Read the folder to see its contents." : "Confirm above when you are ready to browse."}</EmptyState>}
    {folder && <>
      <p className="dim">{folder.total} {folder.total === 1 ? "item" : "items"} in this folder. This view updates when you open or refresh it.</p>
      {folder.hidden > 0 && <p className="dim">{folder.hidden} system or unsupported entries are hidden.</p>}
      {path && <button disabled={!idle || busy} onClick={() => open(parent(path))}>← Parent folder</button>}
      <div className="files-table-wrap"><table className="files-table"><thead><tr><th>Name</th><th>Size</th><th>Actions</th></tr></thead><tbody>
        {folder.entries.map(entry => <tr key={entry.name}><td>{entry.kind === "folder" ? <button disabled={!idle || busy} onClick={() => open(join(path, entry.name))}>▸ {entry.name}</button> : <span>{entry.name}</span>}<span className="dim files-kind">{entry.kind === "folder" ? "Folder" : "File"}</span></td><td>{entry.kind === "file" ? formatBytes(entry.size) : "—"}</td><td><div className="files-actions">
          <button disabled={!idle || busy} onClick={() => startEdit("rename", entry)} aria-label={`Rename ${entry.name}`}>Rename</button><button disabled={!idle || busy} onClick={() => startEdit("move", entry)} aria-label={`Move ${entry.name}`}>Move</button><button className="danger" disabled={!idle || busy} onClick={() => startEdit("delete", entry)} aria-label={`Delete ${entry.name}`}>Delete</button>
        </div></td></tr>)}
      </tbody></table></div>
      {!folder.entries.length && <EmptyState>This folder is empty.</EmptyState>}
      {folder.nextOffset !== null && <button disabled={!idle || busy} onClick={() => void execute({op:"list", path, offset:folder.nextOffset!, revision:folder.revision}, true)}>Load more</button>}
    </>}
    {edit && <form className="files-editor" aria-label="File action" onSubmit={e => { e.preventDefault(); submit(); }}>
      <h3>{edit.kind === "mkdir" ? "New folder" : `${edit.kind === "rename" ? "Rename" : edit.kind === "move" ? "Move" : "Delete"} ${edit.entry!.name}`}</h3>
      {edit.kind === "delete" ? <><p>This permanently deletes the selected file or empty folder. Folders containing files will not be deleted.</p><label className="files-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />Delete {edit.entry!.name} from Link</label></> : <label>{edit.kind === "move" ? "Destination folder" : "Name"}<input autoFocus value={value} disabled={busy} maxLength={edit.kind === "move" ? 255 : 127} onChange={e => setValue(e.target.value)} placeholder={edit.kind === "move" ? "e.g. Projects/Flowers; leave empty for Card" : "Folder or file name"} /></label>}
      {edit.kind === "move" && <p className="dim">Enter an existing folder path from Card, using its exact spelling. Files already at the destination will never be replaced.</p>}
      {edit.kind === "rename" && edit.entry?.kind === "file" && <p className="dim">Keep the design’s file extension so your machine can recognize it.</p>}
      <div className="files-actions"><button type="button" disabled={busy} onClick={() => setEdit(null)}>Cancel</button><button className={edit.kind === "delete" ? "danger" : "primary"} disabled={!idle || busy || (edit.kind === "delete" ? !confirmed : edit.kind !== "move" && !nameValid)} type="submit">{edit.kind === "delete" ? "Delete permanently" : "Save change"}</button></div>
    </form>}
    <p className="dim">Use “Send a design” to add files to Card, then move them into folders here. Folder support varies by embroidery machine.</p>
  </Section>;
}
