import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { FIVEMCP_EXTERNAL_BASE_URL } from "@fivemcp/shared";

const moduleDir = dirname(fileURLToPath(import.meta.url));
loadDotenv();
loadDotenv({
  path: resolve(moduleDir, "../../../.env"),
  override: false,
});

export interface McpConfig {
  backendBaseUrl: string;
  backendToken: string;
  host: string;
  port: number;
  timeoutMs: number;
  mcpAuthToken?: string;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  return {
    backendBaseUrl: (env.FIVEMCP_BASE_URL ?? FIVEMCP_EXTERNAL_BASE_URL).replace(
      /\/$/,
      "",
    ),
    backendToken: env.FIVEMCP_TOKEN ?? "",
    host: env.MCP_HOST ?? "127.0.0.1",
    port: parsePositiveInt(env.MCP_PORT, 3001),
    timeoutMs: parsePositiveInt(env.FIVEMCP_TIMEOUT_MS, 5000),
    mcpAuthToken: env.MCP_AUTH_TOKEN?.trim() || undefined,
  };
}
