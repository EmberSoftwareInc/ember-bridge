import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ErrorNote } from "./ui";
export type LinkTarget = { transport: "usb"; port: string; serial: string } | { transport: "wifi"; ip: string; serial: string };
export type LinkRelease = { releaseId: string; targetVersion: string; sha256: string; notes: string };
export type LinkOffer = { currentVersion: string; supported: boolean; release: LinkRelease | null; message: string | null };
const Firmware = createContext<{ open: (target: LinkTarget, name: string) => void; busy: boolean; revision: number } | null>(null);
export function LinkFirmwareProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<{ target: LinkTarget; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  return <Firmware.Provider value={{ open: (target, name) => setSelection({ target, name }), busy, revision }}>
    {children}
    {selection && <FirmwareDialog key={JSON.stringify(selection.target)} {...selection} onBusy={setBusy}
      onClose={() => { if (!busy) { setSelection(null); setRevision(n => n + 1); } }} />}
  </Firmware.Provider>;
}
export function LinkFirmwareButton({ target, name, disabled = false, label = "Firmware" }: { target: LinkTarget; name: string; disabled?: boolean; label?: string }) {
  const context = useContext(Firmware);
  const [available, setAvailable] = useState(false);
  const identity = JSON.stringify(target);
  useEffect(() => {
    if (!context || context.busy || disabled) return;
    let cancelled = false;
    const check = async () => {
      try { const result = await invoke<LinkOffer>("link_check_update", { target: JSON.parse(identity) }); if (!cancelled) setAvailable(Boolean(result.release)); }
      catch { if (!cancelled) setAvailable(false); } // Background errors belong in the explicit check dialog.
    };
    void check();
    const timer = setInterval(() => void check(), 6 * 60 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [identity, context?.busy, context?.revision, disabled]);
  if (!context) return null;
  return <button disabled={disabled || context.busy} onClick={() => context.open(target, name)}>
    {available ? "Firmware update available" : label}
  </button>;
}
function FirmwareDialog({ target, name, onBusy, onClose }: { target: LinkTarget; name: string; onBusy: (busy: boolean) => void; onClose: () => void }) {
  const [offer, setOffer] = useState<LinkOffer | null>(null);
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [installed, setInstalled] = useState(false);
  const alive = useRef(true);
  const dialog = useRef<HTMLDivElement>(null);
  async function check() {
    setChecking(true); setError(""); setOffer(null); setConfirmed(false);
    try { const next = await invoke<LinkOffer>("link_check_update", { target }); if (alive.current) setOffer(next); }
    catch (e) { if (alive.current) setError(String(e)); }
    finally { if (alive.current) setChecking(false); }
  }
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus(); void check();
    return () => { alive.current = false; previous?.focus(); };
  }, []);
  async function install() {
    if (!offer?.release || !confirmed || installing) return;
    setInstalling(true); onBusy(true); setError(""); setMessage("Preparing firmware update…");
    let off: (() => void) | undefined;
    try {
      off = await listen<string>("link-firmware-progress", e => { if (alive.current) setMessage(e.payload); });
      await invoke("link_install_update", { target, releaseId: offer.release.releaseId, sha256: offer.release.sha256, confirmed: true });
      if (alive.current) { setMessage(`Ember Link is running ${offer.release.targetVersion}.`); setInstalled(true); }
    } catch (e) { if (alive.current) { setError(String(e)); setMessage(""); setOffer(null); setConfirmed(false); } }
    finally { off?.(); onBusy(false); if (alive.current) setInstalling(false); }
  }
  return <div className="firmware-overlay"><div ref={dialog} tabIndex={-1} className="firmware-dialog" role="dialog" aria-modal="true" aria-labelledby="link-firmware-title" onKeyDown={e => {
    if (e.key === "Escape" && !installing && !checking) onClose();
    if (e.key === "Tab") {
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []);
      const first = items[0], last = items[items.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first.focus(); }
    }
  }}>
    <h2 id="link-firmware-title">Ember Link firmware</h2>
    <p>{name} · {target.transport === "wifi" ? "Local Wi-Fi" : "USB"}</p>
    {checking && <p role="status">Checking for compatible firmware…</p>}
    {offer && <p>Installed: <strong>{offer.currentVersion}</strong></p>}
    {offer?.message && <p>{offer.message}</p>}
    {offer?.supported && !offer.release && !offer.message && <p>No new compatible firmware is available.</p>}
    {offer?.release && !installed && <>
      <p>Available: <strong>{offer.release.targetVersion}</strong></p>
      <pre className="release-notes">{offer.release.notes || "No release notes supplied."}</pre>
      <p>Link will restart and briefly disconnect from your embroidery machine. Keep Link powered on and Bridge open until the update is confirmed.</p>
      <label className="firmware-consent"><input type="checkbox" disabled={installing} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />My embroidery machine is idle and Link may restart.</label>
      <button className="primary" disabled={!confirmed || installing || checking} onClick={() => void install()}>{installing ? "Updating…" : "Update firmware"}</button>
    </>}
    {message && <p role="status">{message}</p>}{error && <ErrorNote>{error}</ErrorNote>}
    <div className="link-actions">
      {!installed && <button disabled={checking || installing} onClick={() => void check()}>Check again</button>}
      <button disabled={installing || checking} onClick={onClose}>{installed ? "Done" : "Close"}</button>
    </div>
    <p className="dim">No Ember account or cloud service is needed. Signed releases are downloaded from Ember’s GitHub repository.</p>
  </div></div>;
}
