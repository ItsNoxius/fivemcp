import { once } from "node:events";
import { createServer, type Server } from "node:http";

import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIVEMCP_MCP_TOKEN_HEADER, FIVEMCP_TOKEN_HEADER } from "@fivemcp/shared";

import { createHttpApp } from "../src/app";
import type { McpConfig } from "../src/config";

function mcpPost(
  app: ReturnType<typeof createHttpApp>,
  body: object,
  authToken?: string,
) {
  const req = request(app)
    .post("/mcp")
    .set("accept", "application/json, text/event-stream")
    .set("content-type", "application/json");

  if (authToken) {
    req.set(FIVEMCP_MCP_TOKEN_HEADER, authToken);
  }

  return req.send(body);
}

async function startBackend(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(express.json());

  const status = {
    resourceName: "fivemcp",
    resourceVersion: "0.1.0",
    serverName: "Mock Server",
    hostname: "Mock Host",
    playerCount: 2,
    maxClients: 32,
    capabilities: {
      canStartServer: false,
      canRestartServer: false,
      canShutdownServer: true,
    },
  };

  app.use((req, res, next) => {
    if (req.header(FIVEMCP_TOKEN_HEADER) !== "backend-secret") {
      res.status(401).json({
        ok: false,
        error: {
          code: "invalid_auth_token",
          message: "invalid token",
          status: 401,
        },
      });
      return;
    }
    next();
  });

  app.get("/v1/status", (_req, res) => res.json(status));
  app.get("/v1/players", (_req, res) =>
    res.json({
      players: [
        {
          serverId: 7,
          name: "Alice",
          ping: 42,
          identifiers: ["license:abc"],
        },
      ],
    }),
  );
  app.get("/v1/players/:serverId", (req, res) =>
    res.json({
      serverId: Number(req.params.serverId),
      name: "Alice",
      ping: 42,
      identifiers: ["license:abc"],
    }),
  );
  app.get("/v1/resources", (_req, res) =>
    res.json({
      resources: [
        {
          name: "fivemcp",
          state: "started",
          author: "test",
          version: "0.1.0",
          description: "resource",
          path: "C:/resources/fivemcp",
        },
      ],
    }),
  );
  app.get("/v1/resources/:resourceName", (req, res) => {
    if (req.params.resourceName === "missing") {
      res.status(404).json({
        ok: false,
        error: {
          code: "resource_not_found",
          message: "missing",
          status: 404,
        },
      });
      return;
    }
    res.json({
      name: req.params.resourceName,
      state: "started",
      author: "test",
      version: "0.1.0",
      description: "resource",
      path: "C:/resources/" + req.params.resourceName,
    });
  });
  app.get("/v1/audit", (_req, res) =>
    res.json({
      audit: [
        {
          id: "1",
          timestamp: "2026-04-08T00:00:00.000Z",
          action: "broadcast_message",
          target: null,
          origin: "127.0.0.1",
          success: true,
          error: null,
        },
      ],
    }),
  );
  app.post("/v1/server/announce", (req, res) =>
    res.json({
      ok: true,
      action: "broadcast_message",
      target: null,
      message: `Broadcast command sent: ${req.body.message}`,
      auditEntry: {
        id: "2",
        timestamp: "2026-04-08T00:00:01.000Z",
        action: "broadcast_message",
        target: null,
        origin: "127.0.0.1",
        success: true,
        error: null,
      },
    }),
  );
  app.post("/v1/resources/refresh", (_req, res) =>
    res.json({
      ok: true,
      action: "refresh_resources",
      target: null,
      message: "Refresh command sent.",
      auditEntry: {
        id: "3",
        timestamp: "2026-04-08T00:00:02.000Z",
        action: "refresh_resources",
        target: null,
        origin: "127.0.0.1",
        success: true,
        error: null,
      },
    }),
  );
  app.post("/v1/resources/:resourceName/:action", (req, res) =>
    res.json({
      ok: true,
      action: `${req.params.action}_resource`,
      target: req.params.resourceName,
      message: `Resource ${req.params.action} command sent.`,
      auditEntry: {
        id: "4",
        timestamp: "2026-04-08T00:00:03.000Z",
        action: `${req.params.action}_resource`,
        target: req.params.resourceName,
        origin: "127.0.0.1",
        success: true,
        error: null,
      },
    }),
  );
  app.post("/v1/server/shutdown", (_req, res) =>
    res.json({
      ok: true,
      action: "shutdown_server",
      target: null,
      message: "Shutdown command sent.",
      auditEntry: {
        id: "5",
        timestamp: "2026-04-08T00:00:04.000Z",
        action: "shutdown_server",
        target: null,
        origin: "127.0.0.1",
        success: true,
        error: null,
      },
    }),
  );

  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test backend.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

describe("createHttpApp", () => {
  let backend: Awaited<ReturnType<typeof startBackend>>;

  beforeEach(async () => {
    backend = await startBackend();
  });

  afterEach(async () => {
    await backend.close();
  });

  function createConfig(overrides?: Partial<McpConfig>): McpConfig {
    return {
      backendBaseUrl: backend.baseUrl,
      backendToken: "backend-secret",
      host: "127.0.0.1",
      port: 3001,
      timeoutMs: 5000,
      mcpAuthToken: undefined,
      ...overrides,
    };
  }

  it("serves MCP initialize and tool calls over /mcp", async () => {
    const app = createHttpApp(createConfig());

    const initialize = await mcpPost(app, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "vitest",
          version: "1.0.0",
        },
      },
    });

    expect(initialize.status).toBe(200);
    expect(initialize.body.result.serverInfo.name).toBe("fivemcp");

    const toolCall = await mcpPost(app, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "fivem_get_status",
        arguments: {},
      },
    });

    expect(toolCall.status).toBe(200);
    expect(toolCall.body.result.isError).not.toBe(true);
    expect(toolCall.body.result.structuredContent).toMatchObject({
      serverName: "Mock Server",
    });
  });

  it("returns tool errors in MCP error result format", async () => {
    const app = createHttpApp(createConfig());

    const response = await mcpPost(app, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "fivem_get_resource",
        arguments: {
          resourceName: "missing",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result.isError).toBe(true);
    expect(response.body.result.structuredContent).toMatchObject({
      ok: false,
      status: 404,
      code: "resource_not_found",
    });
  });

  it("serves MCP resources via /mcp", async () => {
    const app = createHttpApp(createConfig());

    const response = await mcpPost(app, {
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: {
        uri: "fivem://status",
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result.contents[0].uri).toBe("fivem://status");
    expect(response.body.result.contents[0].text).toContain("Mock Server");
  });

  it("enforces optional MCP auth token", async () => {
    const app = createHttpApp(createConfig({ mcpAuthToken: "mcp-secret" }));

    const unauthorized = await mcpPost(app, {
      jsonrpc: "2.0",
      id: 5,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "vitest",
          version: "1.0.0",
        },
      },
    });

    expect(unauthorized.status).toBe(401);

    const authorized = await mcpPost(
      app,
      {
        jsonrpc: "2.0",
        id: 6,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: {
            name: "vitest",
            version: "1.0.0",
          },
        },
      },
      "mcp-secret",
    );

    expect(authorized.status).toBe(200);
    expect(authorized.body.result.serverInfo.name).toBe("fivemcp");
  });
});
