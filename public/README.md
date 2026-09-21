# Aravind Hosted HTML Publisher MCP

This is the public installation guide for Aravind's private, authenticated HTML-publishing MCP.

Give this URL to an agent in any MCP-capable harness. The agent should identify its own harness and complete the installation using that harness's native MCP and skill mechanisms.

- **MCP endpoint:** `https://mcp.aravindmj.in/artifact/mcp`
- **Transport:** MCP Streamable HTTP
- **Authentication:** `Authorization: Bearer <shared-secret>`
- **Recommended server name:** `aravind_html_publisher`
- **Companion skill:** `https://mcp.aravindmj.in/artifact/SKILL.md`
- **Health check:** `https://mcp.aravindmj.in/healthz`
- **Private gallery:** `https://mcp.aravindmj.in/artifacts` (HTTP Basic Auth)
- **Logo:** `https://mcp.aravindmj.in/logo.svg`
- **Favicon:** `https://mcp.aravindmj.in/favicon.svg`

The shared secret is deliberately **not** published here. Aravind must provide it through a secure channel or configure it directly in the target harness's secret store. Do not paste it into prompts, logs, source control, shell history, or this README.

## Harness-neutral self-installation

If you are an agent reading this guide, install the service in the harness where you are currently running:

1. **Identify the harness and scope.** Inspect the current runtime, its MCP help/documentation, and its existing MCP configuration. Use the harness's native user-level MCP configuration unless the user explicitly requests a project/workspace-only installation.
2. **Check for an existing registration.** Look for the exact server name `aravind_html_publisher`. If it already exists, update it in place instead of creating a duplicate.
3. **Register the remote server.** Configure MCP Streamable HTTP at `https://mcp.aravindmj.in/artifact/mcp` under the exact name `aravind_html_publisher`.
4. **Configure authentication securely.** Source the bearer token from the harness's protected credential store or an environment variable such as `ARAVIND_ARTIFACT_MCP_TOKEN`. Send the bearer authorization header on every MCP request. If the credential is unavailable, stop and ask Aravind to configure it securely.
5. **Enable the complete toolset.** Enable exactly `publish_html`, `update_artifact`, `get_attachment_upload_url`, `get_signed_url`, `list_artifacts`, and `delete_artifact`.
6. **Install the companion skill.** If the harness supports agent skills, fetch `https://mcp.aravindmj.in/artifact/SKILL.md`, validate that its frontmatter name is `aravind-hosted-html-publisher`, and install it through the harness's native user-level skill mechanism. Update an existing copy rather than creating another one.
7. **Reload the tool schema.** Reconnect the MCP server or start a new agent session, according to the harness's lifecycle.
8. **Verify before reporting success.** Confirm authenticated initialization and all six tools. Publish and fetch a harmless disposable page, delete it, and confirm it no longer resolves.
9. **Report the result.** State the harness, installation scope, local server name, discovered tools, skill location if applicable, and smoke-test result. Never print the bearer token.

Use the current harness's native CLI, settings UI, or configuration file. Do not copy commands for another harness merely because they appear in this guide.

## Configuration adaptation

- **CLI-based harness:** inspect its current MCP `add`, `list`, and `test` help, then use those native commands.
- **JSON, YAML, or TOML harness:** adapt the canonical fields below to its schema while preserving the exact server name, URL, transport, and authorization header.
- **GUI-based harness:** add a remote/HTTP MCP server with the same values and store the token in its protected credential field.
- **Harness without skill support:** install the MCP alone and retain this guide as usage reference.

Canonical configuration shape:

```json
{
  "mcpServers": {
    "aravind_html_publisher": {
      "type": "http",
      "url": "https://mcp.aravindmj.in/artifact/mcp",
      "headers": {
        "Authorization": "Bearer ${ARAVIND_ARTIFACT_MCP_TOKEN}"
      }
    }
  }
}
```

Field names vary by harness. Preserve the semantics rather than forcing this JSON shape into an incompatible configuration format.

## Hermes Agent example

For Hermes, use its native installer and enter the token only at the hidden credential prompt:

```text
hermes mcp add aravind_html_publisher \
  --url https://mcp.aravindmj.in/artifact/mcp \
  --auth header
```

Then verify:

```text
hermes mcp test aravind_html_publisher
```

For a Hermes deployment, environment variables are managed in **hPanel → Hermes Agent → Dashboard → Environment**, not shell startup files or project `.env` files.

