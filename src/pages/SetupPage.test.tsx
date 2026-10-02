// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const fake = vi.hoisted(() => ({
  devices: [{ port: "port-a", serial: "a" }], info: vi.fn(), scan: vi.fn(),
  display: vi.fn(), provision: vi.fn(), update: vi.fn(), listen: vi.fn(), save: vi.fn(),
}));
vi.mock("../hooks/usePolling", () => ({ usePolling: () => ({ data: fake.devices }) }));
vi.mock("../hooks/useBridge", () => ({ useBridge: () => ({ client: { saveMachine: fake.save } }) }));
vi.mock("../api/dongle", () => ({
  setDongleDisplay: fake.display, listDongles: vi.fn(), dongleInfo: fake.info, scanNetworks: fake.scan,
  provisionDongle: fake.provision, updateDongleFirmware: fake.update,
  onUpdateProgress: fake.listen,
  asDongleError: (e: Error) => ({ code: "error", message: e.message }),
}));
import { SetupPage } from "./SetupPage";
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const info = (serial = "a") => ({ serial, deviceName: serial, version: "0.3.2-dev",
  wifi: { connected: true, configuredSsid: "Home", ip: "192.168.1.3" },
  update: { slot: "ota_1", pendingVerify: false } });
beforeEach(() => {
  vi.resetAllMocks(); fake.devices = [{ port: "port-a", serial: "a" }];
  fake.info.mockImplementation(async (port: string) => info(port === "port-a" ? "a" : "b"));
  fake.scan.mockResolvedValue([]); fake.listen.mockResolvedValue(vi.fn());
});
afterEach(cleanup);
async function ready() { await waitFor(() => expect((screen.getByRole("button", { name: "Configure Wi-Fi" }) as HTMLButtonElement).disabled).toBe(false)); }
async function wifiReady() { await waitFor(() => expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(false)); }
async function openWifi() { fireEvent.click(screen.getByRole("button", { name: "Configure Wi-Fi" })); await wifiReady(); }
test("update disables setup until boot confirmation, including during USB disappearance", async () => {
  const pending = deferred<unknown>(); fake.update.mockReturnValue(pending.promise);
  const view = render(<SetupPage onReady={() => {}} />); await ready();
  fireEvent.change(screen.getByPlaceholderText("/path/to/ember-link.bin"), { target: { value: "/firmware.bin" } });
  fireEvent.click(screen.getByRole("button", { name: "Update firmware" }));
  await waitFor(() => expect(fake.update).toHaveBeenCalled());
  expect((screen.getByRole("button", { name: "Configure Wi-Fi" }) as HTMLButtonElement).disabled).toBe(true);
  fake.devices = []; view.rerender(<SetupPage onReady={() => {}} />);
  expect(screen.getByText("Updating…")).toBeTruthy();
  fake.devices = [{ port: "port-a", serial: "a" }]; view.rerender(<SetupPage onReady={() => {}} />);
  await act(async () => pending.resolve({ bootConfirmed: true, info: { ...info(), version: "0.3.3-dev" } }));
  expect(screen.getByText(/Dongle restarted successfully/)).toBeTruthy();
  await ready();
});
test("event subscription failure releases the update lock", async () => {
  fake.listen.mockRejectedValue(new Error("listener unavailable"));
  render(<SetupPage onReady={() => {}} />); await ready();
  fireEvent.change(screen.getByPlaceholderText("/path/to/ember-link.bin"), { target: { value: "/firmware.bin" } });
  fireEvent.click(screen.getByRole("button", { name: "Update firmware" }));
  await screen.findByText(/Update failed: listener unavailable/); await ready();
  expect(fake.update).not.toHaveBeenCalled();
});
test("swapping dongles discards old scan results and clears the password", async () => {
  const oldScan = deferred<unknown>(); fake.scan.mockReturnValueOnce(oldScan.promise).mockResolvedValue([]);
  const view = render(<SetupPage onReady={() => {}} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Configure Wi-Fi" }));
  await waitFor(() => expect(fake.scan).toHaveBeenCalledWith("port-a"));
  fake.devices = [{ port: "port-b", serial: "b" }]; view.rerender(<SetupPage onReady={() => {}} />); await ready();
  await openWifi();
  fireEvent.change(screen.getByPlaceholderText("WiFi password"), { target: { value: "private-password" } });
  await act(async () => oldScan.resolve([{ ssid: "STALE", rssi: -50, secure: false }]));
  expect(screen.queryByText("STALE")).toBeNull();
  fake.devices = []; view.rerender(<SetupPage onReady={() => {}} />);
  fake.devices = [{ port: "port-b", serial: "b" }]; view.rerender(<SetupPage onReady={() => {}} />); await ready();
  await openWifi();
  expect((screen.getByPlaceholderText("WiFi password") as HTMLInputElement).value).toBe("");
});
test("late provisioning result from a removed dongle cannot save a machine or show success", async () => {
  const pending = deferred<unknown>(); fake.provision.mockReturnValue(pending.promise);
  const view = render(<SetupPage onReady={() => {}} />); await ready();
  await openWifi();
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  fake.devices = [{ port: "port-b", serial: "b" }]; view.rerender(<SetupPage onReady={() => {}} />); await ready();
  await act(async () => pending.resolve({ ssid: "Home", ip: "192.168.1.3", paired: true }));
  expect(fake.save).not.toHaveBeenCalled(); expect(screen.queryByText("Wi-Fi connected")).toBeNull();
});
test("accepted image without a confirmed reboot is not reported as success", async () => {
  fake.update.mockResolvedValue({ bootConfirmed: false });
  render(<SetupPage onReady={() => {}} />); await ready();
  fireEvent.change(screen.getByPlaceholderText("/path/to/ember-link.bin"), { target: { value: "/firmware.bin" } });
  fireEvent.click(screen.getByRole("button", { name: "Update firmware" }));
  await screen.findByText(/could not confirm the dongle restarted successfully/);
  expect(screen.queryByText(/Dongle restarted successfully/)).toBeNull(); await ready();
});
test("idle status refresh reflects Wi-Fi joining without replacing edited fields", async () => {
  // Only advance the polling timer. Faking performance.now moves React's
  // scheduling clock backwards when real timers resume in later tests.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    fake.info.mockResolvedValue({ ...info(), provisioned: true, wifi: { ...info().wifi, connected: false } });
    await act(async () => { render(<SetupPage onReady={() => {}} />); });
    expect(screen.getByText("Disconnected")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Configure Wi-Fi" })); });
    const name = screen.getByPlaceholderText("Machine name, e.g. Sewing room Brother") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "My new name" } });
    fake.info.mockResolvedValue(info());
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(name.value).toBe("My new name");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("status").textContent).toContain("Connected");
  } finally { cleanup(); vi.useRealTimers(); }
});

