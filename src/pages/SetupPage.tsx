/**
 * USB settings for Ember Link, with Wi-Fi setup on a separate view.
 * Provisioning joins the network live and pairs this Bridge for local transfers.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LinkFirmwareButton } from "../components/LinkFirmware";
import {
  asDongleError,
  dongleInfo,
  setDongleDisplay,
  type DisplaySettings,
  listDongles,
  onUpdateProgress,
  provisionDongle,
  scanNetworks,
  updateDongleFirmware,
  type DongleNetwork,
  type DongleSummary,
  type DongleSetupInfo,
  type ProvisionOutcome,
  type UpdateProgress,
} from "../api/dongle";
import { useBridge } from "../hooks/useBridge";
import { usePolling } from "../hooks/usePolling";
import {
  EmptyState,
  ErrorNote,
  Pill,
  ProgressBar,
  Section,
} from "../components/ui";

function signalBars(rssi: number): string {
  return rssi > -55 ? "▮▮▮" : rssi > -70 ? "▮▮▯" : "▮▯▯";
}

export function SetupPage({ onReady }: { onReady: () => void }) {
  const dongles = usePolling(listDongles, 2000);
  // Keep the update session visible during its expected USB restart.
  const [updatingDongle, setUpdatingDongle] = useState<DongleSummary | null>(null);
  const dongle = updatingDongle ?? dongles.data?.[0] ?? null;
  if (!dongle) return (
    <div className="page"><Section title="Ember Link">
      {dongles.error && <ErrorNote>{dongles.error}</ErrorNote>}
      <p className="dim">Configure Wi-Fi and pair Ember Link with this computer for local
        transfers. No Ember account or web app is required.</p>
      <EmptyState>Plug Ember Link into this computer normally with its FAT32 card installed.
        Wait for startup, then press and release BOOT twice within one second to enable
        USB setup. After its brief restart, Bridge detects it automatically.</EmptyState>
    </Section></div>
  );
  return <SetupSession key={`${dongle.serial}:${dongle.port}`} dongle={dongle}
    onReady={onReady} onUpdateActive={(active) => setUpdatingDongle(active ? dongle : null)} />;
}

function SetupSession({ dongle, onReady, onUpdateActive }: {
  dongle: DongleSummary; onReady: () => void; onUpdateActive: (active: boolean) => void;
}) {
  const { client } = useBridge();
  const port = dongle.port;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [view, setView] = useState<"settings" | "wifi">("settings");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [savingDisplay, setSavingDisplay] = useState(false);

  const [info, setInfo] = useState<DongleSetupInfo | null>(null);
  const [networks, setNetworks] = useState<DongleNetwork[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [machineName, setMachineName] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  const [provisioning, setProvisioning] = useState(false);
  const [done, setDone] = useState<ProvisionOutcome | null>(null);
  const [savedToMachines, setSavedToMachines] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One serial conversation at a time: the port is exclusive, so info
  // fetches and scans must never race a provision or update.
  const busy = loading || provisioning || scanning || updating || savingDisplay;

  const rescan = async (targetPort: string) => {
    setScanning(true);
    setError(null);
    try {
      const found = await scanNetworks(targetPort);
      if (mounted.current) setNetworks(found);
    } catch (e) {
      if (mounted.current) setError(asDongleError(e).message);
    } finally {
      if (mounted.current) setScanning(false);
    }
  };

  // Read device state on arrival. Network scans only run on the Wi-Fi page.
  useEffect(() => {
    if (!port) {
      setInfo(null);
      setNetworks(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const i = await dongleInfo(port);
        if (cancelled) return;
        setInfo(i);
        if (i.deviceName) setMachineName(i.deviceName);
        if (i.wifi.configuredSsid) setSsid(i.wifi.configuredSsid);
      } catch (e) {
        if (!cancelled) setError(asDongleError(e).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port]);

  // Wi-Fi can finish joining after the initial USB info request. Refresh status
  // only while idle, without overwriting anything the user has typed.
  useEffect(() => {
    if (busy) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const current = await dongleInfo(port);
        if (!cancelled) setInfo(current);
      } catch {
        // Discovery handles removal; a transient status read must not erase
        // the form or replace a provisioning/update error.
      } finally {
        if (!cancelled) timer = setTimeout(refresh, 3000);
      }
    };
    timer = setTimeout(refresh, 3000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [busy, port]);

  const provision = async () => {
    if (busy || !ssid.trim()) return;
    setProvisioning(true);
    setError(null);
    try {
      const outcome = await provisionDongle(
        port,
        ssid.trim(),
        password,
        machineName.trim(),
      );
      if (!mounted.current) return;
      // Finish the job: put the dongle on the Machines page under the name
      // just chosen, replacing any stale entry at that address. Best-effort —
      // the dongle is provisioned either way, and discovery finds it anyway.
      let saved = false;
      if (client && outcome.ip) {
        try {
          await client.saveMachine({
            ip: outcome.ip,
            nickname: machineName.trim() || undefined,
            manufacturer: "emberconnect",
          });
          saved = true;
        } catch {
          // Non-fatal; the done screen just omits the "saved" line.
        }
      }
      if (!mounted.current) return;
      setSavedToMachines(saved);
      setPassword("");
      setInfo(current => current ? { ...current, provisioned: true,
        wifi: { ...current.wifi, connected: true, setupMode: false,
          configuredSsid: outcome.ssid, ip: outcome.ip, lastError: "" } } : current);
      setDone(outcome);
    } catch (e) {
      if (!mounted.current) return;
      const err = asDongleError(e);
      if (err.code === "wrong_password") {
        setError(`"${ssid.trim()}" rejected the password — try again.`);
        passwordRef.current?.focus();
      } else {
        setError(err.message);
      }
    } finally {
      if (mounted.current) setProvisioning(false);
    }
  };

  const displayPanel = info && <DisplayOptions settings={info.display} busy={busy}
    onSave={async (settings) => {
      setSavingDisplay(true);
      try {
        const saved = await setDongleDisplay(port, info.serial, settings);
        if (mounted.current) setInfo(current => current ? { ...current, display: saved } : current);
        return saved;
      } finally { if (mounted.current) setSavingDisplay(false); }
    }} />;

  const openWifi = () => {
    if (busy) return;
    setView("wifi"); setDone(null); setPassword(""); setError(null);
    void rescan(port);
  };
  const backToSettings = () => {
    if (busy) return;
    setView("settings"); setPassword(""); setError(null);
  };
  const connected = info?.wifi.connected;
  const wifiLabel = loading ? "Checking connection…" : connected ? "Connected" :
    info?.provisioned || info?.wifi.configuredSsid ? "Disconnected" : "Not configured";

  return (
    <div className="page link-page">
      {/* Keep settings drafts mounted while visiting Wi-Fi. */}
      <div hidden={view !== "settings"}>
        <header className="link-page-header">
          <div><h1>Ember Link</h1><p>{info?.deviceName || "Your USB dongle"}</p></div>
          <Pill tone="muted">Connected over USB</Pill>
        </header>
        {error && view === "settings" && <ErrorNote>{error}</ErrorNote>}
        <Section title="Wi-Fi">
          <div className="link-wifi-summary">
            <div className="link-wifi-status" role="status">
              <span className={`dot ${connected ? "dot-ok" : "dot-warn"}`} aria-hidden="true" />
              <div><strong>{wifiLabel}</strong><p className="dim">
                {info?.wifi.configuredSsid || "Connect Link to your local network."}
                {connected && info?.wifi.ip && <span> · {info.wifi.ip}</span>}
              </p></div>
            </div>
            <button disabled={busy || !info} onClick={openWifi}>
              {info?.provisioned || info?.wifi.configuredSsid ? "Configure Wi-Fi" : "Set up Wi-Fi"}
              <span aria-hidden="true"> →</span>
            </button>
          </div>
        </Section>
        {loading && <EmptyState>Reading your Link settings…</EmptyState>}
        {displayPanel}
        {info && <Section title="Firmware">
          <p>Installed version {info.version}. Check for an approved release and update over USB.</p>
          <LinkFirmwareButton target={{ transport: "usb", port, serial: info.serial }} name={info.deviceName || "Ember Link"} disabled={busy} label="Check for updates" />
        </Section>}
        {info && <details><summary>Advanced USB recovery</summary><FirmwareUpdate port={port} version={info.version} busy={busy}
          onActive={(active) => { setUpdating(active); onUpdateActive(active); }} onInfo={setInfo} /></details>}
        <p className="link-device-meta">Serial {info?.serial ?? dongle.serial ?? "—"} · Firmware {info?.version ?? "—"}</p>
      </div>

      {view === "wifi" && <>
        <button className="link-back" disabled={busy} onClick={backToSettings}>← Ember Link</button>
        <header className="link-page-header"><div><h1>Wi-Fi</h1>
          <p>Configure the connection for {info?.deviceName || "your Ember Link"}.</p></div></header>
        {error && <ErrorNote>{error}</ErrorNote>}
        {done ? <Section title="Wi-Fi connected">
          <p><Pill tone="ok">Connected</Pill> Link joined <strong>{done.ssid}</strong>
            {done.paired && " and is paired with this Bridge"}.
            {savedToMachines && " It is saved on your Machines page."}</p>
          <p className="dim">You can move Link to your embroidery machine. It will reconnect automatically.</p>
          <div className="link-actions"><button className="primary" onClick={backToSettings}>Back to Ember Link</button>
            <button onClick={onReady}>Go to machines</button></div>
        </Section> : <>
          <Section title="Available networks" actions={<button disabled={busy} onClick={() => void rescan(port)}>{scanning ? "Scanning…" : "Rescan"}</button>}>
            <p className="dim">Choose a 2.4 GHz network, or enter its name below.</p>
            {networks === null ? <EmptyState>Looking for networks…</EmptyState> : networks.length === 0 ?
              <EmptyState>No networks found. Try again or enter the network name below.</EmptyState> :
              <ul className="machine-list link-network-list">{networks.map(n => <li key={n.ssid} className={`machine-row ${ssid === n.ssid ? "selected" : ""}`}>
                <button className="machine-main" disabled={busy} onClick={() => { setSsid(n.ssid); passwordRef.current?.focus(); }}>
                  <span className="machine-name">{n.secure ? "🔒 " : ""}{n.ssid}</span><span className="dim">{signalBars(n.rssi)}</span>
                </button>
              </li>)}</ul>}
          </Section>
          <Section title="Network details">
            <form className="link-wifi-form" onSubmit={e => { e.preventDefault(); void provision(); }}>
              <label>Wi-Fi network<input placeholder="Network name (or pick above)" value={ssid} disabled={busy} onChange={e => setSsid(e.target.value)} /></label>
              <label>Wi-Fi password<input ref={passwordRef} type="password" autoComplete="off" placeholder="WiFi password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
              <label>Machine name<input placeholder="Machine name, e.g. Sewing room Brother" value={machineName} disabled={busy} onChange={e => setMachineName(e.target.value)} /></label>
              <div className="link-actions"><button type="submit" className="primary" disabled={busy || !ssid.trim()}>{provisioning ? "Connecting…" : "Connect"}</button>
                <button type="button" disabled={busy} onClick={backToSettings}>Cancel</button></div>
            </form>
            {provisioning && <p className="dim" role="status">Connecting to “{ssid.trim()}”… Keep Link plugged in. This can take up to 30 seconds.</p>}
          </Section>
        </>}
      </>}
    </div>
  );
}

