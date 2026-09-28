import { useCallback, useEffect, useRef, useState } from "react";
export interface Polled<T> {
  data: T | null;
  error: string | null;
  refresh: () => Promise<void>;
}

/** One request at a time. Changing a target invalidates late results immediately. */
export function usePolling<T>(
  producer: (() => Promise<T>) | null,
  intervalMs: number,
  key: string | null = null,
): Polled<T> {
  const [result, setResult] = useState<{
    key: string | null;
    data: T | null;
    error: string | null;
  }>({ key, data: null, error: null });
  const producerRef = useRef(producer);
  producerRef.current = producer;
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const active = producer !== null;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let inFlight: Promise<void> | null = null;
    let again = false;
    const tick = (): Promise<void> => {
      if (stopped || !active) return Promise.resolve();
      if (inFlight) {
        again = true;
        return inFlight;
      }
      clearTimeout(timer);
      const produce = producerRef.current;
      if (!produce) return Promise.resolve();
      inFlight = (async () => {
        try {
          const data = await produce();
          if (!stopped) setResult({ key, data, error: null });
        } catch (e) {
          if (!stopped)
            setResult({
              key,
              data: null,
              error: e instanceof Error ? e.message : String(e),
            });
        } finally {
          inFlight = null;
          if (!stopped) {
            timer = setTimeout(
              () => {
                void tick();
              },
              again ? 0 : intervalMs,
            );
            again = false;
          }
        }
      })();
      return inFlight;
    };
    refreshRef.current = tick;
    setResult({ key, data: null, error: null });
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, intervalMs, key]);
  const refresh = useCallback(() => refreshRef.current(), []);
  return {
    data: active && result.key === key ? result.data : null,
    error: active && result.key === key ? result.error : null,
    refresh,
  };
}
