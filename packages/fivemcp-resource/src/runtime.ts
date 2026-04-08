import type { Player, Resource, StatusResponse } from "@fivemcp/shared";

import {
  DEFAULT_ANNOUNCEMENT_TEMPLATE,
  FIVEMCP_ANNOUNCEMENT_TEMPLATE_CONVAR,
  FIVEMCP_RESOURCE_NAME,
  FIVEMCP_TOKEN_CONVAR,
} from "@fivemcp/shared";

export interface FiveMRuntime {
  getToken(): string;
  getAnnouncementTemplate(): string;
  getStatus(): StatusResponse;
  listPlayers(): Player[];
  findPlayer(serverId: number): Player | null;
  listResources(): Resource[];
  findResource(resourceName: string): Resource | null;
  executeCommand(command: string): void;
  nowIso(): string;
  randomId(): string;
}

function readMetadata(
  resourceName: string,
  key: string,
): string | null {
  const value = GetResourceMetadata(resourceName, key, 0);
  return typeof value === "string" ? value : null;
}

function safeParseInt(value: string, fallback = 0): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapPlayer(serverIdRaw: string): Player {
  const serverId = safeParseInt(serverIdRaw);
  return {
    serverId,
    name: GetPlayerName(serverIdRaw) ?? `Player ${serverId}`,
    ping: GetPlayerPing(serverIdRaw),
    identifiers: getPlayerIdentifiers(serverIdRaw),
  };
}

function mapResource(resourceName: string): Resource {
  return {
    name: resourceName,
    state: GetResourceState(resourceName),
    author: readMetadata(resourceName, "author"),
    version: readMetadata(resourceName, "version"),
    description: readMetadata(resourceName, "description"),
    path: GetResourcePath(resourceName) ?? null,
  };
}

export function createDefaultRuntime(): FiveMRuntime {
  return {
    getToken() {
      return GetConvar(FIVEMCP_TOKEN_CONVAR, "").trim();
    },
    getAnnouncementTemplate() {
      return GetConvar(
        FIVEMCP_ANNOUNCEMENT_TEMPLATE_CONVAR,
        DEFAULT_ANNOUNCEMENT_TEMPLATE,
      ).trim();
    },
    getStatus() {
      const resourceName = GetCurrentResourceName() || FIVEMCP_RESOURCE_NAME;
      const players = getPlayers();

      return {
        resourceName,
        resourceVersion: readMetadata(resourceName, "version") ?? "0.1.0",
        serverName: GetConvar("sv_projectName", "FiveM Server"),
        hostname: GetConvar("sv_hostname", "FiveM Server"),
        playerCount: players.length,
        maxClients: safeParseInt(GetConvar("sv_maxclients", "0")),
        capabilities: {
          canStartServer: false,
          canRestartServer: false,
          canShutdownServer: true,
        },
      };
    },
    listPlayers() {
      return getPlayers().map(mapPlayer);
    },
    findPlayer(serverId) {
      const playerId = String(serverId);
      if (!getPlayers().includes(playerId)) {
        return null;
      }

      return mapPlayer(playerId);
    },
    listResources() {
      const resources: Resource[] = [];
      const count = GetNumResources();
      for (let index = 0; index < count; index += 1) {
        const resourceName = GetResourceByFindIndex(index);
        if (typeof resourceName === "string" && resourceName.length > 0) {
          resources.push(mapResource(resourceName));
        }
      }
      return resources;
    },
    findResource(resourceName) {
      const state = GetResourceState(resourceName);
      if (state === "missing" || state.length === 0) {
        return null;
      }
      return mapResource(resourceName);
    },
    executeCommand(command) {
      ExecuteCommand(command);
    },
    nowIso() {
      return new Date().toISOString();
    },
    randomId() {
      return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    },
  };
}