/**
 * Manual firmware push from a signed .bin. A stopgap for support/dev use
 * until Bridge checks a release manifest and offers updates on its own
 * (roadmap) — hence a path field rather than a native file picker.
 */
function FirmwareUpdate({
  port,
  version,
  busy,
  onActive,
  onInfo,
}: {
  port: string;
  version: string;
  busy: boolean;
  onActive: (active: boolean) => void;
  onInfo: (info: DongleSetupInfo) => void;
}) {
  const [imagePath, setImagePath] = useState("");
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const update = async () => {
    if (busy || updating) return;
    setUpdating(true);
    onActive(true);
    setResult(null);
    setProgress(null);
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await onUpdateProgress(setProgress);
      const result = await updateDongleFirmware(port, imagePath.trim());
      if (result.info) onInfo(result.info);
      setResult(result.bootConfirmed && result.info
        ? `Dongle restarted successfully. Running firmware ${result.info.version}.`
        : "Image verified, but Bridge could not confirm the dongle restarted successfully. Reconnect it, enable USB setup, and check its firmware version before trying another update.");
      setImagePath("");
    } catch (e) {
      setResult(`Update failed: ${asDongleError(e).message}`);
    } finally {
      unlisten?.();
      setUpdating(false);
      onActive(false);
      setProgress(null);
    }
  };

  return (
    <Section title="Firmware update (advanced)">
      <p className="dim">
        Running version {version}. Point at a signed Ember Link image
        (ember-link.bin) to update over USB — the dongle rejects anything not
        signed with the Ember Link key.
      </p>
      <p
        className={
          updating ? "update-safety update-safety-active" : "update-safety"
        }
      >
        <strong>
          {updating
            ? "Update in progress — do not unplug the dongle or close Ember Bridge."
            : "Keep the dongle plugged in for the entire update."}
        </strong>{" "}
        {updating
          ? "Wait until Ember Bridge confirms the dongle has restarted."
          : "If power is interrupted, the dongle should retain its previous bootable firmware, but the update will need to be tried again."}
      </p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void update();
        }}
      >
        <input
          placeholder="/path/to/ember-link.bin"
          value={imagePath}
          disabled={busy || updating}
          onChange={(e) => setImagePath(e.target.value)}
        />
        <button type="submit" disabled={busy || updating || !imagePath.trim()}>
          {updating ? "Updating…" : "Update firmware"}
        </button>
      </form>
      {progress && (
        <ProgressBar value={progress.written} max={progress.total} />
      )}
      {result && <p>{result}</p>}
    </Section>
  );
}

