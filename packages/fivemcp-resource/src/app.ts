import { z } from "zod";

import {
  ActionResultSchema,
  AnnounceRequestSchema,
  AuditEntrySchema,
  AuditQuerySchema,
  AuditResponseSchema,
  DEFAULT_ANNOUNCEMENT_TEMPLATE,
  EmptyObjectSchema,
  ErrorEnvelopeSchema,
  FIVEMCP_TOKEN_HEADER,
  LOOPBACK_ADDRESSES,
  PlayerParamsSchema,
  PlayersResponseSchema,
  ResourceParamsSchema,
  ResourcesResponseSchema,
  StatusSchema,
  type ActionResult,
  type AuditEntry,
  type ErrorEnvelope,
} from "@fivemcp/shared";

import { AuditLog } from "./audit";
import type { HttpRequest, HttpResponse } from "./httpTypes";
import { Router } from "./router";
import { createDefaultRuntime, type FiveMRuntime } from "./runtime";

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: string,
  ) {
    super(message);
  }
}

interface NormalizedRequest {
  address: string;
  method: string;
  pathname: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  bodyJson: unknown;
}

interface RouteContext {
  auditLog: AuditLog;
  request: NormalizedRequest;
  response: HttpResponse;
  runtime: FiveMRuntime;
}

type ResourceLifecycleAction = "start" | "stop" | "restart" | "ensure";

function errorEnvelopeFrom(error: HttpError): ErrorEnvelope {
  return ErrorEnvelopeSchema.parse({
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details,
    },
  });
}

function sendJson(response: HttpResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.send(JSON.stringify(body));
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function parseWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  message: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, "validation_error", message, result.error.message);
  }
  return result.data;
}

function normalizeRemoteAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.startsWith("[")) {
    const closingBracketIndex = trimmed.indexOf("]");
    if (closingBracketIndex !== -1) {
      return trimmed.slice(1, closingBracketIndex);
    }
  }

  const lastColonIndex = trimmed.lastIndexOf(":");
  if (lastColonIndex !== -1) {
    const maybePort = trimmed.slice(lastColonIndex + 1);
    if (/^\d+$/.test(maybePort)) {
      const maybeHost = trimmed.slice(0, lastColonIndex);
      if (
        maybeHost === "127.0.0.1" ||
        maybeHost === "::1" ||
        maybeHost === "::ffff:127.0.0.1" ||
        maybeHost === "localhost"
      ) {
        return maybeHost;
      }
    }
  }

  return trimmed;
}

function assertLoopback(address: string): void {
  const normalizedAddress = normalizeRemoteAddress(address);
  if (
    normalizedAddress !== "localhost" &&
    !LOOPBACK_ADDRESSES.has(normalizedAddress)
  ) {
    throw new HttpError(
      403,
      "forbidden_origin",
      "Only loopback requests are allowed.",
      `Received remote address: ${address}`,
    );
  }
}

function assertAuthorized(request: NormalizedRequest, runtime: FiveMRuntime): void {
  const expectedToken = runtime.getToken();
  if (!expectedToken) {
    throw new HttpError(
      503,
      "server_not_configured",
      "fivemcp_token is not configured.",
    );
  }

  const providedToken = (request.headers[FIVEMCP_TOKEN_HEADER] ?? "").trim();
  if (!providedToken) {
    throw new HttpError(
      401,
      "missing_auth_token",
      `${FIVEMCP_TOKEN_HEADER} header must contain the token value.`,
    );
  }

  if (!providedToken || providedToken !== expectedToken) {
    throw new HttpError(
      401,
      "invalid_auth_token",
      `${FIVEMCP_TOKEN_HEADER} token is invalid.`,
    );
  }
}

function sanitizeCommandValue(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/"/g, '\\"')
    .trim();
}

function buildAnnouncementCommand(
  template: string,
  message: string,
): string {
  const commandTemplate = template.trim() || DEFAULT_ANNOUNCEMENT_TEMPLATE;
  const safeMessage = sanitizeCommandValue(message);
  if (commandTemplate.includes("{message}")) {
    return commandTemplate.replaceAll("{message}", safeMessage);
  }
  return `${commandTemplate} ${safeMessage}`.trim();
}

function createAuditEntry(
  runtime: FiveMRuntime,
  action: string,
  target: string | null,
  origin: string,
  success: boolean,
  error: string | null,
): AuditEntry {
  return AuditEntrySchema.parse({
    id: runtime.randomId(),
    timestamp: runtime.nowIso(),
    action,
    target,
    origin,
    success,
    error,
  });
}

