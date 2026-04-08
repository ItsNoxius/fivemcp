import {
  AnnounceRequestSchema,
  MCP_RESOURCE_URIS,
  MCP_TOOL_NAMES,
  PlayerParamsSchema,
  ResourceParamsSchema,
  ToolErrorStructuredContentSchema,
} from "@fivemcp/shared";
import { ResourceTemplate, McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

import { BackendClient, BackendClientError } from "./backendClient";

function textResult(
  text: string,
  structuredContent?: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}

function toolError(error: BackendClientError): CallToolResult {
  const structuredContent = ToolErrorStructuredContentSchema.parse({
    ok: false,
    status: error.status,
    code: error.code,
    message: error.message,
    details: error.details,
  });

  return {
    content: [
      {
        type: "text",
        text: `Backend error ${error.status}: ${error.message}`,
      },
    ],
    structuredContent,
    isError: true,
  };
}

function jsonResource(uri: string, data: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

async function runTool<T>(
  callback: () => Promise<T>,
  formatter: (result: T) => string,
  toStructuredContent: (result: T) => Record<string, unknown> = (result) =>
    result as Record<string, unknown>,
): Promise<CallToolResult> {
  try {
    const result = await callback();
    return textResult(formatter(result), toStructuredContent(result));
  } catch (error) {
    if (error instanceof BackendClientError) {
      return toolError(error);
    }
    throw error;
  }
}

export function createFivemMcpServer(client: BackendClient): McpServer {
  const server = new McpServer(
    {
      name: "fivemcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
      },
    },
  );

  server.registerTool(
    MCP_TOOL_NAMES.getStatus,
    {
      title: "Get FiveM Status",
      description: "Get the current FiveM server status.",
    },
    async () =>
      runTool(
        () => client.getStatus(),
        (result) =>
          `Server "${result.serverName}" is online with ${result.playerCount}/${result.maxClients} players.`,
      ),
  );

  server.registerTool(
    MCP_TOOL_NAMES.listPlayers,
    {
      title: "List Players",
      description: "List online FiveM players.",
    },
    async () =>
      runTool(
        () => client.listPlayers(),
        (players) => `Found ${players.length} online player(s).`,
        (players) => ({ players }),
      ),
  );

  server.registerTool(
    MCP_TOOL_NAMES.getPlayer,
    {
      title: "Get Player",
      description: "Get details for an online player by server ID.",
      inputSchema: PlayerParamsSchema,
    },
    async ({ serverId }) =>
      runTool(
        () => client.getPlayer(serverId),
        (player) => `Player #${player.serverId} is ${player.name}.`,
      ),
  );

  server.registerTool(
    MCP_TOOL_NAMES.listResources,
    {
      title: "List Resources",
      description: "List FiveM resources and their states.",
    },
    async () =>
      runTool(
        () => client.listResources(),
        (resources) => `Found ${resources.length} resource(s).`,
        (resources) => ({ resources }),
      ),
  );

  server.registerTool(
    MCP_TOOL_NAMES.getResource,
    {
      title: "Get Resource",
      description: "Get a single resource by name.",
      inputSchema: ResourceParamsSchema,
    },
    async ({ resourceName }) =>
      runTool(
        () => client.getResource(resourceName),
        (resource) => `Resource ${resource.name} is ${resource.state}.`,
      ),
  );

  server.registerTool(
    MCP_TOOL_NAMES.broadcastMessage,
    {
      title: "Broadcast Message",
      description: "Broadcast an announcement to the FiveM server.",
      inputSchema: AnnounceRequestSchema,
    },
    async ({ message }) =>
      runTool(
        () => client.announce({ message }),
        (result) => result.message,
      ),
  );

  server.registerTool(
    MCP_TOOL_NAMES.refreshResources,
    {
      title: "Refresh Resources",
      description: "Run the FiveM resource refresh command.",
    },
    async () =>
      runTool(
        () => client.refreshResources(),
        (result) => result.message,
      ),
  );

  for (const [toolName, action] of [
    [MCP_TOOL_NAMES.startResource, "startResource"],
    [MCP_TOOL_NAMES.stopResource, "stopResource"],
    [MCP_TOOL_NAMES.restartResource, "restartResource"],
    [MCP_TOOL_NAMES.ensureResource, "ensureResource"],
  ] as const) {
    server.registerTool(
      toolName,
      {
        title: `${toolName}`,
        description: `Run the ${toolName} action for a resource.`,
        inputSchema: ResourceParamsSchema,
      },
      async ({ resourceName }) =>
        runTool(
          () => client[action](resourceName),
          (result) => result.message,
        ),
    );
  }

  server.registerTool(
    MCP_TOOL_NAMES.shutdownServer,
    {
      title: "Shutdown Server",
      description: "Request a FiveM server shutdown.",
    },
    async () =>
      runTool(
        () => client.shutdown(),
        (result) => result.message,
      ),
  );

  server.registerResource(
    "fivem-status",
    MCP_RESOURCE_URIS.status,
    {
      title: "FiveM Status",
      description: "Current FiveM server status",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href, await client.getStatus()),
  );

  server.registerResource(
    "fivem-players",
    MCP_RESOURCE_URIS.players,
    {
      title: "FiveM Players",
      description: "Online player list",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href, { players: await client.listPlayers() }),
  );

  server.registerResource(
    "fivem-resources",
    MCP_RESOURCE_URIS.resources,
    {
      title: "FiveM Resources",
      description: "Resource list",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href, { resources: await client.listResources() }),
  );

  server.registerResource(
    "fivem-audit",
    MCP_RESOURCE_URIS.auditRecent,
    {
      title: "FiveM Audit Log",
      description: "Recent mutating actions",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href, await client.getAudit()),
  );

  server.registerResource(
    "fivem-resource",
    new ResourceTemplate("fivem://resources/{resourceName}", { list: undefined }),
    {
      title: "FiveM Resource",
      description: "Single FiveM resource by name",
      mimeType: "application/json",
    },
    async (uri, { resourceName }) => {
      const normalizedResourceName = Array.isArray(resourceName)
        ? resourceName[0]
        : resourceName;

      if (!normalizedResourceName) {
        throw new Error("Missing resourceName in resource template.");
      }

      return jsonResource(
        uri.href,
        await client.getResource(normalizedResourceName),
      );
    },
  );

  return server;
}