test("screen settings save independently and block setup while pending", async () => {
  fake.info.mockResolvedValue({ ...info(), display: { enabled: true, rotation: 0 } });
  const pending = deferred<{ enabled: boolean; rotation: number }>(); fake.display.mockReturnValue(pending.promise);
  render(<SetupPage onReady={() => {}} />); await ready();
  fireEvent.change(screen.getByLabelText("Screen orientation"), { target: { value: "180" } });
  fireEvent.click(screen.getByLabelText("Screen on"));
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(fake.display).toHaveBeenCalledWith("port-a", "a", { enabled: false, rotation: 180 }));
  expect((screen.getByRole("button", { name: "Configure Wi-Fi" }) as HTMLButtonElement).disabled).toBe(true);
  expect(fake.provision).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ enabled: false, rotation: 180 }));
  expect(screen.getByText("Display settings saved to Link.")).toBeTruthy();
  expect((screen.getByLabelText("Screen on") as HTMLInputElement).checked).toBe(false);
});
test("old firmware shows an update hint instead of unsupported controls", async () => {
  render(<SetupPage onReady={() => {}} />); await ready();
  expect(screen.getByText("Update Link firmware to change its screen settings.")).toBeTruthy();
  expect(screen.queryByLabelText("Screen on")).toBeNull();
});
test("failed screen save remains retryable and never shows success", async () => {
  fake.info.mockResolvedValue({ ...info(), display: { enabled: true, rotation: 0 } });
  fake.display.mockRejectedValue(new Error("Could not save"));
  render(<SetupPage onReady={() => {}} />); await ready();
  fireEvent.click(screen.getByLabelText("Screen on"));
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByText("Could not save");
  expect(screen.queryByText("Display settings saved to Link.")).toBeNull();
  expect((screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled).toBe(false);
});

test("status light saves independently of a disabled screen", async () => {
  fake.info.mockResolvedValue({ ...info(), display: { enabled: false, rotation: 180, ledEnabled: true } });
  fake.display.mockResolvedValue({ enabled: false, rotation: 180, ledEnabled: false });
  render(<SetupPage onReady={() => {}} />); await ready();
  fireEvent.click(screen.getByLabelText("Status light on"));
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByText("Display settings saved to Link.");
  expect(fake.display).toHaveBeenCalledWith("port-a", "a", { enabled: false, rotation: 180, ledEnabled: false });
  expect((screen.getByLabelText("Screen on") as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText("Status light on") as HTMLInputElement).checked).toBe(false);
});
test("screen-only firmware retains screen controls and hides unsupported LED control", async () => {
  fake.info.mockResolvedValue({ ...info(), display: { enabled: true, rotation: 0 } });
  render(<SetupPage onReady={() => {}} />); await ready();
  expect(screen.getByLabelText("Screen on")).toBeTruthy();
  expect(screen.queryByLabelText("Status light on")).toBeNull();
  expect(screen.getByText("Update Link firmware to control the status light.")).toBeTruthy();
});


test("Wi-Fi has its own page and leaving it preserves settings drafts but clears passwords", async () => {
  fake.info.mockResolvedValue({ ...info(), display: { enabled: true, rotation: 0, ledEnabled: true } });
  render(<SetupPage onReady={() => {}} />); await ready();
  expect(fake.scan).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Screen orientation"), { target: { value: "180" } });
  fireEvent.click(screen.getByRole("switch", { name: "Screen on" }));
  await openWifi();
  expect(fake.scan).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("switch", { name: "Screen on" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Wi-Fi password"), { target: { value: "unsaved-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect((screen.getByRole("switch", { name: "Screen on" }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText("Screen orientation") as HTMLSelectElement).value).toBe("180");
  expect((screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled).toBe(false);
  await openWifi();
  expect((screen.getByLabelText("Wi-Fi password") as HTMLInputElement).value).toBe("");
  expect(fake.display).not.toHaveBeenCalled(); expect(fake.provision).not.toHaveBeenCalled();
});

test("new Link setup returns to a connected Wi-Fi summary after provisioning", async () => {
  fake.info.mockResolvedValue({ ...info(), wifi: { connected: false } });
  fake.scan.mockResolvedValue([{ ssid: "New network", rssi: -40, secure: true }]);
  fake.provision.mockResolvedValue({ ssid: "New network", ip: "192.168.1.8", paired: true });
  render(<SetupPage onReady={() => {}} />);
  const setup = await screen.findByRole("button", { name: "Set up Wi-Fi" });
  await waitFor(() => expect((setup as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByText("Not configured")).toBeTruthy();
  fireEvent.click(setup);
  fireEvent.click(await screen.findByRole("button", { name: /New network/ }));
  await wifiReady();
  fireEvent.change(screen.getByLabelText("Wi-Fi password"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  fireEvent.click(await screen.findByRole("button", { name: "Back to Ember Link" }));
  expect(screen.getByRole("status").textContent).toContain("ConnectedNew network · 192.168.1.8");
  expect(fake.save).toHaveBeenCalled();
});
