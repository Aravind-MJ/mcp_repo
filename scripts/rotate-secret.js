#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../src/config.js";

const runtimeDir = process.env.MCP_HUB_RUNTIME_DIR || "/data/mcp-hub";
const { secretFile } = loadConfig();
const hermesEnvFile = process.env.MCP_HERMES_ENV_FILE ?? (runtimeDir === "/data/mcp-hub" ? "/data/.env" : "");
const secret = randomBytes(48).toString("base64url");

async function atomicWrite(destination, content) {
  const directory = path.dirname(destination);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${randomBytes(8).toString("hex")}`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, destination);
    await chmod(destination, 0o600);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

await atomicWrite(secretFile, `${secret}\n`);

if (hermesEnvFile) {
  let current = "";
  try {
    current = await readFile(hermesEnvFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const lines = current.split(/\r?\n/).filter((line, index, values) =>
    (line || index < values.length - 1) && !/^\s*MCP_ARTIFACT_API_KEY\s*=/.test(line)
  );
  const credentialName = "MCP_ARAVIND_HTML_PUBLISHER_API_KEY";
  const assignment = `${credentialName}=${secret}`;
  const existingIndex = lines.findIndex((line) => new RegExp(`^\\s*${credentialName}\\s*=`).test(line));
  if (existingIndex >= 0) lines[existingIndex] = assignment;
  else lines.push(assignment);
  await atomicWrite(hermesEnvFile, `${lines.filter(Boolean).join("\n")}\n`);
}

console.log(`Rotated the shared MCP secret at ${secretFile}${hermesEnvFile ? " and synchronized Hermes' protected MCP credential" : ""}; the value was not printed.`);
