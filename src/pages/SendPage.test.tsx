// @vitest-environment jsdom
import {
  act,
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
const fake = vi.hoisted(() => ({
  send: vi.fn(),
  deleteFile: vi.fn(),
  cancelJob: vi.fn(),
  resolveJob: vi.fn(),
}));
vi.mock("../hooks/useBridge", () => ({
  useBridge: () => ({
    client: {
      ...fake,
      machines: async () => ({
        saved: [{ ip: "192.168.1.4", nickname: "Sewing room" }],
        discovered: [],
      }),
      machineStatus: async () => ({
        info: {
          identity: {
            ip: "192.168.1.4",
            name: "Sewing room",
            manufacturer: "emberconnect",
            serial: "device-a",
          },
          capabilities: {
            formats: ["pes", "dst"],
            canDeleteFiles: true,
            overwritesByName: true,
          },
        },
        storage: {
          totalBytes: 1000,
          usedBytes: 200,
          freeBytes: 800,
          files: ["rose.pes", "leaf.dst"],
        },
      }),
      jobs: async () => [],
    },
    selectedIp: "192.168.1.4",
    setSelectedIp: () => {},
  }),
}));
import { SendPage } from "./SendPage";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
test("file deletion needs confirmation and binds the selected identity", async () => {
  render(<SendPage />);
  await screen.findByText("rose.pes");
  fireEvent.change(screen.getByPlaceholderText("Search files"), {
    target: { value: "rose" },
  });
  expect(screen.queryByText("leaf.dst")).toBeNull();
  fireEvent.click(screen.getByText("Delete"));
  expect(fake.deleteFile).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByText("Confirm"));
  });
  expect(fake.deleteFile).toHaveBeenCalledWith(
    "192.168.1.4",
    "rose.pes",
    "emberconnect",
    "device-a",
  );
});
test("picker uses capabilities and replacement is explicit", async () => {
  const { container } = render(<SendPage />);
  await screen.findByText("rose.pes");
  const input = container.querySelector('input[type="file"]')!;
  expect(input.getAttribute("accept")).toBe(".pes,.dst");
  const file = new File(["design"], "rose.pes");
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new ArrayBuffer(6),
  });
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(screen.getByText("Send to machine"));
  expect(fake.send).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByText("Confirm"));
  });
  expect(fake.send).toHaveBeenCalledWith(
    "192.168.1.4",
    "rose.pes",
    expect.any(ArrayBuffer),
    expect.objectContaining({ serial: "device-a" }),
    true,
  );
});
