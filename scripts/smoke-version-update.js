#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "../src/config.js";

const workingFile = process.argv[2];
if (!workingFile) throw new Error("Usage: smoke-version-update.js <working-html-file>");
const config = loadConfig();
const secret = (await readFile(config.secretFile, "utf8")).trim();
const client = new Client({ name: "artifact-version-smoke", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(`${config.publicBaseUrl}/artifact/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${secret}` } },
});

let artifactId;
try {
  await client.connect(transport);
  const versionOneHtml = await readFile(workingFile, "utf8");
  const published = await client.callTool({
    name: "publish_html",
    arguments: { html: versionOneHtml, title: "Disposable version workflow smoke test" },
  });
  const first = published.structuredContent;
  artifactId = first?.artifact_id;
  if (!/^[A-Za-z0-9]{24}$/.test(artifactId || "") || first.version !== 1) {
    throw new Error("Initial publish did not return a clean version-1 artifact");
  }

  const versionTwoHtml = versionOneHtml.replace("Version one", "Version two").replace(
    "stable URL updates.",
    "stable URL updates and immutable snapshots.",
  );
  await writeFile(workingFile, versionTwoHtml, "utf8");
  const updatedHtml = await readFile(workingFile, "utf8");
  const updated = await client.callTool({
    name: "update_artifact",
    arguments: { artifact_id: artifactId, html: updatedHtml, title: "Disposable version workflow smoke test" },
  });
  const second = updated.structuredContent;
  if (second.artifact_id !== artifactId || second.canonical_url !== first.canonical_url || second.version !== 2) {
    throw new Error("Update did not preserve the stable artifact identity while incrementing version");
  }

  const [latest, versionOne, versionTwo] = await Promise.all([
    fetch(first.url),
    fetch(first.version_url),
    fetch(second.version_url),
  ]);
  if (!latest.ok || !versionOne.ok || !versionTwo.ok) throw new Error("One or more public version URLs failed");
  if ((await latest.text()) !== updatedHtml) throw new Error("Stable URL does not show version 2");
  if ((await versionOne.text()) !== versionOneHtml) throw new Error("Version 1 snapshot changed");
  if ((await versionTwo.text()) !== updatedHtml) throw new Error("Version 2 snapshot mismatch");

  process.stdout.write(`${JSON.stringify({ artifact_id: artifactId, url: second.url, version: second.version })}\n`);
} finally {
  if (artifactId) {
    await client.callTool({ name: "delete_artifact", arguments: { artifact_id: artifactId } }).catch(() => {});
  }
  await client.close();
}
