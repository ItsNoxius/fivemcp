# FiveM MCP

`fivem-mcp` is a two-part local control plane for FiveM:

- A FiveM server resource named `fivemcp` that exposes a localhost-only HTTP API.
- A separate MCP server that translates MCP tool/resource calls into requests against that HTTP API.

This project is intentionally scoped to an already-running FXServer instance. It does not cold-start FXServer and does not depend on txAdmin.

## What It Supports

- Server status
- Online player listing and lookup
- Resource listing and lookup
- Broadcast messages
- Resource `start`, `stop`, `restart`, `ensure`, and `refresh`
- Server shutdown
- Recent in-memory audit log for mutating actions

## Project Layout

- [packages/shared](C:/Users/dg2c4/Desktop/fivem-mcp/packages/shared): shared schemas, constants, and DTOs
- [packages/fivemcp-resource](C:/Users/dg2c4/Desktop/fivem-mcp/packages/fivemcp-resource): FiveM resource
- [packages/fivemcp-mcp](C:/Users/dg2c4/Desktop/fivem-mcp/packages/fivemcp-mcp): MCP server

## Prerequisites

- Node.js 22+
- npm 11+
- A FiveM server where you can load a custom server resource

## Install

From the repo root:

```powershell
npm install
```

You can also copy [.env.example](C:/Users/dg2c4/Desktop/fivem-mcp/.env.example) to `.env` for the standalone MCP server:

```powershell
Copy-Item .env.example .env
```

## Build

Build everything:

```powershell
npm run build
```

Build only the FiveM resource:

```powershell
npm run build:resource
```

Run tests:

```powershell
npm run test
```

## Quick Start

This is the shortest path to get both programs running.

### 1. Install dependencies

```powershell
npm install
```

### 2. Build the project

```powershell
npm run build
```

### 3. Install the FiveM resource into your server

Copy [packages/fivemcp-resource](C:/Users/dg2c4/Desktop/fivem-mcp/packages/fivemcp-resource) into your FiveM server's `resources` directory so the final resource folder is named `fivemcp`.

Example target:

```text
<your-fivem-server>/resources/fivemcp
```

That folder must contain at least:

- `fxmanifest.lua`
- `dist/server.js`

### 4. Configure and run the FiveM resource

Add this to your server config:

```cfg
setr fivemcp_token "replace-with-a-long-random-secret"
setr fivemcp_announcement_command_template "say [MCP] {message}"

ensure fivemcp
```

Then start your FiveM server normally. Once the server is running, the local backend API will be available at:

```text
http://127.0.0.1:30120/fivemcp/v1
```

### 5. Run the MCP server

Create a root `.env` file or set environment variables manually.

Example `.env`:

```dotenv
FIVEMCP_BASE_URL=http://127.0.0.1:30120/fivemcp/v1
FIVEMCP_TOKEN=replace-with-the-same-secret
MCP_HOST=127.0.0.1
MCP_PORT=3001
FIVEMCP_TIMEOUT_MS=5000
```

Then run the MCP server in a separate terminal.

If you publish the package to npm, the intended CLI entrypoint is:

```powershell
npx fivemcp
```

Using `.env`:

```powershell
npm run dev:mcp
```

Or with explicit environment variables:

```powershell
$env:FIVEMCP_TOKEN="replace-with-the-same-secret"
npm run dev:mcp
```

Or run the built version:

```powershell
$env:FIVEMCP_TOKEN="replace-with-the-same-secret"
node packages/fivemcp-mcp/dist/index.js
```

Or, from the package directory after building:

```powershell
npm exec --workspace fivemcp fivemcp
```

The MCP endpoint will be:

```text
http://127.0.0.1:3001/mcp
```

### 6. Point your MCP client at the server

Your MCP client should connect to the Streamable HTTP endpoint above. If you set `MCP_AUTH_TOKEN`, the client must also send:

```http
X-FiveMCP-MCP-Token: <MCP_AUTH_TOKEN>
```

## FiveM Resource Setup

The FiveM resource is [packages/fivemcp-resource](C:/Users/dg2c4/Desktop/fivem-mcp/packages/fivemcp-resource).

You need the built `dist/server.js` file plus `fxmanifest.lua` inside your server resource directory. The resource name must remain `fivemcp`, because the HTTP API is exposed under:

```text
http://127.0.0.1:30120/fivemcp/v1
```

### Example Server Config

Add these to your FiveM config:

```cfg
setr fivemcp_token "replace-with-a-long-random-secret"
setr fivemcp_announcement_command_template "say [MCP] {message}"

ensure fivemcp
```

### Notes

- `fivemcp_token` is required. Requests without a matching authorization token are rejected.
- Backend requests must send the token in the `X-FiveMCP-Token` header.
- The resource only accepts loopback callers:
  - `127.0.0.1`
  - `::1`
  - `::ffff:127.0.0.1`
- `fivemcp_announcement_command_template` defaults to `say [MCP] {message}` if omitted.

## MCP Server Setup

The MCP server is in [packages/fivemcp-mcp](C:/Users/dg2c4/Desktop/fivem-mcp/packages/fivemcp-mcp).

Its package name is `fivemcp`, and it now exposes a CLI bin with the same name for `npx fivemcp`.

### Environment Variables

- These values may be provided through a root `.env` file.
- `FIVEMCP_BASE_URL`
  - Default: `http://127.0.0.1:30120/fivemcp/v1`
- `FIVEMCP_TOKEN`
  - Required in practice. Must match `setr fivemcp_token`.
- `MCP_HOST`
  - Default: `127.0.0.1`
- `MCP_PORT`
  - Default: `3001`
