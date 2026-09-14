#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "../src/config.js";

const config = loadConfig();
const secret = (await readFile(config.secretFile, "utf8")).trim();
const endpoint = new URL(process.env.ARTIFACT_MCP_URL || `${config.publicBaseUrl}/artifact/mcp`);
const client = new Client({ name: "artifact-smoke-publisher", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(endpoint, {
  requestInit: { headers: { Authorization: `Bearer ${secret}` } },
});

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Artifact MCP is live</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 20% 10%,#29337a 0,transparent 38%),#080b16;color:#f7f8ff;font:16px/1.6 system-ui,sans-serif}.card{width:min(680px,calc(100% - 32px));padding:clamp(28px,7vw,64px);border:1px solid #ffffff24;border-radius:28px;background:#11162bcc;box-shadow:0 30px 90px #0009;backdrop-filter:blur(18px)}.eyebrow{color:#9eaaff;text-transform:uppercase;letter-spacing:.16em;font-size:.75rem;font-weight:800}h1{font-size:clamp(2.4rem,8vw,5.5rem);line-height:.94;letter-spacing:-.065em;margin:.35em 0}.status{display:flex;align-items:center;gap:.7rem;margin-top:2rem;color:#cdd3ff}.dot{width:.8rem;height:.8rem;border-radius:50%;background:#65f2a7;box-shadow:0 0 22px #65f2a7}
</style>
</head>
<body><main class="card"><div class="eyebrow">Personal MCP Hub · Artifact</div><h1>Publishing is live.</h1><p>This page was uploaded through the authenticated <strong>publish_html</strong> MCP tool and is being served from its opaque public URL.</p><div class="status"><span class="dot"></span>Node service, shared-secret auth, and public delivery verified</div></main></body>
</html>`;

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: "publish_html",
    arguments: { html, title: "Artifact MCP deployment verification" },
  });
  if (result.isError || !result.structuredContent?.url) {
    throw new Error(result.content?.[0]?.text || "Artifact publish failed");
  }
  process.stdout.write(`${JSON.stringify(result.structuredContent)}\n`);
} finally {
  await client.close();
}
