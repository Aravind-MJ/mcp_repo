import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";
import { generateArtifactId } from "../src/artifact/store.js";
import { createArtifactSignedUrl } from "../src/security.js";

let root;
let secretFile;
let secret;
let server;
let baseUrl;
let config;
let store;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mcp-hub-test-"));
  secret = "s".repeat(64);
  secretFile = path.join(root, "secrets", "shared-secret");
  await mkdir(path.dirname(secretFile), { recursive: true });
  await writeFile(secretFile, secret, { mode: 0o600 });
  config = {
    host: "127.0.0.1",
    port: 0,
    dataDir: path.join(root, "data"),
    secretFile,
    publicBaseUrl: "https://mcp.example.test",
    maxHtmlBytes: 1024,
    maxListItems: 200,
    allowedHosts: ["127.0.0.1", "localhost"],
  };
  const created = await createApp(config);
  const { app } = created;
  store = created.store;
  server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

async function mcpClient(authSecret = secret) {
  const client = new Client({ name: "artifact-tests", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/artifact/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${authSecret}` } },
  });
  await client.connect(transport);
  return client;
}

test("generates opaque IDs using alphanumeric characters only", () => {
  const ids = new Set(Array.from({ length: 1000 }, () => generateArtifactId()));
  assert.equal(ids.size, 1000);
  for (const artifactId of ids) assert.match(artifactId, /^[A-Za-z0-9]{24}$/);
});

test("hub and artifact landing do not expose an index", async () => {
  const hub = await fetch(`${baseUrl}/`);
  assert.equal(hub.status, 200);
  const hubHtml = await hub.text();
  assert.match(hubHtml, /data-mcp-entry="artifact"/);
  assert.match(hubHtml, /data-mcp-entry="questionnaire"/);
  assert.match(hubHtml, /<link rel="icon" href="\/hub\.svg"/);
  assert.match(hubHtml, /<img src="\/hub\.svg"/);
  assert.match(hub.headers.get("content-security-policy"), /frame-ancestors 'none'/);

  const artifact = await fetch(`${baseUrl}/artifact`);
  assert.equal(artifact.status, 200);
  const artifactHtml = await artifact.text();
  assert.match(artifactHtml, /HTML Artifact Publisher/);
  assert.match(artifactHtml, /Bearer authentication required/);
  assert.match(artifactHtml, /Read installation guide/);
  assert.doesNotMatch(artifactHtml, /href="\/artifacts/);

  const logo = await fetch(`${baseUrl}/logo.svg`);
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get("content-type"), /^image\/svg\+xml/);
  assert.match(await logo.text(), /Aravind HTML Publisher/);

  const favicon = await fetch(`${baseUrl}/favicon.svg`);
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get("content-type"), /^image\/svg\+xml/);
  assert.match(await favicon.text(), /<svg/);

  const hubMark = await fetch(`${baseUrl}/hub.svg`);
  assert.equal(hubMark.status, 200);
  assert.match(hubMark.headers.get("content-type"), /^image\/svg\+xml/);
  assert.match(await hubMark.text(), /Personal MCP Hub/);

  const questionnaireMark = await fetch(`${baseUrl}/questionnaire.svg`);
  assert.equal(questionnaireMark.status, 200);
  assert.match(questionnaireMark.headers.get("content-type"), /^image\/svg\+xml/);
  assert.match(await questionnaireMark.text(), /Questionnaire Collector/);
});

test("renders the artifact gallery with sandboxed previews and escaped metadata", async () => {
  const client = await mcpClient();
  let metadata;
  try {
    metadata = (await client.callTool({
      name: "publish_html",
      arguments: { html: "<h1>Gallery item</h1>", title: '<script>alert("title")</script>' },
    })).structuredContent;
  } finally {
    await client.close();
  }

  const response = await fetch(`${baseUrl}/artifacts`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("content-security-policy"), /frame-src 'self'/);
  const gallery = await response.text();
  assert.match(gallery, /Artifact Gallery/);
  assert.match(gallery, /<link rel="icon" href="\/favicon\.svg"/);
  assert.match(gallery, /<div class="brand"><img src="\/logo\.svg"/);
  assert.match(response.headers.get("content-security-policy"), /img-src 'self'/);
  assert.match(gallery, new RegExp(`<a class="preview" href="[^"]*/artifact/${metadata.artifact_id}[^\"]*" target="_blank" rel="noopener noreferrer"`));
  assert.match(gallery, new RegExp(`<h2><a href="[^"]*/artifact/${metadata.artifact_id}[^\"]*" target="_blank" rel="noopener noreferrer"`));
  assert.match(gallery, new RegExp(`<a href="[^"]*/artifact/${metadata.artifact_id}/versions/1[^\"]*" target="_blank" rel="noopener noreferrer">Version 1</a>`));
  assert.match(gallery, /<iframe[^>]+sandbox=""/);
  assert.match(gallery, new RegExp(`<button[^>]+class="share-button"[^>]+data-sign-artifact="${metadata.artifact_id}"`));
  assert.match(gallery, /Copy 1-week link/);
  assert.match(gallery, /navigator\.clipboard\.writeText/);
  assert.match(gallery, new RegExp(`<button[^>]+class="delete-button"[^>]+data-delete-dialog="delete-${metadata.artifact_id}"`));
  assert.match(gallery, /<svg[^>]+class="trash-icon"[^>]+aria-hidden="true"/);
  assert.match(gallery, new RegExp(`<dialog[^>]+id="delete-${metadata.artifact_id}"[^>]+class="delete-dialog"`));
  assert.match(gallery, new RegExp(`action="/artifacts/${metadata.artifact_id}/delete"`));
  assert.match(gallery, /Permanently delete this artifact\?/);
  assert.match(gallery, /<button type="button" class="cancel-delete">Cancel<\/button>/);
  assert.match(gallery, /<button type="submit" class="confirm-delete" form="delete-form-[A-Za-z0-9]{24}">Delete artifact<\/button>/);
  assert.match(gallery, /name="csrf_token" value="[a-f0-9]{64}"/);
  assert.match(gallery, /\.card:hover \.delete-button/);
  assert.match(gallery, /deleteDialog\.showModal\(\)/);
  assert.match(gallery, /&lt;script&gt;alert\(&quot;title&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(gallery, /<script>alert\("title"\)<\/script>/);

  const signToken = gallery.match(
    new RegExp(`data-sign-artifact="${metadata.artifact_id}"[^>]+data-csrf-token="([a-f0-9]{64})"`),
  )?.[1];
  const signedResponse = await fetch(`${baseUrl}/artifacts/${metadata.artifact_id}/sign`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf_token: signToken }),
  });
  assert.equal(signedResponse.status, 200);
  const signed = await signedResponse.json();
  assert.match(signed.url, new RegExp(`/artifact/${metadata.artifact_id}\\?expires=\\d+&signature=[a-f0-9]{64}$`));
  assert.equal(signed.expires_in_seconds, 604800);
  assert.equal((await fetch(signed.url.replace(config.publicBaseUrl, baseUrl))).status, 200);
});

test("signed artifact links enforce signatures while trusted Basic Auth can view unsigned paths", async () => {
  const metadata = await store.publish("<h1>Signed</h1>", "Signed artifact");
  const rawUrl = `${baseUrl}/artifact/${metadata.artifact_id}`;
  assert.equal((await fetch(rawUrl)).status, 404);
  assert.equal((await fetch(rawUrl, { headers: { "x-artifact-basic-auth": "1" } })).status, 200);

  const signed = await createArtifactSignedUrl({
    artifactId: metadata.artifact_id,
    publicBaseUrl: baseUrl,
    secretFile,
    expiresInSeconds: 604800,
  });
  assert.equal(signed.expires_in_seconds, 604800);
  const signedResponse = await fetch(signed.url);
  assert.equal(signedResponse.status, 200);
  assert.match(signedResponse.headers.get("x-robots-tag"), /noindex/);

  const tampered = new URL(signed.url);
  tampered.searchParams.set("signature", "0".repeat(64));
  assert.equal((await fetch(tampered)).status, 404);

  const expired = await createArtifactSignedUrl({
    artifactId: metadata.artifact_id,
    publicBaseUrl: baseUrl,
    secretFile,
    expiresInSeconds: 60,
    nowSeconds: Math.floor(Date.now() / 1000) - 120,
  });
  assert.equal((await fetch(expired.url)).status, 404);
});

test("gallery deletion requires its confirmation token and redirects after deleting", async () => {
  const client = await mcpClient();
  let metadata;
  try {
    metadata = (await client.callTool({
      name: "publish_html",
      arguments: { html: "<h1>Delete me</h1>", title: "Deletion target" },
    })).structuredContent;
  } finally {
    await client.close();
  }

  const gallery = await (await fetch(`${baseUrl}/artifacts`)).text();
  const formPattern = new RegExp(
    `action="/artifacts/${metadata.artifact_id}/delete"[\\s\\S]*?name="csrf_token" value="([a-f0-9]{64})"`,
  );
  const token = gallery.match(formPattern)?.[1];
  assert.match(token, /^[a-f0-9]{64}$/);

  const rejected = await fetch(`${baseUrl}/artifacts/${metadata.artifact_id}/delete`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "csrf_token=wrong",
    redirect: "manual",
  });
  assert.equal(rejected.status, 403);
  assert.equal((await store.read(metadata.artifact_id)).metadata.artifact_id, metadata.artifact_id);

  const deleted = await fetch(`${baseUrl}/artifacts/${metadata.artifact_id}/delete`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf_token: token }),
    redirect: "manual",
  });
  assert.equal(deleted.status, 303);
  assert.equal(deleted.headers.get("location"), "/artifacts");
  const flashCookie = deleted.headers.get("set-cookie");
  assert.match(flashCookie, /^artifact_gallery_flash=/);
  assert.match(flashCookie, /HttpOnly/i);
  assert.match(flashCookie, /SameSite=Strict/i);
  await assert.rejects(() => store.read(metadata.artifact_id), /Artifact not found/);

  const confirmationResponse = await fetch(`${baseUrl}/artifacts`, {
    headers: { cookie: flashCookie.split(";", 1)[0] },
  });
  const confirmation = await confirmationResponse.text();
  assert.match(confirmation, new RegExp(`Deleted artifact <code>${metadata.artifact_id}</code>`));
  assert.match(confirmationResponse.headers.get("set-cookie"), /artifact_gallery_flash=;/);
  assert.match(confirmationResponse.headers.get("set-cookie"), /Max-Age=0/i);

  const reload = await (await fetch(`${baseUrl}/artifacts`)).text();
  assert.doesNotMatch(reload, /Deleted artifact <code>/);

  const forgedQuery = await (await fetch(`${baseUrl}/artifacts?deleted=${metadata.artifact_id}`)).text();
  assert.doesNotMatch(forgedQuery, /Deleted artifact <code>/);
});

test("serves a public secret-free install guide and companion skill", async () => {
  const readme = await fetch(`${baseUrl}/artifact/README.md`);
  assert.equal(readme.status, 200);
  assert.match(readme.headers.get("content-type"), /^text\/markdown/);
  const readmeText = await readme.text();
  assert.match(readmeText, /aravind_html_publisher/);
  assert.match(readmeText, /Harness-neutral self-installation/);
  assert.match(readmeText, /\*\*Authentication:\*\* `Authorization: Bearer <shared-secret>`/);
  assert.match(readmeText, /Identify the harness/);
  assert.match(readmeText, /update it in place instead of creating a duplicate/);
  assert.match(readmeText, /native user-level MCP configuration/);
  assert.match(readmeText, /Install the companion skill/);
  assert.match(readmeText, /Claude Code and the Artifacts naming conflict/);
  assert.doesNotMatch(readmeText, new RegExp(secret));

  const skill = await fetch(`${baseUrl}/artifact/SKILL.md`);
  assert.equal(skill.status, 200);
  assert.match(skill.headers.get("content-type"), /^text\/markdown/);
  const skillText = await skill.text();
  assert.match(skillText, /^---\nname: aravind-hosted-html-publisher/m);
  assert.match(skillText, /Tool Routing and Claude Artifacts Conflict/);
  assert.doesNotMatch(skillText, new RegExp(secret));
});

test("MCP endpoint requires the shared bearer secret", async () => {
  const body = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
  for (const authorization of [undefined, "Bearer wrong-secret"]) {
    const response = await fetch(`${baseUrl}/artifact/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("publishes, lists, fetches, and deletes through the real MCP protocol", async () => {
  const client = await mcpClient();
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ["delete_artifact", "get_signed_url", "list_artifacts", "publish_html", "update_artifact"]);

    const html = "<!doctype html><html><script>document.body.dataset.ok='1'</script><body>Hello</body></html>";
    const published = await client.callTool({ name: "publish_html", arguments: { html, title: " Test   artifact " } });
    const metadata = published.structuredContent;
    assert.match(metadata.artifact_id, /^[A-Za-z0-9]{24}$/);
    assert.equal(metadata.title, "Test artifact");
    assert.equal(metadata.version, 1);
    assert.equal(metadata.canonical_url, `https://mcp.example.test/artifact/${metadata.artifact_id}`);
    assert.match(metadata.url, new RegExp(`^${metadata.canonical_url}\\?expires=\\d+&signature=[a-f0-9]{64}$`));
    assert.equal(metadata.expires_in_seconds, 604800);
    assert.match(metadata.version_url, new RegExp(`^${metadata.canonical_url}/versions/1\\?expires=\\d+&signature=[a-f0-9]{64}$`));

    const publicResponse = await fetch(metadata.url.replace(config.publicBaseUrl, baseUrl));
    assert.equal(publicResponse.status, 200);
    assert.equal(await publicResponse.text(), html);
    assert.match(publicResponse.headers.get("content-security-policy"), /^sandbox allow-scripts/);
    assert.equal(publicResponse.headers.get("referrer-policy"), "no-referrer");
    assert.match(publicResponse.headers.get("cache-control"), /must-revalidate/);

    const updatedHtml = "<!doctype html><h1>Updated version</h1>";
    const updated = await client.callTool({
      name: "update_artifact",
      arguments: { artifact_id: metadata.artifact_id, html: updatedHtml, title: "Updated artifact" },
    });
    assert.equal(updated.structuredContent.artifact_id, metadata.artifact_id);
    assert.equal(updated.structuredContent.canonical_url, metadata.canonical_url);
    assert.equal(updated.structuredContent.version, 2);
    assert.match(updated.structuredContent.url, new RegExp(`^${metadata.canonical_url}\\?expires=\\d+&signature=[a-f0-9]{64}$`));
    assert.match(updated.structuredContent.version_url, new RegExp(`^${metadata.canonical_url}/versions/2\\?expires=\\d+&signature=[a-f0-9]{64}$`));
    assert.equal(await (await fetch(updated.structuredContent.url.replace(config.publicBaseUrl, baseUrl))).text(), updatedHtml);
    assert.equal(await (await fetch(metadata.version_url.replace(config.publicBaseUrl, baseUrl))).text(), html);
    assert.equal(await (await fetch(updated.structuredContent.version_url.replace(config.publicBaseUrl, baseUrl))).text(), updatedHtml);
    assert.match((await fetch(metadata.version_url.replace(config.publicBaseUrl, baseUrl))).headers.get("cache-control"), /immutable/);

    const customShare = await client.callTool({
      name: "get_signed_url",
      arguments: { artifact_id: metadata.artifact_id, expires_in_seconds: 3600, version: 1 },
    });
    assert.equal(customShare.structuredContent.expires_in_seconds, 3600);
    assert.equal(customShare.structuredContent.version, 1);
    assert.match(customShare.structuredContent.url, /\/versions\/1\?expires=\d+&signature=[a-f0-9]{64}$/);

    const gallery = await (await fetch(`${baseUrl}/artifacts`)).text();
    assert.match(gallery, /Version history \(2\)/);
    assert.match(gallery, new RegExp(`/artifact/${metadata.artifact_id}/versions/1\\?expires=\\d+&amp;signature=`));
    assert.match(gallery, new RegExp(`/artifact/${metadata.artifact_id}/versions/2\\?expires=\\d+&amp;signature=`));

    const listed = await client.callTool({ name: "list_artifacts", arguments: {} });
    assert.equal(listed.structuredContent.artifacts[0].artifact_id, metadata.artifact_id);
    assert.equal(listed.structuredContent.artifacts[0].version, 2);

    const deleted = await client.callTool({ name: "delete_artifact", arguments: { artifact_id: metadata.artifact_id } });
    assert.equal(deleted.structuredContent.deleted, true);
    await assert.rejects(() => store.read(metadata.artifact_id), /Artifact not found/);
  } finally {
    await client.close();
  }
});

test("supports HEAD/ETag and rejects traversal", async () => {
  const client = await mcpClient();
  let metadata;
  try {
    metadata = (await client.callTool({ name: "publish_html", arguments: { html: "<h1>Hello</h1>" } })).structuredContent;
  } finally {
    await client.close();
  }
  const share = await createArtifactSignedUrl({ artifactId: metadata.artifact_id, publicBaseUrl: baseUrl, secretFile });
  const head = await fetch(share.url, { method: "HEAD" });
  assert.equal(head.status, 200);
  const notModified = await fetch(share.url, { headers: { "if-none-match": head.headers.get("etag") } });
  assert.equal(notModified.status, 304);
  assert.equal((await fetch(`${baseUrl}/artifact/..%2F..%2Fsecrets%2Fshared-secret`)).status, 404);
});

test("migrates legacy IDs to alphanumeric IDs and lets old links die", async () => {
  const client = await mcpClient();
  let published;
  try {
    published = (await client.callTool({
      name: "publish_html",
      arguments: { html: "<h1>Legacy migration</h1>", title: "Legacy migration" },
    })).structuredContent;
  } finally {
    await client.close();
  }

  const legacyId = `_${"L".repeat(23)}`;
  const legacyHtmlPath = path.join(store.artifactsDir, `${legacyId}.html`);
  const legacyMetadataPath = path.join(store.metadataDir, `${legacyId}.json`);
  const legacyHtml = await readFile(store.versionHtmlPath(published.artifact_id, 1));
  const legacyMetadata = JSON.parse(await readFile(store.metadataPath(published.artifact_id), "utf8"));
  legacyMetadata.artifact_id = legacyId;
  legacyMetadata.url = `https://mcp.example.test/artifact/${legacyId}`;
  delete legacyMetadata.version;
  delete legacyMetadata.version_url;
  delete legacyMetadata.updated_at;
  await writeFile(legacyHtmlPath, legacyHtml);
  await writeFile(legacyMetadataPath, JSON.stringify(legacyMetadata));
  await rm(store.metadataPath(published.artifact_id), { force: true });
  await rm(store.versionDir(published.artifact_id), { recursive: true, force: true });

  const migrations = await store.migrateLegacyArtifacts();
  assert.equal(migrations.length, 1);
  assert.equal(migrations[0].from, legacyId);
  assert.match(migrations[0].to, /^[A-Za-z0-9]{24}$/);
  assert.equal((await fetch(`${baseUrl}/artifact/${legacyId}`, { redirect: "manual" })).status, 404);
  const migratedShare = await createArtifactSignedUrl({ artifactId: migrations[0].to, publicBaseUrl: baseUrl, secretFile });
  assert.equal((await fetch(migratedShare.url)).status, 200);
  assert.equal((await store.readLatestMetadata(migrations[0].to)).version, 1);
  assert.equal((await store.list(200)).some((item) => item.artifact_id === legacyId), false);
});

test("enforces HTML size and picks up secret rotation without restart", async () => {
  const client = await mcpClient();
  try {
    const result = await client.callTool({ name: "publish_html", arguments: { html: "x".repeat(1025) } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /1024-byte limit/);
  } finally {
    await client.close();
  }

  const rotated = "r".repeat(64);
  await writeFile(secretFile, rotated, { mode: 0o600 });
  await assert.rejects(() => mcpClient(secret), /401|Unauthorized/);
  const rotatedClient = await mcpClient(rotated);
  await rotatedClient.close();
});
