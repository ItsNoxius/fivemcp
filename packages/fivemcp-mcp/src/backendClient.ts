import {
  ActionResultSchema,
  AnnounceRequestSchema,
  AuditResponseSchema,
  ErrorEnvelopeSchema,
  FIVEMCP_TOKEN_HEADER,
  type ActionResult,
  type AnnounceRequest,
  type AuditResponse,
  type ErrorEnvelope,
  type Player,
  type Resource,
  type ResourcesResponse,
  type StatusResponse,
  PlayerSchema,
  ResourceSchema,
  ResourcesResponseSchema,
  StatusSchema,
} from "@fivemcp/shared";
import { PlayersResponseSchema } from "@fivemcp/shared";

import type { McpConfig } from "./config";

export class BackendClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: string,
  ) {
    super(message);
  }

  static fromEnvelope(envelope: ErrorEnvelope): BackendClientError {
    return new BackendClientError(
      envelope.error.status,
      envelope.error.code,
      envelope.error.message,
      envelope.error.details,
    );
  }
}

export class BackendClient {
  constructor(private readonly config: Pick<McpConfig, "backendBaseUrl" | "backendToken" | "timeoutMs">) {}

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    schema: { parse: (value: unknown) => T },
    body?: unknown,
  ): Promise<T> {
    if (!this.config.backendToken) {
      throw new BackendClientError(
        500,
        "missing_backend_token",
        "FIVEMCP_TOKEN is not configured.",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.backendBaseUrl}${path}`, {
        method,
        headers: {
          [FIVEMCP_TOKEN_HEADER]: this.config.backendToken,
          "Content-Type": "application/json",
        },
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const payload = text.length > 0 ? JSON.parse(text) : null;

      if (!response.ok) {
        const parsedError = ErrorEnvelopeSchema.safeParse(payload);
        if (parsedError.success) {
          throw BackendClientError.fromEnvelope(parsedError.data);
        }

        throw new BackendClientError(
          response.status,
          "backend_http_error",
          `Backend request failed with HTTP ${response.status}.`,
          text,
        );
      }

      return schema.parse(payload);
    } catch (error) {
      if (error instanceof BackendClientError) {
        throw error;
      }

      if ((error as Error).name === "AbortError") {
        throw new BackendClientError(
          504,
          "backend_timeout",
          "Backend request timed out.",
        );
      }

      throw new BackendClientError(
        502,
        "backend_unreachable",
        "Failed to reach the FiveM backend.",
        (error as Error).message,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  getStatus(): Promise<StatusResponse> {
    return this.request("GET", "/status", StatusSchema);
  }

  async listPlayers(): Promise<Player[]> {
    const response = await this.request("GET", "/players", PlayersResponseSchema);
    return response.players;
  }

  getPlayer(serverId: number): Promise<Player> {
    return this.request("GET", `/players/${serverId}`, PlayerSchema);
  }

  async listResources(): Promise<Resource[]> {
    const response = await this.request(
      "GET",
      "/resources",
      ResourcesResponseSchema,
    );
    return response.resources;
  }

  getResource(resourceName: string): Promise<Resource> {
    return this.request(
      "GET",
      `/resources/${encodeURIComponent(resourceName)}`,
      ResourceSchema,
    );
  }

  getAudit(limit = 25): Promise<AuditResponse> {
    return this.request("GET", `/audit?limit=${limit}`, AuditResponseSchema);
  }

  announce(payload: AnnounceRequest): Promise<ActionResult> {
    return this.request(
      "POST",
      "/server/announce",
      ActionResultSchema,
      AnnounceRequestSchema.parse(payload),
    );
  }

  shutdown(): Promise<ActionResult> {
    return this.request("POST", "/server/shutdown", ActionResultSchema, {});
  }

  refreshResources(): Promise<ActionResult> {
    return this.request(
      "POST",
      "/resources/refresh",
      ActionResultSchema,
      {},
    );
  }

  private resourceAction(
    action: "start" | "stop" | "restart" | "ensure",
    resourceName: string,
  ): Promise<ActionResult> {
    return this.request(
      "POST",
      `/resources/${encodeURIComponent(resourceName)}/${action}`,
      ActionResultSchema,
      {},
    );
  }

  startResource(resourceName: string): Promise<ActionResult> {
    return this.resourceAction("start", resourceName);
  }

  stopResource(resourceName: string): Promise<ActionResult> {
    return this.resourceAction("stop", resourceName);
  }

  restartResource(resourceName: string): Promise<ActionResult> {
    return this.resourceAction("restart", resourceName);
  }

  ensureResource(resourceName: string): Promise<ActionResult> {
    return this.resourceAction("ensure", resourceName);
  }
}
