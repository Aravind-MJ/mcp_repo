import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

test("attachment storage limits are configurable with bounded defaults", () => {
  assert.equal(loadConfig({}).maxAttachmentBytes, 256 * 1024 * 1024);
  assert.equal(loadConfig({}).maxAttachmentsPerArtifact, 100);
  const config = loadConfig({ ARTIFACT_MAX_ATTACHMENT_BYTES: "12345", ARTIFACT_MAX_ATTACHMENTS: "7" });
  assert.equal(config.maxAttachmentBytes, 12345);
  assert.equal(config.maxAttachmentsPerArtifact, 7);
  assert.throws(() => loadConfig({ ARTIFACT_MAX_ATTACHMENT_BYTES: "0" }), /positive integer/);
});

let root, store, server, baseUrl, client, config;
const secret = "test-only-secret-".repeat(4);
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "artifact-features-"));
  const secretFile = path.join(root, "secret");
  await writeFile(secretFile, secret);
  config = { dataDir: path.join(root, ".private", "data"), secretFile, publicBaseUrl: "https://example.test", maxHtmlBytes: 4096, maxListItems: 1, maxAttachmentBytes: 32, maxAttachmentsPerArtifact: 3, allowedHosts: ["127.0.0.1"] };
  const created = await createApp(config);
  store = created.store;
  server = createServer(created.app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  client = new Client({ name: "features", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/artifact/mcp`), { requestInit: { headers: { authorization: `Bearer ${secret}` } } }));
});
afterEach(async () => {
  await client?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});
const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).structuredContent;
const local = url => url.replace(config.publicBaseUrl, baseUrl);
const uploadFile = (id, body = "0123456789", filename = "clip.mp4", type = "video/mp4", auth = secret) => fetch(`${baseUrl}/artifact/${id}/attachments?filename=${encodeURIComponent(filename)}`, { method: "POST", headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), "content-type": type }, body, ...(body?.[Symbol.asyncIterator] ? { duplex: "half" } : {}) });
async function mediaPage(type = "video/mp4", filename = "clip.mp4") {
  const item = await store.publish("Media");
  const attachment = await (await uploadFile(item.artifact_id, "0123456789", filename, type)).json();
  await store.update(item.artifact_id, `<a href="${attachment.reference}">File</a>`);
  const share = await store.createSignedUrl(item.artifact_id);
  const page = await fetch(local(share.url));
  const url = (await page.text()).match(/href="([^"]+)"/)[1];
  return { item, attachment, url: local(url), share };
}

async function waitUntil(predicate) {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await delay(10); }
  assert.fail("Condition did not become true within one second");
}

test("binary streaming exceeds the HTML limit and concurrent uploads respect the file cap", async () => {
  const item = await store.publish("Media");
  store.attachments.maxBytes = 1024 * 1024;
  async function* chunks() { for (let i = 0; i < 16; i++) yield Buffer.alloc(65536, i); }
  const result = await uploadFile(item.artifact_id, chunks(), "data.bin", "application/octet-stream");
  assert.equal(result.status, 201);
  const file = await result.json();
  assert.equal(file.bytes, 1024 * 1024);
  const stored = await readFile(store.attachments.filePath(item.artifact_id, file.attachment_id));
  assert.equal(stored.length, 1024 * 1024);
  assert.equal(stored[65536], 1);
  const results = await Promise.all(Array.from({ length: 5 }, () => uploadFile(item.artifact_id)));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 201, 409, 409, 409]);
});

test("interrupted HTTP uploads remove temporary bytes and release the artifact lock", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const item = await store.publish("Media");
  const req = httpRequest(`${baseUrl}/artifact/${item.artifact_id}/attachments?filename=broken.mp4`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "video/mp4" } });
  req.on("error", () => {});
  req.write("partial");
  await waitUntil(async () => (await readdir(store.attachments.artifactDir(item.artifact_id)).catch(() => [])).some(name => name.endsWith(".upload")));
  req.destroy();
  await waitUntil(() => !store.updateLocks.has(item.artifact_id));
  assert.deepEqual(await readdir(store.attachments.artifactDir(item.artifact_id)), []);
  assert.equal((await uploadFile(item.artifact_id)).status, 201);
  assert.equal(errors.mock.callCount(), 0);
});

test("owner page attachments remain scoped, and prior versions retain their file references", async () => {
  const media = await mediaPage("image/png", "plot.png");
  const original = (await store.read(media.item.artifact_id)).html.toString();
  const next = await (await uploadFile(media.item.artifact_id, "new-image", "next.png", "image/png")).json();
  await store.update(media.item.artifact_id, `<img src="${next.reference}">`);
  assert.equal((await store.read(media.item.artifact_id, 2)).html.toString(), original);
  const oldShare = await store.createSignedUrl(media.item.artifact_id, 60, 2);
  const oldHtml = await (await fetch(local(oldShare.url))).text();
  assert.match(oldHtml, new RegExp(media.attachment.attachment_id));
  assert.doesNotMatch(oldHtml, new RegExp(next.attachment_id));
  const ownerPage = await fetch(`${baseUrl}/artifact/${media.item.artifact_id}?expires=bad&signature=bad`, { headers: { "x-artifact-basic-auth": "1" } });
  const url = (await ownerPage.text()).match(/src="([^"]+)"/)[1];
  const expiry = Number(new URL(url).searchParams.get("expires"));
  assert.ok(expiry >= Math.floor(Date.now() / 1000) + 3590);
  assert.equal((await fetch(local(url))).status, 200);
  for (const headers of [{ "x-artifact-basic-auth": "1" }, { authorization: `Bearer ${secret}` }]) assert.equal((await fetch(local(url.split("?")[0]), { headers })).status, 404);
});

test("uploads enforce Bearer auth, filenames, byte and count limits without partial files", async () => {
  const item = await store.publish("Media");
  for (const auth of [null, "wrong"]) assert.equal((await uploadFile(item.artifact_id, "x", "a", "image/png", auth)).status, 401);
  for (const filename of ["../x", "a/b", "a\\b", "", "a\r\nb", "a".repeat(181)]) assert.equal((await uploadFile(item.artifact_id, "x", filename)).status, 400);
  assert.equal((await uploadFile(item.artifact_id, "x".repeat(33))).status, 413);
  async function* chunks() { yield Buffer.alloc(20); yield Buffer.alloc(20); }
  assert.equal((await uploadFile(item.artifact_id, chunks())).status, 413);
  assert.deepEqual(await store.attachments.list(item.artifact_id), []);
  assert.equal((await uploadFile(item.artifact_id, "")).status, 400);
  for (let i = 0; i < 3; i++) assert.equal((await uploadFile(item.artifact_id)).status, 201);
  assert.equal((await uploadFile(item.artifact_id)).status, 409);
  const files = await readdir(store.attachments.artifactDir(item.artifact_id));
  assert.equal(files.length, 6);
  assert.equal(files.some(name => name.endsWith(".upload")), false);
});

test("attachments support video HEAD and byte ranges, and force active documents to download", async () => {
  const { url } = await mediaPage();
  const head = await fetch(url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal(await head.text(), "");
  const range = await fetch(url, { headers: { range: "bytes=2-5" } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await range.text(), "2345");
  assert.equal((await fetch(url, { headers: { range: "bytes=99-100" } })).status, 416);
  assert.equal(head.headers.get("content-disposition"), 'inline; filename="clip.mp4"');
  assert.equal(head.headers.get("x-content-type-options"), "nosniff");
  for (const type of ["text/html", "image/svg+xml", "application/pdf", "application/octet-stream"]) {
    const file = await mediaPage(type, "résumé.html");
    const download = await fetch(file.url);
    assert.match(download.headers.get("content-disposition"), /^attachment;/);
    assert.match(download.headers.get("content-security-policy"), /sandbox/);
    assert.equal(download.headers.get("content-type"), "application/octet-stream");
  }
});

test("references must belong to their artifact and deletion removes attachment bytes", async () => {
  const media = await mediaPage();
  const other = await store.publish("Other");
  for (const reference of [media.attachment.reference, "artifact-attachment:../secret", `artifact-attachment:${"x".repeat(24)}`, "artifact-attachment:"]) {
    await assert.rejects(() => store.update(other.artifact_id, `<img src="${reference}">`), /not found/);
  }
  await assert.rejects(() => store.publish(`<img src="${media.attachment.reference}">`), /not found/);
  assert.equal((await store.read(other.artifact_id)).metadata.version, 1);
  const dir = store.attachments.artifactDir(media.item.artifact_id);
  await store.delete(media.item.artifact_id);
  await assert.rejects(() => readdir(dir), { code: "ENOENT" });
  assert.equal((await fetch(media.url)).status, 404);
  assert.equal((await uploadFile(media.item.artifact_id)).status, 404);
});

test("asset signatures expire with their page and cannot transfer to other files or pages", async () => {
  const media = await mediaPage();
  const other = await mediaPage();
  const parsed = new URL(media.url);
  assert.equal(parsed.searchParams.get("expires"), new URL(media.share.url).searchParams.get("expires"));
  for (const url of [media.url.replace(media.attachment.attachment_id, other.attachment.attachment_id), media.url.replace(media.item.artifact_id, other.item.artifact_id), media.url.replace(/signature=[^&]+/, `signature=${"0".repeat(64)}`), media.url.replace(/expires=\d+/, "expires=1000000000")]) assert.equal((await fetch(url)).status, 404);
  const pageWithAssetSignature = `${baseUrl}/artifact/${media.item.artifact_id}${parsed.search}`;
  assert.equal((await fetch(pageWithAssetSignature)).status, 404);
  const assetWithPageSignature = `${parsed.origin}${parsed.pathname}${new URL(media.share.url).search}`;
  assert.equal((await fetch(assetWithPageSignature)).status, 404);
  const page = await fetch(local(media.share.url));
  const conditional = await fetch(local(media.share.url), { headers: { "if-none-match": page.headers.get("etag") || "unused" } });
  assert.equal(conditional.status, 200);
  assert.equal(conditional.headers.get("cache-control"), "private, no-store");
  await writeFile(config.secretFile, "rotated-secret-".repeat(4));
  assert.equal((await fetch(media.url)).status, 404);
});

test("gallery hides tag filters when the collection has no tags unless a filter is active", async () => {
  await call("publish_html", { html: "untagged", title: "Untagged item" });
  const gallery = await (await fetch(`${baseUrl}/artifacts`)).text();
  assert.match(gallery, /Untagged item/);
  assert.doesNotMatch(gallery, /aria-label="Filter by tag"/);
  assert.doesNotMatch(gallery, /Clear filter/);

  const filteredGallery = await (await fetch(`${baseUrl}/artifacts?tag=missing`)).text();
  assert.match(filteredGallery, /No artifacts match this tag/);
  assert.match(filteredGallery, /href="\/artifacts">Clear filter/);
});

test("tag filters apply before limits and gallery chips include the entire collection", async () => {
  const old = await call("publish_html", { html: "old", title: "Older item", tags: ["Rare", "<tag>"] });
  await call("publish_html", { html: "new", title: "Newer item", tags: ["common"] });
  const listed = await call("list_artifacts", { limit: 1, tag: " RARE " });
  assert.deepEqual(listed.artifacts.map(a => a.artifact_id), [old.artifact_id]);
  assert.deepEqual(listed.tags, ["<tag>", "common", "rare"]);
  const gallery = await (await fetch(`${baseUrl}/artifacts?tag=rare`)).text();
  assert.match(gallery, /Older item/);
  assert.doesNotMatch(gallery, /Newer item/);
  assert.match(gallery, /aria-label="Filter by tag"/);
  assert.match(gallery, /aria-current="true"[^>]*>rare/);
  assert.match(gallery, /common<\/a>/);
  assert.match(gallery, /&lt;tag&gt;/);
  assert.match(gallery, /href="\/artifacts">Clear filter/);
  assert.match(await (await fetch(`${baseUrl}/artifacts?tag=missing`)).text(), /No artifacts match/);
  await store.delete(old.artifact_id);
  assert.deepEqual((await call("list_artifacts")).tags, ["common"]);
});

test("tags reject invalid values and old metadata defaults to an empty array", async () => {
  for (const tags of [null, [5], [" "], ["x".repeat(65)], ["İ".repeat(64)], Array(21).fill("tag"), ["bad\u0000tag"], ["\ud800"], ["\udfff"]]) {
    await assert.rejects(() => store.publish("html", "title", tags), /tags/);
  }
  const item = await store.publish("html");
  for (const file of [store.metadataPath(item.artifact_id), store.versionMetadataPath(item.artifact_id, 1)]) {
    const data = JSON.parse(await readFile(file, "utf8"));
    delete data.tags;
    await writeFile(file, JSON.stringify(data));
  }
  assert.deepEqual((await store.read(item.artifact_id)).metadata.tags, []);
  assert.deepEqual((await store.listVersions(item.artifact_id))[0].tags, []);
  assert.deepEqual((await call("list_artifacts")).artifacts[0].tags, []);
});

test("legacy malformed tags are removed on every metadata read without breaking gallery", async () => {
  const item = await store.publish("html", "Legacy");
  for (const file of [store.metadataPath(item.artifact_id), store.versionMetadataPath(item.artifact_id, 1)]) {
    const data = JSON.parse(await readFile(file, "utf8"));
    data.tags = ["ok", "\ud800", "\udfff"];
    await writeFile(file, JSON.stringify(data));
  }
  assert.deepEqual((await store.readLatestMetadata(item.artifact_id)).tags, ["ok"]);
  assert.deepEqual((await store.read(item.artifact_id)).metadata.tags, ["ok"]);
  assert.deepEqual((await store.listVersions(item.artifact_id))[0].tags, ["ok"]);
  assert.deepEqual((await call("list_artifacts")).tags, ["ok"]);
  assert.equal((await fetch(`${baseUrl}/artifacts`)).status, 200);
});

test("streams an authenticated binary upload and resolves stable references in signed pages", async () => {
  const item = await call("publish_html", { html: "<h1>Media</h1>" });
  const upload = await call("get_attachment_upload_url", { artifact_id: item.artifact_id });
  assert.equal(upload.method, "POST");
  assert.equal(upload.max_bytes, 32);
  const bytes = Buffer.from([0, 255, 1, 2, 3, 4, 5]);
  assert.equal(upload.expires_in_seconds, 600);
  assert.equal(new Date(upload.expires * 1000).toISOString(), upload.expires_at);
  const target = new URL(local(upload.upload_url));
  target.searchParams.set("filename", "clip.mp4");
  const response = await fetch(target, { method: "POST", headers: { "content-type": "video/mp4" }, body: bytes });
  assert.equal(response.status, 201);
  const attachment = await response.json();
  assert.match(attachment.attachment_id, /^[A-Za-z0-9]{24}$/);
  assert.equal(attachment.reference, `artifact-attachment:${attachment.attachment_id}`);
  assert.equal(attachment.bytes, bytes.length);
  assert.deepEqual((await call("get_attachment_upload_url", { artifact_id: item.artifact_id })).attachments, [attachment]);
  const html = `<video controls src="${attachment.reference}"></video>`;
  const updated = await call("update_artifact", { artifact_id: item.artifact_id, html });
  for (const url of [updated.url, updated.version_url]) {
    const page = await fetch(local(url));
    assert.equal(page.status, 200);
    assert.match(page.headers.get("cache-control"), /no-store/);
    const rendered = await page.text();
    assert.doesNotMatch(rendered, /artifact-attachment:/);
    const assetUrl = rendered.match(/src="([^"]+)"/)[1].replaceAll("&amp;", "&");
    const asset = await fetch(local(assetUrl));
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("content-type"), "video/mp4");
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), bytes);
    assert.match(asset.headers.get("cache-control"), /no-store/);
    assert.equal((await fetch(local(assetUrl.split("?")[0]))).status, 404);
  }
  assert.equal((await store.read(item.artifact_id)).html.toString(), html);
});

test("upload capabilities reject tampering, expiry, cross-artifact and read signatures", async () => {
  const item = await store.publish("one");
  const other = await store.publish("two");
  const info = await store.attachments.uploadInfo(item.artifact_id);
  const post = url => fetch(url, { method: "POST", body: "x" });
  const url = new URL(local(info.upload_url));
  url.searchParams.set("filename", "test.bin");
  for (const invalid of [url.href.replace(item.artifact_id, other.artifact_id), url.href.replace(/signature=[^&]+/, `signature=${"0".repeat(64)}`), url.href.replace(/expires=\d+/, "expires=1000000000")]) assert.equal((await post(invalid)).status, 401);
  const expired = new URL(url);
  expired.searchParams.set("expires", "1000000000");
  expired.searchParams.set("signature", await store.attachments.signature(item.artifact_id, "upload", 1000000000));
  assert.equal((await post(expired)).status, 401);
  const page = await store.createSignedUrl(item.artifact_id);
  assert.equal((await post(`${url.origin}${url.pathname}${new URL(page.url).search}&filename=test.bin`)).status, 401);
  assert.equal((await fetch(`${url.origin}/artifact/${item.artifact_id}${url.search}`)).status, 404);
  const file = await (await post(url)).json();
  assert.equal((await fetch(`${url.origin}${url.pathname}/${file.attachment_id}${url.search}`)).status, 404);
});

test("MCP tags normalize, persist across updates, and clear explicitly",  async () => {
  const item = await call("publish_html", { html: "<h1>Tagged</h1>", tags: [" Design  Notes ", "DESIGN NOTES", "Video"] });
  assert.deepEqual(item.tags, ["design notes", "video"]);
  const updated = await call("update_artifact", { artifact_id: item.artifact_id, html: "<h1>Next</h1>" });
  assert.deepEqual(updated.tags, item.tags);
  const cleared = await call("update_artifact", { artifact_id: item.artifact_id, html: "<h1>Clear</h1>", tags: [] });
  assert.deepEqual(cleared.tags, []);
  assert.deepEqual((await store.read(item.artifact_id, 1)).metadata.tags, item.tags);
});