async function readBody(request: HttpRequest): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let settled = false;

    const finish = (value: string): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    request.setCancelHandler(() => {
      if (!settled) {
        settled = true;
        reject(
          new HttpError(499, "request_cancelled", "The request was cancelled."),
        );
      }
    });

    request.setDataHandler((data) => {
      finish(data);
    });

    setTimeout(() => finish(""), 0);
  });
}

async function normalizeRequest(request: HttpRequest): Promise<NormalizedRequest> {
  const url = new URL(
    request.path.startsWith("/") ? request.path : `/${request.path}`,
    "http://127.0.0.1",
  );
  const method = request.method.toUpperCase();
  const headers = normalizeHeaders(request.headers);
  let bodyJson: unknown = {};

  if (method === "POST") {
    const bodyText = await readBody(request);
    if (bodyText.trim().length > 0) {
      try {
        bodyJson = JSON.parse(bodyText);
      } catch (error) {
        throw new HttpError(
          400,
          "invalid_json",
          "Request body must be valid JSON.",
          (error as Error).message,
        );
      }
    }
  }

  return {
    address: request.address,
    method,
    pathname: url.pathname,
    query: url.searchParams,
    headers,
    bodyJson,
  };
}

function createActionResult(
  runtime: FiveMRuntime,
  action: string,
  target: string | null,
  message: string,
  auditEntry: AuditEntry,
): ActionResult {
  return ActionResultSchema.parse({
    ok: true,
    action,
    target,
    message,
    auditEntry,
  });
}

