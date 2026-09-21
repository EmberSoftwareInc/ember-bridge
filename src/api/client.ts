/**
 * Typed client for the localhost bridge API.
 *
 * The React UI deliberately consumes the same REST API that Ember uses from
 * the browser (rather than private Tauri commands), so the Ember-facing
 * contract is exercised by every screen of the app. The only Tauri command
 * involved is `local_api_info`, which hands the UI the port + token.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  ApiErrorBody,
  BridgeStatus,
  JobRecord,
  LogsResponse,
  MachineInfo,
  MachinesResponse,
  MachineStatus,
  PendingPairing,
  SavedMachine,
  Settings,
} from "./types";

export interface LocalApiInfo {
  port: number;
  token: string;
  version: string;
  serverRunning: boolean;
  serverError: string | null;
}

/** Error thrown for any non-2xx API response. `code` is machine-readable. */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class BridgeClient {
  private constructor(
    public readonly info: LocalApiInfo,
    private readonly baseUrl: string,
  ) {}

  /** Ask the Tauri backend where the API lives, and build a client. */
  static async connect(): Promise<BridgeClient> {
    const info = await invoke<LocalApiInfo>("local_api_info");
    return new BridgeClient(info, `http://127.0.0.1:${info.port}`);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.info.token}`,
          ...init?.headers,
        },
      });
    } catch {
      throw new ApiError(
        "bridge_unreachable",
        "The local API is not responding.",
        0,
      );
    }
    if (!response.ok) {
      let code = "http_error";
      let message = `API answered HTTP ${response.status}`;
      try {
        const body = (await response.json()) as ApiErrorBody;
        code = body.error.code;
        message = body.error.message;
      } catch {
        // Non-JSON error body; keep the generic message.
      }
      throw new ApiError(code, message, response.status);
    }
    return (await response.json()) as T;
  }

  // -- Bridge ---------------------------------------------------------------

  status(): Promise<BridgeStatus> {
    return this.request("/api/status");
  }

  // -- Machines -------------------------------------------------------------

  machines(): Promise<MachinesResponse> {
    return this.request("/api/machines");
  }

  machineInfo(ip: string): Promise<MachineInfo> {
    return this.request(`/api/info?ip=${encodeURIComponent(ip)}`);
  }

  machineStatus(ip: string): Promise<MachineStatus> {
    return this.request(`/api/status?ip=${encodeURIComponent(ip)}`);
  }

  saveMachine(machine: SavedMachine): Promise<{ saved: SavedMachine[] }> {
    return this.request("/api/machines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(machine),
    });
  }

  deleteMachine(ip: string): Promise<{ saved: SavedMachine[] }> {
    return this.request(`/api/machines/${encodeURIComponent(ip)}`, {
      method: "DELETE",
    });
  }

  /** Sweep the local network. Resolves when the sweep finishes (seconds). */
  discover(): Promise<Pick<MachinesResponse, "discovered">> {
    return this.request("/api/discover", { method: "POST" });
  }

  // -- Uploads --------------------------------------------------------------

  async send(
    ip: string,
    filename: string,
    data: ArrayBuffer,
    identity?: { manufacturer: string; serial: string | null },
    overwrite = false,
  ): Promise<JobRecord> {
    const query = new URLSearchParams({
      ip,
      filename,
      overwrite: String(overwrite),
      ...(identity?.serial
        ? { manufacturer: identity.manufacturer, serial: identity.serial }
        : {}),
    });
    const result = await this.request<{ job: JobRecord }>(
      `/api/send?${query}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: data,
      },
    );
    return result.job;
  }

  deleteFile(
    ip: string,
    filename: string,
    manufacturer: string,
    serial: string,
  ): Promise<{ ok: boolean }> {
    return this.request(
      `/api/files?${new URLSearchParams({ ip, filename, manufacturer, serial, confirmed: "true" })}`,
      { method: "DELETE" },
    );
  }
  cancelJob(id: string): Promise<{ job: JobRecord }> {
    return this.request(`/api/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    });
  }
  resolveJob(id: string, delivered: boolean): Promise<{ job: JobRecord }> {
    return this.request(`/api/jobs/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delivered }),
    });
  }

  async jobs(): Promise<JobRecord[]> {
    const result = await this.request<{ jobs: JobRecord[] }>("/api/jobs");
    return result.jobs;
  }

  async job(id: string): Promise<JobRecord> {
    const result = await this.request<{ job: JobRecord }>(
      `/api/jobs/${encodeURIComponent(id)}`,
    );
    return result.job;
  }

  // -- Pairing (desktop-UI side) ---------------------------------------------

  async pairingPending(): Promise<PendingPairing | null> {
    const result = await this.request<{ pending: PendingPairing | null }>(
      "/api/pairing",
    );
    return result.pending;
  }

  respondPairing(id: string, approve: boolean): Promise<{ ok: boolean }> {
    return this.request("/api/pairing/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, approve }),
    });
  }

  // -- Logs & settings ------------------------------------------------------

  logs(afterSeq: number): Promise<LogsResponse> {
    return this.request(`/api/logs?afterSeq=${afterSeq}`);
  }

  settings(): Promise<Settings> {
    return this.request("/api/settings");
  }

  updateSettings(allowedOrigins: string[]): Promise<{ ok: boolean }> {
    return this.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowedOrigins }),
    });
  }
}
