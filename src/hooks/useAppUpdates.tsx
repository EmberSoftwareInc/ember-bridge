import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
export type AppUpdate = { version: string; notes: string | null };
const Updates = createContext<{
  update: AppUpdate | null; busy: boolean; checked: boolean; error: string | null;
  check: () => Promise<void>; install: () => Promise<void>;
} | null>(null);
export const APP_UPDATE_INTERVAL = 6 * 60 * 60 * 1000;
export function AppUpdatesProvider({ children }: { children: ReactNode }) {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  const check = useCallback(async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const result = await invoke<AppUpdate | null>("check_update");
      if (alive.current) { setUpdate(result); setChecked(true); }
    } catch (e) { if (alive.current) { setError(String(e)); setChecked(false); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }, []);
  useEffect(() => {
    alive.current = true;
    void check();
    const timer = setInterval(() => void check(), APP_UPDATE_INTERVAL);
    return () => { alive.current = false; clearInterval(timer); };
  }, [check]);
  async function install() {
    if (!update || pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try { await invoke("install_update", { version: update.version }); }
    catch (e) { if (alive.current) setError(String(e)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <Updates.Provider value={{ update, busy, checked, error, check, install }}>{children}</Updates.Provider>;
}
export function useAppUpdates() {
  const value = useContext(Updates);
  if (!value) throw new Error("AppUpdatesProvider is missing");
  return value;
}