async function waitForResourceState(
  runtime: FiveMRuntime,
  resourceName: string,
  acceptableStates: string[],
  timeoutMs = 1500,
  intervalMs = 50,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const currentState = runtime.getResourceState(resourceName);
    if (acceptableStates.includes(currentState)) {
      return currentState;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return runtime.getResourceState(resourceName);
}

async function settleResourceState(
  runtime: FiveMRuntime,
  resourceName: string,
): Promise<string> {
  const currentState = runtime.getResourceState(resourceName);
  if (currentState !== "starting" && currentState !== "stopping") {
    return currentState;
  }

  return await waitForResourceState(runtime, resourceName, ["started", "stopped"]);
}

async function performResourceLifecycleAction(
  runtime: FiveMRuntime,
  action: ResourceLifecycleAction,
  resourceName: string,
): Promise<{ success: true; message: string } | { success: false; message: string }> {
  let initialState = await settleResourceState(runtime, resourceName);

  if (action === "start") {
    if (initialState === "started") {
      return { success: true, message: "Resource is already started." };
    }

    const started = runtime.startResource(resourceName);
    if (!started) {
      return { success: false, message: "StartResource returned false." };
    }

    const finalState = await waitForResourceState(runtime, resourceName, ["started"]);
    if (finalState !== "started") {
      return {
        success: false,
        message: `Resource did not reach started state. Current state: ${finalState}.`,
      };
    }

    return { success: true, message: "Resource started successfully." };
  }

  if (action === "stop") {
    if (initialState === "stopped") {
      return { success: true, message: "Resource is already stopped." };
    }

    const stopped = runtime.stopResource(resourceName);
    if (!stopped) {
      return { success: false, message: "StopResource returned false." };
    }

    const finalState = await waitForResourceState(runtime, resourceName, ["stopped"]);
    if (finalState !== "stopped") {
      return {
        success: false,
        message: `Resource did not reach stopped state. Current state: ${finalState}.`,
      };
    }

    return { success: true, message: "Resource stopped successfully." };
  }

  if (action === "restart") {
    if (initialState === "stopped") {
      const started = runtime.startResource(resourceName);
      if (!started) {
        return {
          success: false,
          message: "Resource was stopped and could not be started during restart.",
        };
      }

      const startedState = await waitForResourceState(runtime, resourceName, ["started"]);
      if (startedState !== "started") {
        return {
          success: false,
          message: `Stopped resource could not be started during restart. Current state: ${startedState}.`,
        };
      }

      return {
        success: true,
        message: "Resource was stopped and has been started successfully.",
      };
    }

    const stopped = runtime.stopResource(resourceName);
    if (!stopped) {
      return { success: false, message: "StopResource returned false during restart." };
    }

    const stoppedState = await waitForResourceState(runtime, resourceName, ["stopped"]);
    if (stoppedState !== "stopped") {
      return {
        success: false,
        message: `Resource did not stop during restart. Current state: ${stoppedState}.`,
      };
    }

    const started = runtime.startResource(resourceName);
    if (!started) {
      return { success: false, message: "StartResource returned false during restart." };
    }

    const finalState = await waitForResourceState(runtime, resourceName, ["started"]);
    if (finalState !== "started") {
      return {
        success: false,
        message: `Resource did not restart successfully. Current state: ${finalState}.`,
      };
    }

    return { success: true, message: "Resource restarted successfully." };
  }

  initialState = await settleResourceState(runtime, resourceName);
  if (initialState === "started") {
    return { success: true, message: "Resource is already started." };
  }

  const started = runtime.startResource(resourceName);
  if (!started) {
    return { success: false, message: "StartResource returned false during ensure." };
  }

  const finalState = await waitForResourceState(runtime, resourceName, ["started"]);
  if (finalState !== "started") {
    return {
      success: false,
      message: `Resource did not reach started state during ensure. Current state: ${finalState}.`,
    };
  }

  return { success: true, message: "Resource ensured successfully." };
}

export interface FiveMHttpApp {
  handle(request: HttpRequest, response: HttpResponse): Promise<void>;
}

export function createFiveMHttpApp(
  runtime: FiveMRuntime = createDefaultRuntime(),
  auditLog: AuditLog = new AuditLog(),
): FiveMHttpApp {
  const router = new Router<RouteContext>();

  router.get("/v1/status", ({ response, runtime: currentRuntime }) => {
    sendJson(response, 200, StatusSchema.parse(currentRuntime.getStatus()));
  });

  router.get("/v1/players", ({ response, runtime: currentRuntime }) => {
    sendJson(
      response,
      200,
      PlayersResponseSchema.parse({ players: currentRuntime.listPlayers() }),
    );
  });

  router.get("/v1/players/:serverId", ({ response, runtime: currentRuntime }, match) => {
    const params = parseWithSchema(
      PlayerParamsSchema,
      match.params,
      "Player serverId must be a positive integer.",
    );
    const player = currentRuntime.findPlayer(params.serverId);
    if (!player) {
      throw new HttpError(404, "player_not_found", "Player is not online.");
    }
    sendJson(response, 200, player);
  });

  router.get("/v1/resources", ({ response, runtime: currentRuntime }) => {
    sendJson(
      response,
      200,
      ResourcesResponseSchema.parse({
        resources: currentRuntime.listResources(),
      }),
    );
  });

  router.get(
    "/v1/resources/:resourceName",
    ({ response, runtime: currentRuntime }, match) => {
      const params = parseWithSchema(
        ResourceParamsSchema,
        match.params,
        "Resource name is required.",
      );
      const resource = currentRuntime.findResource(params.resourceName);
      if (!resource) {
        throw new HttpError(404, "resource_not_found", "Resource was not found.");
      }
      sendJson(response, 200, resource);
    },
  );

  router.get("/v1/audit", ({ request, response, auditLog: currentAuditLog }) => {
    const query = parseWithSchema(
      AuditQuerySchema,
      { limit: request.query.get("limit") ?? undefined },
      "Audit limit must be between 1 and 100.",
    );
    sendJson(
      response,
      200,
      AuditResponseSchema.parse({
        audit: currentAuditLog.list(query.limit),
      }),
    );
  });

  router.post("/v1/server/announce", ({ request, response, runtime: currentRuntime, auditLog: currentAuditLog }) => {
    const payload = parseWithSchema(
      AnnounceRequestSchema,
      request.bodyJson,
      "Announcement request body is invalid.",
    );
    const command = buildAnnouncementCommand(
      currentRuntime.getAnnouncementTemplate(),
      payload.message,
    );
    let auditEntry = createAuditEntry(
      currentRuntime,
      "broadcast_message",
      null,
      request.address,
      true,
      null,
    );

    try {
      currentRuntime.executeCommand(command);
    } catch (error) {
      auditEntry = createAuditEntry(
        currentRuntime,
        "broadcast_message",
        null,
        request.address,
        false,
        (error as Error).message,
      );
      currentAuditLog.append(auditEntry);
      throw new HttpError(
        500,
        "command_execution_failed",
        "Failed to broadcast message.",
        (error as Error).message,
      );
    }

    currentAuditLog.append(auditEntry);
    sendJson(
      response,
      200,
      createActionResult(
        currentRuntime,
        "broadcast_message",
        null,
        "Broadcast command sent.",
        auditEntry,
      ),
    );
  });

  router.post("/v1/server/shutdown", ({ request, response, runtime: currentRuntime, auditLog: currentAuditLog }) => {
    parseWithSchema(
      EmptyObjectSchema,
      request.bodyJson,
      "Shutdown request body must be an empty object.",
    );

    const command = 'quit "fivemcp shutdown requested"';
    let auditEntry = createAuditEntry(
      currentRuntime,
      "shutdown_server",
      null,
      request.address,
      true,
      null,
    );
    currentAuditLog.append(auditEntry);

    try {
      currentRuntime.executeCommand(command);
    } catch (error) {
      auditEntry = createAuditEntry(
        currentRuntime,
        "shutdown_server",
        null,
        request.address,
        false,
        (error as Error).message,
      );
      currentAuditLog.append(auditEntry);
      throw new HttpError(
        500,
        "command_execution_failed",
        "Failed to shut down the server.",
        (error as Error).message,
      );
    }

    sendJson(
      response,
      200,
      createActionResult(
        currentRuntime,
        "shutdown_server",
        null,
        "Shutdown command sent.",
        auditEntry,
      ),
    );
  });

  router.post("/v1/resources/refresh", ({ request, response, runtime: currentRuntime, auditLog: currentAuditLog }) => {
    parseWithSchema(
      EmptyObjectSchema,
      request.bodyJson,
      "Refresh request body must be an empty object.",
    );

    const auditEntry = createAuditEntry(
      currentRuntime,
      "refresh_resources",
      null,
      request.address,
      true,
      null,
    );
    try {
      currentRuntime.executeCommand("refresh");
    } catch (error) {
      const failedAuditEntry = createAuditEntry(
        currentRuntime,
        "refresh_resources",
        null,
        request.address,
        false,
        (error as Error).message,
      );
      currentAuditLog.append(failedAuditEntry);
      throw new HttpError(
        500,
        "command_execution_failed",
        "Failed to refresh resources.",
        (error as Error).message,
      );
    }

    currentAuditLog.append(auditEntry);
    sendJson(
      response,
      200,
      createActionResult(
        currentRuntime,
        "refresh_resources",
        null,
        "Refresh command sent.",
        auditEntry,
      ),
    );
  });

  for (const [pathAction, commandAction] of [
    ["start", "start_resource"],
    ["stop", "stop_resource"],
    ["restart", "restart_resource"],
    ["ensure", "ensure_resource"],
  ] as const) {
    router.post(
      `/v1/resources/:resourceName/${pathAction}`,
      async ({ request, response, runtime: currentRuntime, auditLog: currentAuditLog }, match) => {
        parseWithSchema(
          EmptyObjectSchema,
          request.bodyJson,
          `${pathAction} request body must be an empty object.`,
        );
        const params = parseWithSchema(
          ResourceParamsSchema,
          match.params,
          "Resource name is required.",
        );

        const resource = currentRuntime.findResource(params.resourceName);
        if (!resource) {
          throw new HttpError(
            404,
            "resource_not_found",
            "Resource was not found.",
          );
        }

        const lifecycleResult = await performResourceLifecycleAction(
          currentRuntime,
          pathAction,
          params.resourceName,
        );

        if (!lifecycleResult.success) {
          const failedAuditEntry = createAuditEntry(
            currentRuntime,
            commandAction,
            params.resourceName,
            request.address,
            false,
            lifecycleResult.message,
          );
          currentAuditLog.append(failedAuditEntry);
          throw new HttpError(
            409,
            "resource_lifecycle_failed",
            `Failed to ${pathAction} resource.`,
            lifecycleResult.message,
          );
        }

        const auditEntry = createAuditEntry(
          currentRuntime,
          commandAction,
          params.resourceName,
          request.address,
          true,
          null,
        );
        currentAuditLog.append(auditEntry);
        sendJson(
          response,
          200,
          createActionResult(
            currentRuntime,
            commandAction,
            params.resourceName,
            lifecycleResult.message,
            auditEntry,
          ),
        );
      },
    );
  }

  return {
    async handle(request, response) {
      try {
        const normalizedRequest = await normalizeRequest(request);
        assertLoopback(normalizedRequest.address);
        assertAuthorized(normalizedRequest, runtime);

        const context: RouteContext = {
          auditLog,
          request: normalizedRequest,
          response,
          runtime,
        };

        const matched = await router.handle(
          normalizedRequest.method,
          normalizedRequest.pathname,
          context,
        );

        if (!matched) {
          throw new HttpError(404, "route_not_found", "Route was not found.");
        }
      } catch (error) {
        if (error instanceof HttpError) {
          sendJson(response, error.status, errorEnvelopeFrom(error));
          return;
        }

        const fallbackError = new HttpError(
          500,
          "internal_error",
          "An unexpected error occurred.",
          (error as Error).message,
        );
        sendJson(response, 500, errorEnvelopeFrom(fallbackError));
      }
    },
  };
}
