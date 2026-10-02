// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const fake = vi.hoisted(() => ({ filesystem: vi.fn(), machineStatus: vi.fn(), selectedIp: "192.168.1.4", manufacturer: "emberconnect" }));
vi.mock("../hooks/useBridge", () => {
  const client = { filesystem: fake.filesystem,
    machines: async () => ({saved:[{ip:"192.168.1.4",nickname:"Studio",manufacturer:"emberconnect"}],discovered:[]}),
    machineStatus: fake.machineStatus,
  };
  return {useBridge: () => ({client, selectedIp:fake.selectedIp, setSelectedIp:vi.fn()})};
});
import { FilesPage } from "./FilesPage";
const folder = {path:"",revision:"1234567812345678",entries:[{name:"rose.pes",kind:"file",size:25},{name:"Flowers",kind:"folder",size:0}],total:2,hidden:0,nextOffset:null};
beforeEach(() => { fake.selectedIp="192.168.1.4"; fake.manufacturer="emberconnect"; fake.filesystem.mockResolvedValue(folder); fake.machineStatus.mockImplementation(async () => ({info:{identity:{manufacturer:fake.manufacturer,serial:fake.selectedIp,ip:fake.selectedIp}},storage:{}})); });
afterEach(() => {cleanup();vi.clearAllMocks();});
async function ready() {
  render(<FilesPage onSend={vi.fn()} />);
  const check=await screen.findByLabelText("The machine is idle, or I have ejected the drive on my computer");
  expect(fake.filesystem).not.toHaveBeenCalled();
  fireEvent.click(check); fireEvent.click(screen.getByText("Read folder"));
  await screen.findByText("rose.pes");
}
test("browsing needs explicit idle consent and delete needs a second confirmation",async () => {
  await ready();
  fireEvent.click(screen.getByLabelText("Delete rose.pes"));
  expect((screen.getByText("Delete permanently") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Delete rose.pes from Link"));
  await act(async () => { fireEvent.click(screen.getByText("Delete permanently")); });
  expect(fake.filesystem).toHaveBeenLastCalledWith("192.168.1.4","192.168.1.4",{op:"delete",path:"rose.pes",revision:folder.revision});
});
test("rename and move preserve the reviewed source revision",async () => {
  await ready(); fireEvent.click(screen.getByLabelText("Rename rose.pes"));
  fireEvent.change(screen.getByLabelText("Name"),{target:{value:"sun.pes"}});
  await act(async () => {fireEvent.click(screen.getByText("Save change"));});
  expect(fake.filesystem).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),{op:"move",path:"rose.pes",destination:"sun.pes",revision:folder.revision});
  fireEvent.click(screen.getByLabelText("Move rose.pes"));
  fireEvent.change(screen.getByLabelText("Destination folder"),{target:{value:"Flowers"}});
  await act(async () => {fireEvent.click(screen.getByText("Save change"));});
  expect(fake.filesystem).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),{op:"move",path:"rose.pes",destination:"Flowers/rose.pes",revision:folder.revision});
});
test("uncertain mutations are never replayed and invalidate actionable rows",async () => {
  await ready(); fake.filesystem.mockRejectedValueOnce(new Error("Connection interrupted"));
  fireEvent.click(screen.getByText("New folder")); fireEvent.change(screen.getByLabelText("Name"),{target:{value:"Projects"}});
  await act(async () => {fireEvent.click(screen.getByText("Save change"));});
  expect(fake.filesystem).toHaveBeenCalledTimes(2);
  expect(screen.queryByLabelText("Delete rose.pes")).toBeNull();
  expect(screen.getByText(/No automatic retry was made/)).toBeTruthy();
});
test("pagination includes revision and navigation uses relative folder paths",async () => {
  fake.filesystem.mockResolvedValueOnce({...folder,nextOffset:32,total:35});
  await ready(); fake.filesystem.mockResolvedValueOnce({...folder,entries:[{name:"last.pes",kind:"file",size:1}]});
  await act(async () => {fireEvent.click(screen.getByText("Load more"));});
  expect(fake.filesystem).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),{op:"list",path:"",offset:32,revision:folder.revision});
  expect(screen.getByText("rose.pes")).toBeTruthy(); expect(screen.getByText("last.pes")).toBeTruthy();
  await act(async () => {fireEvent.click(screen.getByText("▸ Flowers"));});
  expect(fake.filesystem).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),{op:"list",path:"Flowers"});
});
test("a changed selection cannot receive a late folder result or idle consent",async () => {
  let resolve!: (value: typeof folder) => void;
  fake.filesystem.mockReturnValueOnce(new Promise(r=>{resolve=r;}));
  const view=render(<FilesPage onSend={vi.fn()} />);
  fireEvent.click(await screen.findByLabelText("The machine is idle, or I have ejected the drive on my computer"));
  fireEvent.click(screen.getByText("Read folder"));
  fake.selectedIp="192.168.1.5"; view.rerender(<FilesPage onSend={vi.fn()} />);
  await waitFor(()=>expect(screen.getByLabelText("The machine is idle, or I have ejected the drive on my computer")).toBeTruthy());
  await act(async () => {resolve(folder);});
  expect(screen.queryByText("rose.pes")).toBeNull();
  expect((screen.getByText("Read folder") as HTMLButtonElement).disabled).toBe(true);
});
test("direct Brother machines do not expose card actions",async () => {
  fake.manufacturer="Brother"; render(<FilesPage onSend={vi.fn()} />);
  expect(await screen.findByText(/Direct Brother connections/)).toBeTruthy();
  expect(screen.queryByText("Read folder")).toBeNull(); expect(fake.filesystem).not.toHaveBeenCalled();
});

test("file operations do not trigger background device status polling", async () => {
  await ready();
  vi.useFakeTimers();
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fake.machineStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByText("rose.pes")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Rename rose.pes"));
    expect(fake.machineStatus).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
