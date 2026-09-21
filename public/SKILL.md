---
name: aravind-hosted-html-publisher
description: Publish HTML to Aravind's authenticated public host.
version: 1.1.0
author: Aravind M J, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [mcp, html, publishing, artifacts]
    related_skills: []
---

# Aravind Hosted HTML Publisher

Publish self-contained HTML through Aravind's authenticated MCP and return opaque public links. This skill governs tool selection and safe usage; it does not provide or reveal the shared credential.

## When to Use

Use this skill when the user asks to:

- publish or host HTML;
- create a link another person or browser can open;
- make an HTML demo, report, mockup, diagram, or page externally shareable;
- list or remove pages previously hosted by this MCP.

Do not use it for a Claude-native in-chat canvas or preview unless the user also asks for an external hosted URL.

## Prerequisites

- Remote Streamable HTTP MCP endpoint: `https://mcp.aravindmj.in/artifact/mcp`
- Recommended MCP server name: `aravind_html_publisher`
- Bearer token supplied separately by Aravind through the harness's protected secret mechanism
- Public installation guide: `https://mcp.aravindmj.in/artifact/README.md`
- Private owner gallery: `https://mcp.aravindmj.in/artifacts` using HTTP Basic Auth

Never request that the token be pasted into a prompt. Never write it into source control, generated HTML, logs, or public documentation.

## Tool Routing and Claude Artifacts Conflict

Claude's built-in **Artifacts** feature and this hosted MCP are separate systems.

Choose `aravind_html_publisher.publish_html` when the request includes any external-delivery intent: **share**, **host**, **publish**, **public URL**, **open in a browser**, or **send a link**. It returns a signed link valid for one week by default.

Choose Claude's built-in Artifacts feature for an in-chat canvas, Claude-native preview, or editable artifact when no external URL is requested.

If both are useful, create/refine the content with the built-in feature first only when appropriate, then publish the final complete HTML with this MCP. The final public-link claim must be based on the URL returned by `publish_html`.

Do not:

- register this MCP as `artifact` or `artifacts`; use `aravind_html_publisher`;
- treat a Claude-native artifact ID as this service's 24-character alphanumeric artifact ID;
- call `delete_artifact` with an ID from another artifact system;
- claim a page is publicly hosted unless the MCP returned a URL under `https://mcp.aravindmj.in/artifact/`.

## Procedure

1. Confirm the user wants a public bearer-by-possession link. If the content contains secrets or private data, stop and ask for a safe redacted version.
2. Create a temporary local working HTML file before publishing. Prefer a workspace scratch path such as `.artifact-work/<descriptive-name>.html` when a workspace is available; otherwise use the harness's temporary directory. Add the scratch directory to the project ignore file when appropriate, and do not commit it.
3. Produce one complete HTML document in that working file. Inline CSS and JavaScript. For images, videos, or downloadable files, follow the artifact-owned attachment workflow below instead of embedding large base64 data or using a separate host. Verify the local file before uploading.
4. Read the working file and pass its complete contents to the qualified `aravind_html_publisher.publish_html` tool with a concise `title`. Do not bypass the working file by composing the final HTML only inside the MCP call.
5. Check that the result includes a 24-character alphanumeric `artifact_id` with no punctuation, a SHA-256 digest, and an HTTPS signed URL under the expected host with `expires` and `signature` parameters. The default lifetime is one week.
6. Keep the working file for the remainder of the task/session and associate it with the returned artifact ID and URL in your task notes. Do not delete it while follow-up revisions are plausible.
7. Return the URL clearly. Mention that anyone with the link can view it when privacy is relevant.
8. Fetch the returned URL and check the intended content. For attachment-backed HTML, also fetch its rendered asset URLs. The metadata SHA-256 describes stored source with stable references, not the response after signed URL substitution.

## Follow-up Updates

Treat the temporary local HTML file—not the hosted copy—as the editable source of truth. For each requested revision:

1. Edit the same local working file.
2. Verify the revised file locally.
3. Read the entire updated file and call `aravind_html_publisher.update_artifact` with the existing `artifact_id`, updated HTML, and optional title.
4. Verify that the response keeps the same artifact ID and canonical identity, increments `version`, and returns fresh signed latest and immutable-version URLs.
5. Return the fresh signed URL and, when useful, its version-specific URL. Update the local version association in your task notes.