## Claude Code and the Artifacts naming conflict

Claude's built-in **Artifacts** feature and this MCP are different systems:

| Need | Use |
|---|---|
| In-chat canvas, preview, or Claude-native artifact | Claude's built-in Artifacts feature |
| A persistent artifact identity plus a one-week share link | `aravind_html_publisher.publish_html` |
| Revise an existing hosted page while preserving its URL | `aravind_html_publisher.update_artifact` |
| Create a fresh share link with a chosen lifetime | `aravind_html_publisher.get_signed_url` |
| List or delete pages previously hosted by this service | `aravind_html_publisher.list_artifacts` / `delete_artifact` |

Install this MCP under `aravind_html_publisher`, **not** `artifact` or `artifacts`. In Claude Code, always invoke or describe the MCP by its qualified server namespace when both systems are present. Requests containing “share,” “host,” “publish,” “public URL,” or “send me a link” should select this MCP. Requests for a Claude canvas or inline preview should select Claude's built-in feature.

A Claude-native artifact ID is not an ID for this service. Do not pass it to `delete_artifact`, and do not claim a Claude-native preview is publicly hosted unless this MCP returned an `https://mcp.aravindmj.in/artifact/...` URL.

## Tools

### `publish_html`

Input:

```json
{
  "html": "<!doctype html>...",
  "title": "Optional private metadata title",
  "tags": ["design", "demo"]
}
```

Returns an artifact ID plus signed latest/version links with a default lifetime of one week, byte count, SHA-256 digest, and creation time. The HTML should be self-contained. Anyone with an unexpired signed URL can view it, so never include secrets or private data.

Agents should keep a temporary local HTML working file (for example `.artifact-work/<name>.html`) as the editable source of truth, then read that file into `publish_html`.

### `update_artifact`

Edits the retained local working file and uploads its complete contents as a new version of an existing artifact. It preserves the same artifact ID and stable public URL, increments `version`, and returns an immutable `version_url` for the new snapshot. Earlier versions remain accessible through their version URLs and the private gallery.

### `get_signed_url`

Creates a fresh signed URL for the latest artifact or one immutable version. `expires_in_seconds` defaults to `604800` (one week) and accepts integer durations from `60` seconds through `31536000` seconds (one year). Unsigned links fall back to the same HTTP Basic Auth challenge as the private gallery; invalid or expired signatures do not grant access.

### `list_artifacts`

Accepts `limit` and an optional `tag` filter. Returns `{ artifacts, tags }`. Filtering happens before the limit. `tags` contains every unique tag across the entire collection, including artifacts outside the result limit or filter. HTML source is omitted.

### `delete_artifact`

Permanently removes one hosted artifact, every version, and all attachment bytes using the 24-character alphanumeric ID returned by `publish_html`.

## Attachment uploads

Use artifact-owned storage for images, videos, audio, and downloadable files. No separate asset host or base64 MCP payload is required.

1. Publish an initial HTML document to allocate an artifact ID. Do not put attachment references in this first publish.
2. Call `get_attachment_upload_url` with `artifact_id`. It returns a 600-second artifact-scoped `upload_url`, `expires`, `expires_at`, `expires_in_seconds`, `method: "POST"`, `max_bytes`, and `attachments` with existing file metadata.
3. Append a URL-encoded `filename` query parameter to `upload_url`, preserving its existing signature and expiry query parameters. POST raw file bytes with a `Content-Type` header, without an Authorization header. This is not multipart form data. The URL grants uploads to this artifact for 600 seconds and may be reused until expiry within its quota. Treat it as a secret: never put it in HTML, logs, or shell history. Use a streaming HTTP client for videos. The unsigned endpoint still accepts the MCP Bearer credential for backward compatibility.
4. A successful upload returns HTTP `201` and `{ attachment_id, reference, filename, content_type, bytes }`. Retain the exact `reference`, for example `artifact-attachment:AbCdEfGhIjKlMnOpQrStUvWx`.
5. Use that reference in the retained working HTML and call `update_artifact` with the original artifact ID:

```html
<img src="artifact-attachment:AbCdEfGhIjKlMnOpQrStUvWx" alt="Uploaded image">
<video controls src="artifact-attachment:AbCdEfGhIjKlMnOpQrStUvWx"></video>
<a href="artifact-attachment:AbCdEfGhIjKlMnOpQrStUvWx">Download file</a>
```

