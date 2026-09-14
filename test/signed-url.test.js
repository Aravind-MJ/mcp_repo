import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  artifactSignedUrlIsValid,
  createArtifactSignedUrl,
  normalizeArtifactExpiry,
} from "../src/security.js";

let root;
let secretFile;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "artifact-signature-test-"));
  secretFile = path.join(root, "secrets", "shared-secret");
  await mkdir(path.dirname(secretFile), { recursive: true });
  await writeFile(secretFile, "s".repeat(64), { mode: 0o600 });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("creates a one-week signed URL by default", async () => {
  const signed = await createArtifactSignedUrl({
    artifactId: "A".repeat(24),
    publicBaseUrl: "https://mcp.example.test",
    secretFile,
    nowSeconds: 2_000_000_000,
  });
  assert.equal(signed.expires_in_seconds, 604800);
  assert.equal(signed.expires, 2_000_604_800);
  assert.equal(signed.expires_at, "2033-05-25T03:33:20.000Z");
  assert.match(signed.url, /^https:\/\/mcp\.example\.test\/artifact\/A{24}\?expires=2000604800&signature=[a-f0-9]{64}$/);
});

test("supports shorter and longer bounded expirations and version URLs", async () => {
  assert.equal(normalizeArtifactExpiry(60), 60);
  assert.equal(normalizeArtifactExpiry(31_536_000), 31_536_000);
  assert.throws(() => normalizeArtifactExpiry(59), /between/);
  assert.throws(() => normalizeArtifactExpiry(31_536_001), /between/);

  const signed = await createArtifactSignedUrl({
    artifactId: "B".repeat(24),
    version: 3,
    publicBaseUrl: "https://mcp.example.test",
    secretFile,
    expiresInSeconds: 3600,
    nowSeconds: 2_000_000_000,
  });
  assert.equal(signed.version, 3);
  assert.equal(signed.expires_in_seconds, 3600);
  assert.match(signed.url, /\/artifact\/B{24}\/versions\/3\?expires=2000003600&signature=[a-f0-9]{64}$/);
});

test("validates signatures and rejects tampering or expiration", async () => {
  const artifactId = "C".repeat(24);
  const signed = await createArtifactSignedUrl({
    artifactId,
    publicBaseUrl: "https://mcp.example.test",
    secretFile,
    expiresInSeconds: 60,
    nowSeconds: 2_000_000_000,
  });
  const parsed = new URL(signed.url);
  const expires = parsed.searchParams.get("expires");
  const signature = parsed.searchParams.get("signature");

  assert.equal(await artifactSignedUrlIsValid({ artifactId, expires, signature, secretFile, nowSeconds: 2_000_000_030 }), true);
  assert.equal(await artifactSignedUrlIsValid({ artifactId, expires, signature: "0".repeat(64), secretFile, nowSeconds: 2_000_000_030 }), false);
  assert.equal(await artifactSignedUrlIsValid({ artifactId, expires, signature, secretFile, nowSeconds: 2_000_000_061 }), false);
  assert.equal(await artifactSignedUrlIsValid({ artifactId: "D".repeat(24), expires, signature, secretFile, nowSeconds: 2_000_000_030 }), false);
});