Use `publish_html` instead only when the user requests a separate/forked artifact. Updates preserve prior versions automatically; do not delete the artifact merely to replace its contents.

For cleanup, call `aravind_html_publisher.delete_artifact` with the exact MCP-issued ID. Deletion is permanent.

When an existing link is expired or the user requests another lifetime, call `aravind_html_publisher.get_signed_url`. `expires_in_seconds` defaults to `604800` and accepts `60` through `31536000` seconds; optionally pass `version` for an immutable snapshot.

For a human gallery, open `https://mcp.aravindmj.in/artifacts` and use the owner's HTTP Basic Auth credentials. Hover a card and press the copy button to create and copy a fresh one-week signed link. The adjacent trash button opens the deletion modal; deletion is permanent. For programmatic inventory access, continue using `aravind_html_publisher.list_artifacts` with the MCP bearer token.

## Artifact-owned attachments

Publish the initial document to get its artifact ID, then call `aravind_html_publisher.get_attachment_upload_url`. The returned `upload_url` is an artifact-scoped upload capability valid for 600 seconds, with explicit `expires`, `expires_at`, and `expires_in_seconds` metadata. Append a URL-encoded `filename` query parameter without replacing its signature or expiry. Stream raw bytes with `POST` and `Content-Type`; no Authorization header is needed. This is not multipart or a base64 MCP payload. Keep upload URLs out of generated HTML, logs, and shell history. Reissue an expired capability through MCP. The unsigned endpoint still accepts a protected MCP Bearer credential for backward compatibility.

Retain the returned `artifact-attachment:ID` reference in your local HTML, such as an image `src`, video `src`, CSS `url()`, or download link `href`. Call `update_artifact` with the same artifact ID. The server checks ownership and substitutes an expiring file-specific URL when serving either latest or immutable pages. Do not paste rendered signed asset URLs back into source. Re-uploading creates a new immutable file; older versions retain their original references. Unused uploads persist until artifact deletion. Re-call `get_attachment_upload_url` to list existing files and recover references.

Verify the rendered page and fetch its attachment URLs. Check video range and HEAD responses when playback matters. Unsigned asset paths must fail. HTML, SVG, PDF, and other non-allowlisted MIME types are forced downloads, not inline active documents. Source hashes differ from rendered response hashes when URL substitution occurs.

## Tags and filtering

Pass optional `tags` to publish/update. Tags are trimmed, whitespace-collapsed, lowercased, and deduplicated. There may be at most 20 tags with at most 64 normalized characters each, without empty strings, control characters, or malformed Unicode. Omit tags on update to preserve them; send `[]` to clear them.

Use `list_artifacts` with an optional `tag` for an exact normalized match before limiting results. Its `tags` field contains sorted unique tags from the entire collection, not only the returned artifacts. The private gallery offers the same filter and a clear action. Artifact deletion removes its contribution to the unique-tag list.

## Pitfalls

- Anyone holding an unexpired signed URL can view it until expiration; treat the URL as a temporary bearer capability.
- Signed latest URLs show the current version; signed immutable-version URLs preserve prior snapshots.
- Unsigned artifact URLs prompt for the gallery's HTTP Basic Auth. Invalid or expired signatures do not grant access.
- Signed links expire independently of the artifact; create a fresh one with `get_signed_url` rather than republishing.
- Gallery Basic Auth and MCP bearer authentication are separate credentials; never substitute one for the other.
- CSP sandboxing may block same-origin privileges, object embeds, browser capabilities, or assumptions made by third-party scripts.
- The default HTML limit is 2 MiB. Binary attachments default to 256 MiB per file and 100 files per artifact. Use the limit returned by `get_attachment_upload_url`.
- Tool prefixes vary by harness. Resolve the tool from the `aravind_html_publisher` server namespace rather than matching only the leaf name `publish_html`.
- A successful built-in Claude artifact render does not prove this MCP published anything.

## Verification

A successful publish has all of the following:

- MCP call completed without an authentication error;
- result URL begins `https://mcp.aravindmj.in/artifact/` and includes `expires` plus `signature`;
- result contains `artifact_id`, `bytes`, `sha256`, `created_at`, `expires_at`, and `expires_in_seconds`;
- fetched HTML matches the intended document when external verification is requested.