The examples show the reference syntax. Use the appropriate element and the actual ID returned for each uploaded file. References also work in inline CSS and JavaScript strings because the server replaces their literal text before serving HTML. Do not persist the rendered signed asset URL in your source.

Only references owned by that artifact are accepted. Files are immutable; upload a new file and update the HTML to replace one. Uploading alone does not create an HTML version or modify prior HTML. Existing versions keep using their original attachment IDs. Unreferenced uploads remain until artifact deletion and count toward the file limit. Use `get_attachment_upload_url` again to recover existing references after a lost upload response. Retrying POST creates another attachment rather than replacing one.

On signed latest and immutable pages, references become attachment-specific signed URLs with the page's expiry. These signatures cannot authorize an HTML page or another file. Owner Basic Auth page views receive one-hour attachment links. Unsigned attachment URLs never grant access, including with the owner marker or an MCP Bearer header. Sharing an attachment URL grants access only to that file until expiry. Secret rotation invalidates existing asset links. Attachment-backed HTML and binary responses use `private, no-store`; source HTML and its SHA-256 remain unchanged in storage, but rendered response bytes differ.

GET, HEAD, and byte ranges support media playback. PNG, JPEG, GIF, WebP, AVIF, MP4, WebM, Ogg video, MP3, MP4 audio, Ogg audio, WAV, and WebM audio may render inline with their declared supported MIME type. Other MIME types, including HTML, SVG, and PDF, are returned as `application/octet-stream` downloads with `nosniff` and a CSP sandbox. The server does not transcode or verify codecs; choose a MIME type that matches the file. Filenames must be non-empty basenames of at most 180 UTF-8 bytes, without path separators or control characters.

Defaults are 256 MiB per attachment and 100 attachments per artifact. Operators can change `ARTIFACT_MAX_ATTACHMENT_BYTES` and `ARTIFACT_MAX_ATTACHMENTS`. The HTML limit remains separate. Empty or invalid uploads return `400`, missing or wrong authentication returns `401`, oversized uploads return `413`, and a full artifact returns `409`. The server counts streamed chunks even without Content-Length and removes incomplete files after handled upload failures. Deleting an artifact deletes all its files and versions.

## Tags and gallery filters

`publish_html` and `update_artifact` accept an optional `tags` array. Tags are private metadata, not inserted into hosted HTML. The server trims whitespace, collapses internal whitespace, lowercases, and deduplicates while preserving the first occurrence order. Supply at most 20 strings, each with at most 64 characters after whitespace normalization. Empty strings, control characters, and malformed Unicode are rejected. Malformed legacy tag strings are omitted when reading metadata.

Omitting tags on publish produces `[]`. Omitting them on update preserves current tags; passing `[]` clears them. Historical metadata without tags reads as untagged. Versions retain their tag snapshot, while listing and gallery filters use current tags.

`list_artifacts({ "limit": 50, "tag": "design" })` filters by one exact normalized tag before applying the result limit. The response includes `artifacts` and sorted unique `tags` from the entire current collection, not just this page or filter. The private `/artifacts` gallery displays those tags as keyboard-accessible filter chips. Select a tag to filter, or use **Clear filter** to reset. Unknown tags show a no-results message.

## Verification

A correct installation must satisfy all of these:

1. An unauthenticated request to the MCP endpoint returns HTTP `401`.
2. Authenticated MCP initialization succeeds.
3. Tool discovery returns exactly `publish_html`, `update_artifact`, `get_attachment_upload_url`, `get_signed_url`, `list_artifacts`, and `delete_artifact`.
4. A harmless test page published with `publish_html` returns an `https://mcp.aravindmj.in/artifact/<id>?expires=...&signature=...` URL.
5. Fetching that URL returns the test HTML.
6. Delete the test artifact if it was created only for verification.

The public artifact URLs are bearer-by-possession links. MCP creation, listing, and deletion remain protected by the shared secret.

The `/artifacts` gallery is a separate owner-only convenience view protected by HTTP Basic Auth. Hovering a card reveals a top-right trash button; pressing it opens a deletion confirmation modal backed by a server-validated CSRF token. Touch devices show the button persistently. After deletion, a signed HTTP-only flash message is consumed once and cleared, so it does not persist on reload or leak into the URL. Gallery authentication is not the MCP bearer token, and individual opaque artifact URLs remain publicly viewable by anyone who has the link.
