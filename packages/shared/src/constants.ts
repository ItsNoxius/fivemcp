export const FIVEMCP_RESOURCE_NAME = "fivemcp";
export const FIVEMCP_API_VERSION = "v1";
export const FIVEMCP_RESOURCE_BASE_PATH = `/${FIVEMCP_API_VERSION}`;
export const FIVEMCP_EXTERNAL_BASE_URL = `http://127.0.0.1:30120/${FIVEMCP_RESOURCE_NAME}/${FIVEMCP_API_VERSION}`;
export const FIVEMCP_TOKEN_HEADER = "x-fivemcp-token";
export const FIVEMCP_MCP_TOKEN_HEADER = "x-fivemcp-mcp-token";

export const FIVEMCP_TOKEN_CONVAR = "fivemcp_token";
export const FIVEMCP_ANNOUNCEMENT_TEMPLATE_CONVAR =
  "fivemcp_announcement_command_template";

export const DEFAULT_ANNOUNCEMENT_TEMPLATE = "say [MCP] {message}";
export const DEFAULT_AUDIT_LIMIT = 25;
export const MAX_AUDIT_LIMIT = 100;
export const AUDIT_RING_BUFFER_SIZE = 250;

export const LOOPBACK_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

export const MCP_RESOURCE_URIS = {
  status: "fivem://status",
  players: "fivem://players",
  resources: "fivem://resources",
  auditRecent: "fivem://audit/recent",
  resource: (resourceName: string) => `fivem://resources/${resourceName}`,
} as const;

export const MCP_TOOL_NAMES = {
  getStatus: "fivem_get_status",
  listPlayers: "fivem_list_players",
  getPlayer: "fivem_get_player",
  listResources: "fivem_list_resources",
  getResource: "fivem_get_resource",
  broadcastMessage: "fivem_broadcast_message",
  refreshResources: "fivem_refresh_resources",
  startResource: "fivem_start_resource",
  stopResource: "fivem_stop_resource",
  restartResource: "fivem_restart_resource",
  ensureResource: "fivem_ensure_resource",
  shutdownServer: "fivem_shutdown_server",
} as const;
