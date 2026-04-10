import express, { type Request, type Response } from "express";
import { FIVEMCP_MCP_TOKEN_HEADER } from "@fivemcp/shared";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { BackendClient } from "./backendClient";
import type { McpConfig } from "./config";
import { createFivemMcpServer } from "./mcpServer";

function sendMethodNotAllowed(response: Response): void {
  response.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. Use POST /mcp.",
    },
    id: null,
  });
}

function createMcpAuthMiddleware(expectedToken?: string) {
  return (request: Request, response: Response, next: express.NextFunction): void => {
    if (!expectedToken) {
      next();
      return;
    }

    const header = request.header(FIVEMCP_MCP_TOKEN_HEADER) ?? "";
    if (header !== expectedToken) {
      response.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Unauthorized MCP request.",
        },
        id: null,
      });
      return;
    }

    next();
  };
}

export function createHttpApp(config: McpConfig) {
  const app = createMcpExpressApp({ host: config.host });
  app.use(express.json({ limit: "1mb" }));
  app.use("/mcp", createMcpAuthMiddleware(config.mcpAuthToken));

  app.post("/mcp", async (request: Request, response: Response) => {
    const client = new BackendClient(config);
    const server = createFivemMcpServer(client);

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);

      response.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
            data: (error as Error).message,
          },
          id: null,
        });
      }
      await server.close();
    }
  });

  app.get("/mcp", (_request, response) => {
    sendMethodNotAllowed(response);
  });

  app.delete("/mcp", (_request, response) => {
    sendMethodNotAllowed(response);
  });

  return app;
}
