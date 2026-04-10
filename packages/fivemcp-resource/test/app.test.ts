import { describe, expect, it } from "vitest";

import type { Player, Resource, StatusResponse } from "@fivemcp/shared";

import { createFiveMHttpApp } from "../src/app";
import type { HttpRequest, HttpResponse } from "../src/httpTypes";
import type { FiveMRuntime } from "../src/runtime";

class FakeResponse implements HttpResponse {
  public statusCode = 200;
  public headers: Record<string, string | string[]> = {};
  public body = "";

  writeHead(code: number, headers?: Record<string, string | string[]>): void {
    this.statusCode = code;
    this.headers = headers ?? {};
  }

  write(data: string): void {
    this.body += data;
  }

  send(data = ""): void {
    this.body += data;
  }
}

function createRequest(
  path: string,
  options?: {
    method?: string;
    address?: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): HttpRequest {
  const body =
    options?.body === undefined ? undefined : JSON.stringify(options.body);

  function setDataHandler(handler: (data: string) => void): void;
  function setDataHandler(
    handler: (data: ArrayBuffer) => void,
    binary: "binary",
  ): void;
  function setDataHandler(
    handler: ((data: string) => void) | ((data: ArrayBuffer) => void),
    binary?: "binary",
  ): void {
    if (body === undefined) {
      return;
    }

    queueMicrotask(() => {
      if (binary === "binary") {
        (handler as (data: ArrayBuffer) => void)(Buffer.from(body).buffer);
        return;
      }
      (handler as (data: string) => void)(body);
    });
  }

  return {
    address: options?.address ?? "127.0.0.1",
    headers: options?.headers ?? {},
    method: options?.method ?? "GET",
    path,
    setCancelHandler() {},
    setDataHandler,
  };
}

function createRuntime(): FiveMRuntime {
  const commands: string[] = [];
  const players: Player[] = [];
  const resourceStates = new Map<string, string>([
    ["fivemcp", "started"],
    ["demo", "started"],
  ]);
  const resources: Resource[] = [
    {
      name: "fivemcp",
      state: "started",
      author: "test",
      version: "0.1.0",
      description: "resource",
      path: "C:/server/resources/fivemcp",
    },
    {
      name: "demo",
      state: "started",
      author: "test",
      version: "1.0.0",
      description: "demo resource",
      path: "C:/server/resources/demo",
    },
  ];
  const status: StatusResponse = {
    resourceName: "fivemcp",
    resourceVersion: "0.1.0",
    serverName: "Test Server",
    hostname: "Test Host",
    playerCount: 0,
    maxClients: 32,
    capabilities: {
      canStartServer: false,
      canRestartServer: false,
      canShutdownServer: true,
    },
  };

  return {
    getToken: () => "secret-token",
    getAnnouncementTemplate: () => 'say [MCP] "{message}"',
    getStatus: () => ({ ...status, playerCount: players.length }),
    listPlayers: () => [...players],
    findPlayer: (serverId) => players.find((player) => player.serverId === serverId) ?? null,
    listResources: () => [...resources],
    findResource: (resourceName) =>
      resourceStates.get(resourceName) === undefined
        ? null
        : {
            ...(resources.find((resource) => resource.name === resourceName) ?? {
              name: resourceName,
              author: null,
              version: null,
              description: null,
              path: null,
            }),
            state: resourceStates.get(resourceName) ?? "missing",
          },
    getResourceState: (resourceName) => resourceStates.get(resourceName) ?? "missing",
    startResource: (resourceName) => {
      if (!resourceStates.has(resourceName)) {
        return false;
      }
      resourceStates.set(resourceName, "started");
      return true;
    },
    stopResource: (resourceName) => {
      if (!resourceStates.has(resourceName)) {
        return false;
      }
      resourceStates.set(resourceName, "stopped");
      return true;
    },
    executeCommand: (command) => {
      commands.push(command);
    },
    nowIso: () => "2026-04-08T00:00:00.000Z",
    randomId: () => `audit-${commands.length + 1}`,
  };
}

async function invoke(
  app: ReturnType<typeof createFiveMHttpApp>,
  request: HttpRequest,
): Promise<{ response: FakeResponse; json: unknown }> {
  const response = new FakeResponse();
  await app.handle(request, response);
  await new Promise((resolve) => setTimeout(resolve, 1));
  return {
    response,
    json: response.body.length > 0 ? JSON.parse(response.body) : null,
  };
}

describe("createFiveMHttpApp", () => {
  it("rejects missing bearer token", async () => {
    const runtime = createRuntime();
    const app = createFiveMHttpApp(runtime);

    const { response, json } = await invoke(app, createRequest("/v1/status"));

    expect(response.statusCode).toBe(401);
    expect(json).toMatchObject({
      ok: false,
      error: { code: "missing_bearer_token" },
    });
  });

  it("rejects non-loopback callers with valid auth", async () => {
    const runtime = createRuntime();
    const app = createFiveMHttpApp(runtime);

    const { response, json } = await invoke(
      app,
      createRequest("/v1/status", {
        address: "10.0.0.5",
        headers: { authorization: "Bearer secret-token" },
      }),
    );

    expect(response.statusCode).toBe(403);
    expect(json).toMatchObject({
      ok: false,
      error: { code: "forbidden_origin" },
    });
  });

  it("accepts loopback callers reported with a port suffix", async () => {
    const runtime = createRuntime();
    const app = createFiveMHttpApp(runtime);

    const { response, json } = await invoke(
      app,
      createRequest("/v1/status", {
        address: "127.0.0.1:45678",
        headers: { authorization: "Bearer secret-token" },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(json).toMatchObject({
      serverName: "Test Server",
    });
  });

  it("accepts bracketed IPv6 loopback callers with a port suffix", async () => {
    const runtime = createRuntime();
    const app = createFiveMHttpApp(runtime);

    const { response, json } = await invoke(
      app,
      createRequest("/v1/status", {
        address: "[::1]:45678",
        headers: { authorization: "Bearer secret-token" },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(json).toMatchObject({
      serverName: "Test Server",
    });
  });

  it("returns status with lifecycle capability flags", async () => {
    const runtime = createRuntime();
    const app = createFiveMHttpApp(runtime);

    const { response, json } = await invoke(
      app,
      createRequest("/v1/status", {
        headers: { authorization: "Bearer secret-token" },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(json).toMatchObject({
      capabilities: {
        canStartServer: false,
        canRestartServer: false,
        canShutdownServer: true,
      },
    });
  });

  it("returns an empty player list when nobody is online", async () => {
    const runtime = createRuntime();
    const app = createFiveMHttpApp(runtime);

    const { response, json } = await invoke(
      app,
      createRequest("/v1/players", {
        headers: { authorization: "Bearer secret-token" },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(json).toEqual({ players: [] });
  });

  it("returns 404 when a player is not online", async () => {
    const runtime = createRuntime();
    const app = createFiveMHttpApp(runtime);

    const { response, json } = await invoke(
      app,
      createRequest("/v1/players/42", {
        headers: { authorization: "Bearer secret-token" },
      }),
    );

    expect(response.statusCode).toBe(404);
    expect(json).toMatchObject({
      ok: false,
      error: { code: "player_not_found" },
    });
  });

  it("returns resource metadata", async () => {
    const runtime = createRuntime();
    const app = createFiveMHttpApp(runtime);

    const { response, json } = await invoke(
      app,
      createRequest("/v1/resources", {
        headers: { authorization: "Bearer secret-token" },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(json).toMatchObject({
      resources: [
        expect.objectContaining({ name: "fivemcp" }),
        expect.objectContaining({ name: "demo" }),
      ],
    });
  });

  it("uses native resource lifecycle operations and shutdown command", async () => {
    const commands: string[] = [];
    const lifecycleCalls: string[] = [];
    const baseRuntime = createRuntime();
    const commandCapturingRuntime: FiveMRuntime = {
      ...baseRuntime,
      startResource(resourceName) {
        lifecycleCalls.push(`start:${resourceName}`);
        return baseRuntime.startResource(resourceName);
      },
      stopResource(resourceName) {
        lifecycleCalls.push(`stop:${resourceName}`);
        return baseRuntime.stopResource(resourceName);
      },
      executeCommand(command) {
        commands.push(command);
      },
      randomId: (() => {
        let index = 0;
        return () => `audit-${++index}`;
      })(),
    };
    const app = createFiveMHttpApp(commandCapturingRuntime);

    const authHeaders = { authorization: "Bearer secret-token" };

    await invoke(
      app,
      createRequest("/v1/resources/demo/start", {
        method: "POST",
        headers: authHeaders,
        body: {},
      }),
    );
    await invoke(
      app,
      createRequest("/v1/resources/demo/stop", {
        method: "POST",
        headers: authHeaders,
        body: {},
      }),
    );
    await invoke(
      app,
      createRequest("/v1/resources/demo/restart", {
        method: "POST",
        headers: authHeaders,
        body: {},
      }),
    );
    await invoke(
      app,
      createRequest("/v1/resources/demo/ensure", {
        method: "POST",
        headers: authHeaders,
        body: {},
      }),
    );
    await invoke(
      app,
      createRequest("/v1/resources/refresh", {
        method: "POST",
        headers: authHeaders,
        body: {},
      }),
    );
    await invoke(
      app,
      createRequest("/v1/server/shutdown", {
        method: "POST",
        headers: authHeaders,
        body: {},
      }),
    );

    expect(commands).toEqual([
      "refresh",
      'quit "fivemcp shutdown requested"',
    ]);
    expect(lifecycleCalls).toEqual([
      "stop:demo",
      "start:demo",
    ]);
  });

  it("returns a lifecycle failure when native start does not reach the expected state", async () => {
    const baseRuntime = createRuntime();
    const app = createFiveMHttpApp({
      ...baseRuntime,
      startResource() {
        return true;
      },
      getResourceState(resourceName) {
        if (resourceName === "demo") {
          return "stopped";
        }
        return baseRuntime.getResourceState(resourceName);
      },
    });

    const { response, json } = await invoke(
      app,
      createRequest("/v1/resources/demo/start", {
        method: "POST",
        headers: { authorization: "Bearer secret-token" },
        body: {},
      }),
    );

    expect(response.statusCode).toBe(409);
    expect(json).toMatchObject({
      ok: false,
      error: {
        code: "resource_lifecycle_failed",
      },
    });
  });

  it("handles restart of an already stopped resource by starting it", async () => {
    const baseRuntime = createRuntime();
    baseRuntime.stopResource("demo");

    const lifecycleCalls: string[] = [];
    const app = createFiveMHttpApp({
      ...baseRuntime,
      startResource(resourceName) {
        lifecycleCalls.push(`start:${resourceName}`);
        return baseRuntime.startResource(resourceName);
      },
      stopResource(resourceName) {
        lifecycleCalls.push(`stop:${resourceName}`);
        return baseRuntime.stopResource(resourceName);
      },
    });

    const { response, json } = await invoke(
      app,
      createRequest("/v1/resources/demo/restart", {
        method: "POST",
        headers: { authorization: "Bearer secret-token" },
        body: {},
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(json).toMatchObject({
      message: "Resource was stopped and has been started successfully.",
    });
    expect(lifecycleCalls).toEqual(["start:demo"]);
  });

  it("sanitizes announcement commands and writes audit events", async () => {
    const commands: string[] = [];
    const runtime: FiveMRuntime = {
      ...createRuntime(),
      executeCommand(command) {
        commands.push(command);
      },
      randomId: (() => {
        let index = 0;
        return () => `audit-${++index}`;
      })(),
    };
    const app = createFiveMHttpApp(runtime);
    const authHeaders = { authorization: "Bearer secret-token" };

    const result = await invoke(
      app,
      createRequest("/v1/server/announce", {
        method: "POST",
        headers: authHeaders,
        body: { message: 'line 1\nline "2"' },
      }),
    );

    expect(result.response.statusCode).toBe(200);
    expect(commands).toEqual(['say [MCP] "line 1 line \\"2\\""']);

    const audit = await invoke(
      app,
      createRequest("/v1/audit?limit=1", {
        headers: authHeaders,
      }),
    );

    expect(audit.response.statusCode).toBe(200);
    expect(audit.json).toMatchObject({
      audit: [
        {
          action: "broadcast_message",
          success: true,
        },
      ],
    });
  });
});
