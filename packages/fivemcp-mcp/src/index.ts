import { createServer } from "node:http";

import { createHttpApp } from "./app";
import { readConfig } from "./config";

const config = readConfig();
const app = createHttpApp(config);
const server = createServer(app);

server.listen(config.port, config.host, () => {
  console.log(
    `[fivemcp-mcp] listening on http://${config.host}:${config.port}/mcp`,
  );
});