- `FIVEMCP_TIMEOUT_MS`
  - Default: `5000`
- `MCP_AUTH_TOKEN`
  - Optional. If set, callers must send `X-FiveMCP-MCP-Token: <token>` to `/mcp`.

### Run In Dev

If a root `.env` file exists, the MCP server loads it automatically.

```powershell
npm run dev:mcp
```

### Run Via `npx`

Once the package is published to npm, this starts the MCP server:

```powershell
npx fivemcp
```

### Run Built Server

If a root `.env` file exists, the MCP server loads it automatically.

```powershell
node packages/fivemcp-mcp/dist/index.js
```

The MCP endpoint will be:

```text
http://127.0.0.1:3001/mcp
```

Note: `.env` support applies to the standalone MCP server only. The FiveM resource still reads its settings from your FiveM server config via `setr`.

## HTTP API

All backend routes require:

```http
X-FiveMCP-Token: <fivemcp_token>
```

### Read Routes

- `GET /v1/status`
- `GET /v1/players`
- `GET /v1/players/:serverId`
- `GET /v1/resources`
- `GET /v1/resources/:resourceName`
- `GET /v1/audit?limit=<n>`

### Write Routes

- `POST /v1/server/announce`
- `POST /v1/server/shutdown`
- `POST /v1/resources/refresh`
- `POST /v1/resources/:resourceName/start`
- `POST /v1/resources/:resourceName/stop`
- `POST /v1/resources/:resourceName/restart`
- `POST /v1/resources/:resourceName/ensure`

### Request Bodies

- `POST /v1/server/announce`

```json
{
  "message": "Server restart in 5 minutes"
}
```

- All other `POST` routes currently expect an empty JSON object:

```json
{}
```

### Example `curl`

```powershell
curl `
  -H "X-FiveMCP-Token: replace-with-secret" `
  http://127.0.0.1:30120/fivemcp/v1/status
```

```powershell
curl `
  -X POST `
  -H "X-FiveMCP-Token: replace-with-secret" `
  -H "Content-Type: application/json" `
  -d "{\"message\":\"Hello from MCP\"}" `
  http://127.0.0.1:30120/fivemcp/v1/server/announce
```

## MCP Tools

The MCP server exposes these tools:

- `fivem_get_status`
  Returns current server status, player count, max clients, resource version, and lifecycle capability flags.
- `fivem_list_players`
  Returns the list of currently connected players.
  No arguments.
- `fivem_get_player`
  Returns a single online player by server ID.
  Arguments:
  ```json
  {
    "serverId": 7
  }
  ```
- `fivem_list_resources`
  Returns all detected FiveM resources and their current states.
  No arguments.
- `fivem_get_resource`
  Returns a single resource by name.
  Arguments:
  ```json
  {
    "resourceName": "fivemcp"
  }
  ```
- `fivem_broadcast_message`
  Sends a broadcast using the configured announcement command template.
  Arguments:
  ```json
  {
    "message": "Server restart in 5 minutes"
  }
  ```
- `fivem_refresh_resources`
  Executes the FiveM `refresh` command.
  No arguments.
- `fivem_start_resource`
  Executes `start <resourceName>`.
  Arguments:
  ```json
  {
    "resourceName": "my_resource"
  }
  ```
- `fivem_stop_resource`
  Executes `stop <resourceName>`.
  Arguments:
  ```json
  {
    "resourceName": "my_resource"
  }
  ```
- `fivem_restart_resource`
  Executes `restart <resourceName>`.
  Arguments:
  ```json
  {
    "resourceName": "my_resource"
  }
  ```
- `fivem_ensure_resource`
  Executes `ensure <resourceName>`.
  Arguments:
  ```json
  {
    "resourceName": "my_resource"
  }
  ```
- `fivem_shutdown_server`
  Executes `quit "fivemcp shutdown requested"`.
  No arguments.

Read-only MCP tools return both text output and structured JSON content. Mutating tools return an action result and include backend error details as MCP `isError: true` results when the backend rejects the call.

## MCP Resources

The MCP server also exposes these read resources:

- `fivem://status`
  JSON snapshot of current server status.
- `fivem://players`
  JSON list of online players.
- `fivem://resources`
  JSON list of resources and their current states.
- `fivem://resources/{resourceName}`
  JSON for a single resource, for example `fivem://resources/fivemcp`.
- `fivem://audit/recent`
  JSON view of the recent in-memory audit log for mutating actions.

## Transport Details

- Transport: Streamable HTTP
- Mode: stateless
- JSON response mode: enabled
- Path: `POST /mcp`

The MCP SDK requires the client to send an `Accept` header that includes both:

- `application/json`
- `text/event-stream`

## Current Limitations

- No cold start of FXServer
- No guaranteed whole-server restart while the resource is unavailable
- No raw arbitrary console command tool
- No txAdmin integration
- No ban, warn, whitelist, or historical player management
- Audit log is in-memory only

## Development Notes

- Shared contracts are defined in [packages/shared/src/schemas.ts](C:/Users/dg2c4/Desktop/fivem-mcp/packages/shared/src/schemas.ts).
- The FiveM resource entrypoint is [packages/fivemcp-resource/src/server.ts](C:/Users/dg2c4/Desktop/fivem-mcp/packages/fivemcp-resource/src/server.ts).
- The MCP HTTP server entrypoint is [packages/fivemcp-mcp/src/index.ts](C:/Users/dg2c4/Desktop/fivem-mcp/packages/fivemcp-mcp/src/index.ts).

## Verified Commands

These passed in this workspace:

```powershell
npm run typecheck
npm run build
npm run test
```
