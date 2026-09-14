import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app, questionnaireStore } = await createApp(config);
const server = createServer(app);

server.listen(config.port, config.host, () => {
  console.log(`Personal MCP hub listening on http://${config.host}:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close((error) => {
    questionnaireStore.close();
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
