#!/usr/bin/env node
import { constants } from "node:fs";
import { access, chmod, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const runtimeDir = process.env.MCP_HUB_RUNTIME_DIR || "/data/mcp-hub";
const app = `${runtimeDir}/app/src/index.js`;
const secret = process.env.MCP_SHARED_SECRET_FILE || `${runtimeDir}/secrets/shared-secret`;
const pidFile = `${runtimeDir}/run/service.pid`;
const logFile = `${runtimeDir}/logs/service.log`;
const healthUrl = `http://${process.env.MCP_HUB_HOST || "127.0.0.1"}:${process.env.MCP_HUB_PORT || "4330"}/healthz`;

async function healthy() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
    const body = await response.json();
    return response.ok && body.status === "ok" && body.modules?.includes("artifact") && body.modules?.includes("questionnaire");
  } catch {
    return false;
  }
}

if (await healthy()) process.exit(0);
await Promise.all([access(app, constants.R_OK), access(secret, constants.R_OK)]).catch(() => {
  console.error("MCP hub watchdog: deployed app or shared secret is missing");
  process.exit(1);
});

await mkdir(`${runtimeDir}/run`, { recursive: true, mode: 0o700 });
await mkdir(`${runtimeDir}/logs`, { recursive: true, mode: 0o700 });
let oldPid;
try {
  oldPid = Number.parseInt((await readFile(pidFile, "utf8")).trim(), 10);
  process.kill(oldPid, 0);
  console.error(`MCP hub watchdog: process ${oldPid} exists but health check failed`);
  process.exit(1);
} catch (error) {
  if (error?.code !== "ESRCH" && oldPid) throw error;
  await rm(pidFile, { force: true });
}

const log = await open(logFile, "a", 0o600);
const child = spawn(process.execPath, [app], {
  cwd: `${runtimeDir}/app`,
  detached: true,
  env: { ...process.env, MCP_HUB_RUNTIME_DIR: runtimeDir },
  stdio: ["ignore", log.fd, log.fd],
});
child.unref();
await writeFile(pidFile, `${child.pid}\n`, { mode: 0o600 });
await chmod(pidFile, 0o600);
await log.close();

for (let attempt = 0; attempt < 25; attempt += 1) {
  if (await healthy()) process.exit(0);
  try {
    process.kill(child.pid, 0);
  } catch {
    console.error("MCP hub watchdog: service exited before becoming healthy");
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
console.error("MCP hub watchdog: service did not become healthy");
process.exit(1);