export function DisplayOptions({ settings, busy, onSave }: {
  settings?: DisplaySettings; busy: boolean;
  onSave: (settings: DisplaySettings) => Promise<DisplaySettings>;
}) {
  const [enabled, setEnabled] = useState(settings?.enabled ?? true);
  const [rotation, setRotation] = useState<0 | 180>(settings?.rotation ?? 0);
  const [ledEnabled, setLedEnabled] = useState(settings?.ledEnabled);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  // Sync device settings during commit, before the controls can receive input.
  // A passive effect can run after the first edit and overwrite that edit.
  useLayoutEffect(() => {
    if (settings) { setEnabled(settings.enabled); setRotation(settings.rotation); setLedEnabled(settings.ledEnabled); }
  }, [settings?.enabled, settings?.rotation, settings?.ledEnabled]);
  async function save() {
    if (busy) return;
    setMessage(""); setError("");
    try {
      await onSave({ enabled, rotation, ...(ledEnabled === undefined ? {} : { ledEnabled }) });
      if (active.current) setMessage("Display settings saved to Link.");
    } catch (e) { if (active.current) setError(asDongleError(e).message); }
  }
  return <Section title="Settings">
    {!settings ? <p className="dim">Update Link firmware to change its screen settings.</p> : <>
      <fieldset disabled={busy} className="link-preferences" aria-label="Link settings">
        <label className="link-setting-row">
          <span className="link-setting-copy"><strong>Screen</strong><span>Show connection status and transfer progress.</span></span>
          <input className="link-switch" type="checkbox" role="switch" aria-label="Screen on" checked={enabled} onChange={e => { setEnabled(e.target.checked); setMessage(""); }} />
        </label>
        <label className="link-setting-row">
          <span className="link-setting-copy"><strong>Screen orientation</strong><span>Match the direction of your machine’s USB port.</span></span>
          <select className="link-orientation" aria-label="Screen orientation" value={rotation} disabled={!enabled || busy} onChange={e => { setRotation(Number(e.target.value) as 0 | 180); setMessage(""); }}>
            <option value={0}>Normal</option><option value={180}>Upside down (180°)</option>
          </select>
        </label>
        <label className="link-setting-row">
          <span className="link-setting-copy"><strong>Status light</strong><span>{settings.ledEnabled === undefined ? "Update Link firmware to control the status light." : "Show device status with the colored LED."}</span></span>
          {settings.ledEnabled !== undefined && <input className="link-switch" type="checkbox" role="switch" aria-label="Status light on" checked={ledEnabled ?? true} onChange={e => { setLedEnabled(e.target.checked); setMessage(""); }} />}
        </label>
        <div className="link-settings-footer">
          <span className="dim">Saved on Link, even when unplugged.</span>
          <button className="primary" type="button" disabled={busy || (enabled === settings.enabled && rotation === settings.rotation && ledEnabled === settings.ledEnabled)} onClick={() => void save()}>Save settings</button>
        </div>
      </fieldset>
      {message && <p role="status" className="link-saved">{message}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </>}
  </Section>;
}
