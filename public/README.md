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
5. **Enable the complete toolset.** Enable exactly `publish_html`, `update_artifact`, `get_signed_url`, `list_artifacts`, and `delete_artifact`.
6. **Install the companion skill.** If the harness supports agent skills, fetch `https://mcp.aravindmj.in/artifact/SKILL.md`, validate that its frontmatter name is `aravind-hosted-html-publisher`, and install it through the harness's native user-level skill mechanism. Update an existing copy rather than creating another one.
7. **Reload the tool schema.** Reconnect the MCP server or start a new agent session, according to the harness's lifecycle.
8. **Verify before reporting success.** Confirm authenticated initialization and all five tools. Publish and fetch a harmless disposable page, delete it, and confirm it no longer resolves.
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
  "title": "Optional private metadata title"
}
```

Returns an artifact ID plus signed latest/version links with a default lifetime of one week, byte count, SHA-256 digest, and creation time. The HTML should be self-contained. Anyone with an unexpired signed URL can view it, so never include secrets or private data.

Agents should keep a temporary local HTML working file (for example `.artifact-work/<name>.html`) as the editable source of truth, then read that file into `publish_html`.

### `update_artifact`

Edits the retained local working file and uploads its complete contents as a new version of an existing artifact. It preserves the same artifact ID and stable public URL, increments `version`, and returns an immutable `version_url` for the new snapshot. Earlier versions remain accessible through their version URLs and the private gallery.

### `get_signed_url`

Creates a fresh signed URL for the latest artifact or one immutable version. `expires_in_seconds` defaults to `604800` (one week) and accepts integer durations from `60` seconds through `31536000` seconds (one year). Unsigned links fall back to the same HTTP Basic Auth challenge as the private gallery; invalid or expired signatures do not grant access.

### `list_artifacts`

Lists recent private metadata without returning HTML source.

### `delete_artifact`

Permanently removes one hosted artifact using the 24-character alphanumeric ID returned by `publish_html`.

## Verification

A correct installation must satisfy all of these:

1. An unauthenticated request to the MCP endpoint returns HTTP `401`.
2. Authenticated MCP initialization succeeds.
3. Tool discovery returns exactly `publish_html`, `update_artifact`, `get_signed_url`, `list_artifacts`, and `delete_artifact`.
4. A harmless test page published with `publish_html` returns an `https://mcp.aravindmj.in/artifact/<id>?expires=...&signature=...` URL.
5. Fetching that URL returns the test HTML.
6. Delete the test artifact if it was created only for verification.

The public artifact URLs are bearer-by-possession links. MCP creation, listing, and deletion remain protected by the shared secret.

The `/artifacts` gallery is a separate owner-only convenience view protected by HTTP Basic Auth. Hovering a card reveals a top-right trash button; pressing it opens a deletion confirmation modal backed by a server-validated CSRF token. Touch devices show the button persistently. After deletion, a signed HTTP-only flash message is consumed once and cleared, so it does not persist on reload or leak into the URL. Gallery authentication is not the MCP bearer token, and individual opaque artifact URLs remain publicly viewable by anyone who has the link.
