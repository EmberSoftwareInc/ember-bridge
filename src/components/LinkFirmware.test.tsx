// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const fake = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: fake.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: fake.listen }));
import { LinkFirmwareButton, LinkFirmwareProvider } from "./LinkFirmware";
const target = { transport: "wifi" as const, ip: "192.168.1.3", serial: "link-one" };
const offer = { channel: "stable", installAction: "update", currentVersion: "0.3.4", supported: true, release: { releaseId: "r035", targetVersion: "0.3.5", sha256: "a".repeat(64), notes: "Changes" }, message: null };
beforeEach(() => { vi.resetAllMocks(); fake.listen.mockResolvedValue(vi.fn()); fake.invoke.mockImplementation(async cmd => cmd === "link_check_update" ? offer : {bootConfirmed:true}); });
afterEach(cleanup);
async function open() {
  render(<LinkFirmwareProvider><LinkFirmwareButton target={target} name="Sewing room" /></LinkFirmwareProvider>);
  fireEvent.click(await screen.findByRole("button", {name:"Firmware update available"}));
  await screen.findByText("Changes");
}
test("discovery never installs; consent binds installation to the selected device and release", async () => {
  let finish!: (value: unknown) => void;
  fake.invoke.mockImplementation(async (cmd) => cmd === "link_check_update" ? offer : new Promise(r => { finish=r; }));
  await open();
  const install = screen.getByRole("button", { name: "Update firmware" }) as HTMLButtonElement;
  expect(install.disabled).toBe(true);
  expect(fake.invoke.mock.calls.every(([cmd]) => cmd === "link_check_update")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(install);
  await waitFor(() => expect(fake.invoke).toHaveBeenCalledWith("link_install_update", {target, releaseId:"r035", sha256:"a".repeat(64), confirmed:true, channel:"stable", currentVersion:"0.3.4", replacementConfirmed:false}));
  expect((screen.getByRole("button",{name:"Close"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByRole("dialog"),{key:"Escape"}); expect(screen.getByRole("dialog")).toBeTruthy();
  await act(async()=>finish({bootConfirmed:true}));
  expect(screen.getByText("Ember Link is running 0.3.5.")).toBeTruthy();
});
test("uncertain installation requires a fresh check instead of replaying the update", async () => {
  fake.invoke.mockImplementation(async cmd => { if(cmd === "link_check_update") return offer; throw new Error("Installation could not be confirmed"); });
  await open(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", {name:"Update firmware"}));
  await screen.findByText(/Installation could not be confirmed/);
  expect(screen.queryByRole("button", {name:"Update firmware"})).toBeNull();
  expect(fake.invoke.mock.calls.filter(([cmd])=>cmd === "link_install_update")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", {name:"Check again"}));
  await screen.findByText("Changes");
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
});
test("firmware without capabilities gets recovery guidance and no install action", async () => {
  fake.invoke.mockResolvedValue({...offer,supported:false,release:null,message:"Use Advanced USB recovery"});
  render(<LinkFirmwareProvider><LinkFirmwareButton target={target} name="Old Link" /></LinkFirmwareProvider>);
  fireEvent.click(screen.getByRole("button",{name:"Firmware"}));
  await screen.findByText("Use Advanced USB recovery");
  expect(screen.queryByRole("button",{name:"Update firmware"})).toBeNull();
});

test("development requires explicit opt-in and saving the channel never installs", async () => {
  let channel = "stable";
  fake.invoke.mockImplementation(async (cmd, args) => {
    if (cmd === "link_set_update_channel") { channel = args.channel; return channel; }
    return {...offer, channel, release:channel === "dev" ? null : offer.release};
  });
  await open();
  fireEvent.change(screen.getByLabelText("Firmware channel"), {target:{value:"dev"}});
  expect((screen.getByRole("button", {name:"Save channel"}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", {name:"Update firmware"})).toBeNull();
  fireEvent.click(screen.getByLabelText(/I want experimental/));
  fireEvent.click(screen.getByRole("button", {name:"Save channel"}));
  await screen.findByText("No different compatible firmware is recommended in this channel.");
  expect(fake.invoke).toHaveBeenCalledWith("link_set_update_channel", {target, channel:"dev", developmentConfirmed:true});
  expect(fake.invoke.mock.calls.some(([cmd])=>cmd === "link_install_update")).toBe(false);
});
test("returning to stable needs replacement approval and binds both versions and channel", async () => {
  fake.invoke.mockImplementation(async cmd => cmd === "link_check_update" ? {...offer, currentVersion:"0.3.7-dev.1", installAction:"return_to_stable"} : {bootConfirmed:true});
  await open();
  const install = screen.getByRole("button", {name:"Return to stable"}) as HTMLButtonElement;
  fireEvent.click(screen.getByLabelText(/My embroidery machine is idle/));
  expect(install.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I approve replacing/));
  expect(install.disabled).toBe(false);
  fireEvent.click(install);
  await screen.findByText("Ember Link is running 0.3.5.");
  expect(fake.invoke).toHaveBeenCalledWith("link_install_update", {target, releaseId:"r035", sha256:"a".repeat(64), confirmed:true, channel:"stable", currentVersion:"0.3.7-dev.1", replacementConfirmed:true});
});
