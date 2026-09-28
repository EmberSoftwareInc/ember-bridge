// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { usePolling } from "./usePolling";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
test("slow requests never overlap, even after an explicit refresh", async () => {
  vi.useFakeTimers();
  const pending = deferred<string>();
  const producer = vi.fn(() => pending.promise);
  const { result } = renderHook(() => usePolling(producer, 100));
  await act(async () => {
    vi.advanceTimersByTime(1000);
    void result.current.refresh();
  });
  expect(producer).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve("done");
  });
  expect(result.current.data).toBe("done");
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
  expect(producer).toHaveBeenCalledTimes(2);
});
test("changing machines clears old data and ignores a late response", async () => {
  const old = deferred<string>();
  const fresh = deferred<string>();
  const { result, rerender } = renderHook(
    ({ ip }) =>
      usePolling(() => (ip === "old" ? old.promise : fresh.promise), 1000, ip),
    { initialProps: { ip: "old" } },
  );
  rerender({ ip: "new" });
  expect(result.current.data).toBeNull();
  await act(async () => {
    fresh.resolve("new machine");
  });
  await act(async () => {
    old.resolve("old machine");
  });
  expect(result.current.data).toBe("new machine");
});
test("unmount ignores errors and stops scheduling", async () => {
  vi.useFakeTimers();
  const pending = deferred<string>();
  const producer = vi.fn(() => pending.promise);
  const { unmount } = renderHook(() => usePolling(producer, 100));
  unmount();
  await act(async () => {
    pending.resolve("late");
    vi.advanceTimersByTime(1000);
  });
  expect(producer).toHaveBeenCalledTimes(1);
});
