// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
const fake = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({invoke:fake.invoke}));
import { APP_UPDATE_INTERVAL, AppUpdatesProvider, useAppUpdates } from "./useAppUpdates";
function View(){const {update,check,install,error}=useAppUpdates();return <><span>{update?.version}</span><span>{error}</span><button onClick={()=>void check()}>Check</button><button onClick={()=>void install()}>Install</button></>;}
afterEach(()=>{cleanup();vi.useRealTimers();vi.resetAllMocks();});
test("checks at startup and every six hours, but installs only on request",async()=>{
  vi.useFakeTimers();fake.invoke.mockResolvedValue({version:"0.6.0",notes:"Changes"});
  await act(async()=>{render(<AppUpdatesProvider><View /></AppUpdatesProvider>);});
  expect(fake.invoke.mock.calls).toEqual([["check_update"]]);
  await act(async()=>{await vi.advanceTimersByTimeAsync(APP_UPDATE_INTERVAL);});
  expect(fake.invoke.mock.calls).toEqual([["check_update"],["check_update"]]);
  await act(async()=>fireEvent.click(screen.getByText("Install")));
  expect(fake.invoke).toHaveBeenLastCalledWith("install_update",{version:"0.6.0"});
});
test("offline startup remains retryable and does not install",async()=>{
  fake.invoke.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(null);
  render(<AppUpdatesProvider><View /></AppUpdatesProvider>);
  await screen.findByText("Error: Offline");
  await act(async()=>fireEvent.click(screen.getByText("Check")));
  expect(screen.queryByText("Error: Offline")).toBeNull();
  expect(fake.invoke.mock.calls.every(([cmd])=>cmd === "check_update")).toBe(true);
});
