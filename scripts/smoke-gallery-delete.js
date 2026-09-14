#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "../src/config.js";

const config = loadConfig();
const secret = (await readFile(config.secretFile, "utf8")).trim();
const origin = `http://${config.host}:${config.port}`;
const client = new Client({ name: "gallery-delete-smoke", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(`${origin}/artifact/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${secret}` } },
});

let artifactId;
let signedUrl;
try {
  await client.connect(transport);
  const published = await client.callTool({
    name: "publish_html",
    arguments: {
      title: "Disposable gallery deletion smoke test",
      html: "<!doctype html><title>Disposable test</title><h1>Delete me</h1>",
    },
  });
  artifactId = published.structuredContent?.artifact_id;
  signedUrl = published.structuredContent?.url;
  if (!/^[A-Za-z0-9]{24}$/.test(artifactId || "")) throw new Error("Publish did not return an alphanumeric artifact ID");
  if (!signedUrl || !(await fetch(signedUrl)).ok) throw new Error("Publish did not return a working signed URL");
} finally {
  await client.close();
}

const gallery = await (await fetch(`${origin}/artifacts`)).text();
const tokenPattern = new RegExp(
  `action="/artifacts/${artifactId}/delete"[\\s\\S]*?name="csrf_token" value="([a-f0-9]{64})"`,
);
const csrfToken = gallery.match(tokenPattern)?.[1];
if (!csrfToken) throw new Error("Gallery did not provide a confirmation token");

const deletion = await fetch(`${origin}/artifacts/${artifactId}/delete`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ csrf_token: csrfToken }),
  redirect: "manual",
});
if (deletion.status !== 303) throw new Error(`Expected deletion redirect, got ${deletion.status}`);
if (deletion.headers.get("location") !== "/artifacts") throw new Error("Deletion did not redirect to the clean gallery URL");
const flashCookie = deletion.headers.get("set-cookie");
if (!flashCookie?.startsWith("artifact_gallery_flash=")) throw new Error("Deletion did not set a flash cookie");

const publicResponse = await fetch(signedUrl);
if (publicResponse.status !== 404) throw new Error(`Deleted artifact still returned ${publicResponse.status}`);

const flashResponse = await fetch(`${origin}/artifacts`, {
  headers: { cookie: flashCookie.split(";", 1)[0] },
});
const flashHtml = await flashResponse.text();
if (!flashHtml.includes(`Deleted artifact <code>${artifactId}</code>`)) throw new Error("One-time deletion message was not shown");
if (!flashResponse.headers.get("set-cookie")?.includes("Max-Age=0")) throw new Error("Flash cookie was not cleared");
if ((await (await fetch(`${origin}/artifacts`)).text()).includes("Deleted artifact <code>")) {
  throw new Error("Deletion message persisted on gallery reload");
}

process.stdout.write(`Gallery deletion and one-time flash smoke test passed for disposable artifact ${artifactId}.\n`);
