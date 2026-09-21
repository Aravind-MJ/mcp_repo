import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import {
  DEFAULT_ARTIFACT_EXPIRY_SECONDS,
  MAX_ARTIFACT_EXPIRY_SECONDS,
  MIN_ARTIFACT_EXPIRY_SECONDS,
} from "../security.js";

function toolResult(value) {
  const structuredContent = Array.isArray(value) ? { artifacts: value } : value;
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

async function metadataWithSignedLinks(store, metadata) {
  const [latestShare, versionShare] = await Promise.all([
    store.createSignedUrl(metadata.artifact_id),
    store.createSignedUrl(metadata.artifact_id, undefined, metadata.version),
  ]);
  return {
    ...metadata,
    canonical_url: metadata.url,
    canonical_version_url: metadata.version_url,
    url: latestShare.url,
    version_url: versionShare.url,
    expires: latestShare.expires,
    expires_at: latestShare.expires_at,
    expires_in_seconds: latestShare.expires_in_seconds,
  };
}

export function createArtifactMcpServer(store) {
  const server = new McpServer({
    name: "personal-artifact-publisher",
    title: "Personal HTML Artifact Publisher",
    version: "1.0.0",
    description: "Publishes self-contained HTML to expiring signed sharing URLs.",
  });

  server.registerTool("publish_html", {
    title: "Publish HTML artifact",
    description: "Publish a complete self-contained HTML document and return a signed sharing URL that expires in one week by default. Do not include secrets or private data.",
    inputSchema: {
      tags: z.array(z.string()).max(20).optional().describe("At most 20 tags, 64 normalized characters each; trimmed, whitespace collapsed, lowercase and deduplicated. Omit to preserve tags on update; [] clears tags"),
      html: z.string().min(1).describe("Complete self-contained HTML document or HTML fragment"),
      title: z.string().max(120).optional().default("Untitled artifact").describe("Human-readable title used only in private metadata"),
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
  }, async ({ html, title, tags }) => toolResult(await metadataWithSignedLinks(store, await store.publish(html, title, tags))));

  server.registerTool("update_artifact", {
    title: "Update HTML artifact",
    description: "Publish a new version of an existing artifact while keeping its stable identity. Returns fresh signed latest and version URLs.",
    inputSchema: {
      artifact_id: z.string().regex(/^[A-Za-z0-9]{24}$/).describe("The existing 24-character alphanumeric artifact ID"),
      tags: z.array(z.string()).max(20).optional().describe("At most 20 tags, 64 normalized characters each; trimmed, whitespace collapsed, lowercase and deduplicated. Omit to preserve tags on update; [] clears tags"),
      html: z.string().min(1).describe("Complete updated self-contained HTML document or HTML fragment"),
      title: z.string().max(120).optional().describe("Optional updated title; omit to preserve the current title"),
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
  }, async ({ artifact_id, html, title, tags }) => toolResult(
    await metadataWithSignedLinks(store, await store.update(artifact_id, html, title, tags)),
  ));

  server.registerTool("get_attachment_upload_url", {
    title: "Get attachment upload endpoint",
    description: "Return a secret upload capability URL valid for 600 seconds, expiry metadata, size limit, and existing attachments. POST raw binary with Content-Type and append a filename query parameter; no Bearer header needed. Use the returned artifact-attachment:ID reference in update_artifact HTML.",
    inputSchema: { artifact_id: z.string().regex(/^[A-Za-z0-9]{24}$/) },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
  }, async ({ artifact_id }) => toolResult(await store.attachments.uploadInfo(artifact_id)));

  server.registerTool("get_signed_url", {
    title: "Get signed artifact URL",
    description: "Create a new expiring share URL for an artifact or one immutable version. Defaults to one week; request between 60 seconds and one year.",
    inputSchema: {
      artifact_id: z.string().regex(/^[A-Za-z0-9]{24}$/).describe("The 24-character alphanumeric artifact ID"),
      expires_in_seconds: z.number().int().min(MIN_ARTIFACT_EXPIRY_SECONDS).max(MAX_ARTIFACT_EXPIRY_SECONDS).optional().default(DEFAULT_ARTIFACT_EXPIRY_SECONDS).describe("Lifetime in seconds; defaults to 604800 (one week)"),
      version: z.number().int().min(1).optional().describe("Optional immutable version number; omit for the latest-version URL"),
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: true },
  }, async ({ artifact_id, expires_in_seconds, version }) => toolResult(
    await store.createSignedUrl(artifact_id, expires_in_seconds, version),
  ));

  server.registerTool("list_artifacts", {
    title: "List HTML artifacts",
    description: "List recent artifact metadata with optional tag filtering before limiting. Returns artifacts plus all unique tags across the entire collection. HTML source is not returned.",
    inputSchema: { limit: z.number().int().min(1).max(200).optional().default(50), tag: z.string().optional().describe("Filter by one normalized tag before limiting results") },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
  }, async ({ limit, tag }) => toolResult(await store.listWithTags(limit, tag)));

  server.registerTool("delete_artifact", {
    title: "Delete HTML artifact",
    description: "Permanently delete one artifact, every stored version, and all attachments by its opaque artifact ID.",
    inputSchema: { artifact_id: z.string().regex(/^[A-Za-z0-9]{24}$/).describe("The 24-character alphanumeric artifact ID") },
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
  }, async ({ artifact_id }) => toolResult({ deleted: true, artifact: await store.delete(artifact_id) }));

  return server;
}
