# Personal MCP Hub

A Node.js personal MCP service hosting multiple MCP modules under one domain. It provides authenticated HTML artifacts, questionnaire management with signed public answer links, and authenticated Jev structured decisions through OpenRouter.

## Route layout

| Route | Access | Purpose |
|---|---|---|
| `POST /artifact/mcp` | Shared bearer secret | Stateless Streamable HTTP MCP endpoint |
| `POST /artifact/<id>/attachments?filename=<encoded-basename>` | Shared bearer secret | Stream one raw binary attachment |
| `GET/HEAD /artifact/<id>/attachments/<attachment-id>?expires=...&signature=...` | Attachment-scoped signed URL | Serve attachment bytes, with video range support |
| `GET /artifact/<24-char-id>` | Signed URL or Basic Auth | Render the latest artifact version |
| `GET /artifact/<id>/versions/<n>` | Signed URL or Basic Auth | Render one immutable version snapshot |
| `GET /artifact` | Public | Non-indexed module landing page |
| `GET /artifacts` | Caddy Basic Auth | Private gallery with confirmed deletion controls |
| `POST /artifacts/<id>/delete` | Caddy Basic Auth + CSRF token | Permanently delete from the gallery |
| `GET /artifact/README.md` | Public | Secret-free cross-harness installation guide |
| `GET /artifact/SKILL.md` | Public | Companion agent skill with collision routing |
| `POST /questionnaire/mcp` | Public (no auth) | Stateless Streamable HTTP questionnaire management endpoint |
| `GET /questionnaire/<id>/r/<revision>?expires=...&signature=...` | Signed URL | Render one exact questionnaire revision |
| `POST /questionnaire/<id>/r/<revision>/responses` | Signed URL | Create one anonymous draft |
| `GET/PATCH /questionnaire/<id>/r/<revision>/responses/<response-id>` | Signed URL + edit token | Resume or autosave a draft |
| `POST /questionnaire/<id>/r/<revision>/responses/<response-id>/submit` | Signed URL + edit token | Validate, identify, and finalize one response |
| `GET /questionnaire` | Public | Non-indexed module landing page |
| `GET /questionnaire/README.md` | Public | Secret-free installation and schema guide |
| `GET /questionnaire/SKILL.md` | Public | Companion agent skill |
| `POST /jev/mcp` | Shared bearer secret | Jev typed decisions through OpenRouter |
| `GET /jev` | Public | Non-indexed module landing page |
| `GET /jev/README.md` | Public | Secret-free installation and schema guide |
| `GET /jev/SKILL.md` | Public | Companion agent skill |
| `GET /questionnaires` | Caddy Basic Auth | Private questionnaire index with links, status, and response counts |
| `GET /questionnaires/<id>/responses[/<response-id>]` | Caddy Basic Auth | Inspect collected response metadata and answers |
| `POST /questionnaires/<id>/{sign,status,delete}` | Caddy Basic Auth + action-scoped CSRF token | Mint links, open/close, or permanently delete from the index |
| `GET /logo.svg` | Public | Full MCP brand mark |
| `GET /favicon.svg` | Public | Browser/favicon brand mark |
| `GET /healthz` | Public | Health probe |

Future MCPs should use sibling namespaces such as `/<module>/mcp`; see `docs/ADDING_MODULES.md`.

Public installation URLs:

- `https://mcp.aravindmj.in/artifact/README.md`
- `https://mcp.aravindmj.in/artifact/SKILL.md`
- `https://mcp.aravindmj.in/questionnaire/README.md`
- `https://mcp.aravindmj.in/questionnaire/SKILL.md`
- `https://mcp.aravindmj.in/jev/README.md`
- `https://mcp.aravindmj.in/jev/SKILL.md`

Use the local MCP name `aravind_html_publisher` in other harnesses. The companion skill distinguishes this externally hosted publisher from Claude's built-in Artifacts feature: public/shareable-link requests use this MCP; Claude-native in-chat canvas requests use the built-in feature.

Gallery deletion is intentionally two-step: hover a card and press the top-right trash button, then confirm in the modal. Touch devices show the button persistently. The form carries an HMAC confirmation token and the entire `/artifacts/*` namespace remains behind Caddy Basic Auth.

The private questionnaire index is available at `https://mcp.aravindmj.in/questionnaires` behind the same Caddy Basic Auth. It supports copying fresh one-week links, opening or closing collection, browsing human-readable responses, deleting individual responses, and confirmed questionnaire deletion. Node accepts these routes only when Caddy injects its narrow trusted-header marker; each state-changing form also requires a domain-separated HMAC CSRF token.

Successful deletion uses a signed, short-lived, HTTP-only flash cookie. The gallery consumes and clears it on the first render, so the success message is absent on reload and never appears in the URL.

## Artifact tools

- `publish_html(html, title?, tags?)` — publishes HTML and returns one-week signed latest/version URLs plus SHA-256 metadata.
- `update_artifact(artifact_id, html, title?, tags?)` — creates a new version while preserving artifact identity and returns fresh signed URLs.
- `get_signed_url(artifact_id, expires_in_seconds?, version?)` — creates a fresh expiring share URL; defaults to one week.
- `get_attachment_upload_url(artifact_id)` returns the authenticated streaming upload endpoint, byte limit, and existing attachment references.
- `list_artifacts(limit?, tag?)` returns recent private metadata filtered before limiting, plus all unique tags across the entire collection.
- `delete_artifact(artifact_id)` permanently removes one artifact, every version, and its attachments.

## Artifact attachments and tags

See [the public upload and tagging guide](public/README.md#attachment-uploads) for the client workflow and exact semantics. Publish an initial page, get its upload endpoint with `get_attachment_upload_url`, stream raw binary using its 600-second artifact-scoped capability URL without exposing the shared Bearer credential, and place the returned `artifact-attachment:ID` reference in a follow-up HTML version. The response lists existing uploads so clients can recover references without re-uploading.

Attachments are immutable, artifact-owned files under `data/artifact/attachments/<artifact-id>/`. Every read checks an attachment-specific HMAC and expiry, then checks that its parent artifact still exists. Signed-page assets inherit that page's expiry; owner Basic Auth views receive one-hour assets. Asset signatures cannot authorize HTML pages or other files. No directory is exposed by a static file server. Non-allowlisted MIME types are forced downloads; all asset responses include `nosniff` and sandbox headers. HEAD and ranges support videos without reading entire files into memory. Pages with substituted references and binary responses use `private, no-store` instead of immutable caching. Metadata hashes continue to identify the stored source.

Defaults are 256 MiB per file and 100 files per artifact, controlled by `ARTIFACT_MAX_ATTACHMENT_BYTES` and `ARTIFACT_MAX_ATTACHMENTS`. HTML has its own independent limit. Streaming writes count actual bytes, use private temporary files, and remove partial files on handled failure. Upload, update, and deletion share a per-artifact lock. Run one Node writer for a data directory. Deletion removes attachment bytes and all HTML versions. Uploaded but unreferenced files remain until artifact deletion.

Tags are normalized private metadata. Publish defaults to `[]`; updates preserve omitted tags and clear on `[]`. Listing filters before limiting and returns the sorted unique tags from the entire current collection. The private gallery displays accessible filter chips, clear, and no-results states. Historical untagged metadata requires no migration.

### Reverse-proxy requirements for attachments

Before enabling this release publicly, route `POST /artifact/<id>/attachments` and `GET/HEAD /artifact/<id>/attachments/<attachment-id>` to Node without a separate Basic Auth challenge. Node enforces expiring artifact-scoped capabilities or optional Bearer authentication on uploads and file-scoped signatures on reads. Match only the two attachment route shapes; do not broaden a public matcher to the entire artifact namespace. Keep `/artifacts` and owner page fallbacks behind existing Basic Auth. Strip client-provided `X-Artifact-Basic-Auth` and `X-Questionnaire-Basic-Auth` in the public fallback proxy; inject trusted markers only after Basic Auth in private branches, as for existing artifact routes. Never serve the attachment storage directory directly or cache signed asset responses.

The proxy must preserve the query string, Authorization, Content-Type, Range, and If-Range headers, and permit a streaming body up to the configured attachment limit. Align proxy body-size limits and request timeouts with the expected video size. Review these live proxy settings during deployment; no proxy configuration is stored or changed by this repository patch.

## Questionnaire tools

- `create_questionnaire` — creates revision 1 and returns a one-week signed answer URL.
- `update_questionnaire` — creates a new immutable revision while preserving prior links and responses.
- `get_questionnaire` / `list_questionnaires` — retrieves definitions, status, and response counts.
- `get_questionnaire_signed_url` — mints an exact-revision link for 60 seconds through one year.
- `submit_questionnaire_response` — atomically submits complete answers with respondent name and email through MCP.
- `set_questionnaire_status` — opens or closes response collection.
- `delete_questionnaire` — removes every revision and response.
- `list_questionnaire_responses` — lists bounded response metadata; `get_questionnaire_response` retrieves one answer body by ID.
- `delete_questionnaire_response` — permanently removes one response.

Supported types: short/long text, email, URL, phone, number, date, time, date-time, single/multiple choice, dropdown, yes/no, consent, rating, scale, ranking, and matrix. The answering UI is responsive, keyboard accessible, progress-aware, dark-mode aware, and autosaves incomplete anonymous drafts before strict final validation and respondent attribution.

## Jev tool

- `make_decisions` — evaluates one text or structured state against independent `noul`, `choice`, and `score` questions in parallel through OpenRouter's Decisions API. It defaults to pinned `typesafe/jev-1.13`; `~typesafe/jev-latest` is available only for deliberate model drift.

The upstream OpenRouter key is read from `secrets/openrouter-api-key` inside the runtime directory on every call, so rotation takes effect without embedding it in source or client configuration. Use `scripts/setup-jev-openrouter.sh` to verify, install, or rotate it with hidden input, mode `0600`, and health verification; the running service picks it up without a restart.

## Security model

- Node binds only to `127.0.0.1:4330`; Caddy is the only public ingress.
- Artifact, Questionnaire, and Jev MCP calls require the common bearer secret. The separate OpenRouter key used by Jev never leaves the server.
- The shared secret is stored outside the repository at `/data/mcp-hub/secrets/shared-secret`, mode `0600`; its directory is `0700`.
- The secret is read on every MCP request, allowing atomic rotation without restarting Node.
- Secret comparison uses Node's constant-time `crypto.timingSafeEqual`.
- Artifact IDs use 24 uniformly random base62 characters (about 143 bits) with no punctuation.
- Artifact and version pages require either a valid HMAC-signed URL or the gallery's HTTP Basic Auth. Signed URLs default to seven days and may be requested for 60 seconds through one year.
- Artifact responses include `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex`.
- HTML and metadata use atomic writes and mode `0600`.
- Latest and version-specific HTML are served with CSP sandboxing, `nosniff`, no-referrer, and a restrictive Permissions Policy. Version URLs are immutable; stable artifact URLs revalidate to the latest version.
- Default HTML limit: 2 MiB.
- Questionnaire IDs and response IDs are 24 uniformly random base62 characters. Signed links bind the questionnaire ID, exact revision, and expiry.
- Questionnaire definitions, revisions, answers, and submitted respondent names/emails are stored in `/data/mcp-hub/data/questionnaire/questionnaires.sqlite3` using foreign keys, WAL mode, full synchronization, and private filesystem permissions.
- Storage is bounded by default to 100 immutable revisions and 10,000 response rows per questionnaire, plus 256 KiB of serialized answers per response. Operators may adjust these with `QUESTIONNAIRE_MAX_REVISIONS`, `QUESTIONNAIRE_MAX_RESPONSES`, and `QUESTIONNAIRE_MAX_ANSWER_BYTES`.
- Draft edit tokens are returned only to the answering browser, isolated to the current tab through session storage, and persisted server-side only as SHA-256 hashes. Management tools never return them. Response versions prevent a stale duplicated tab from silently overwriting newer answers.
- All questionnaire pages and response APIs require an unexpired signed URL. Response resume/autosave/submit also requires the draft edit token. Cross-site unsafe requests are rejected.

Anyone who has an artifact URL can view it. Never publish secrets or private data in an artifact.

## Local development

Requires Node.js 22+.

```bash
npm install
npm test
MCP_HUB_RUNTIME_DIR="$PWD/.runtime" npm run rotate-secret
MCP_HUB_RUNTIME_DIR="$PWD/.runtime" MCP_HUB_PUBLIC_BASE_URL=http://127.0.0.1:4330 npm start
```

Do not put secrets in `.env` or shell startup files. For platform-managed environment overrides, use **hPanel → Hermes Agent → Dashboard → Environment**. The deployed service uses the protected secret file by default.

## Operations

```bash
npm test
MCP_HUB_RUNTIME_DIR=/data/mcp-hub node /data/mcp-hub/app/scripts/rotate-secret.js
curl -fsS http://127.0.0.1:4330/healthz
hermes mcp test aravind_html_publisher
hermes mcp test aravind_questionnaires
hermes mcp test aravind_jev_decisions
```

The questionnaire SQLite database is persistent runtime state, not release content. Back up `/data/mcp-hub/data/questionnaire/questionnaires.sqlite3` with SQLite's online backup mechanism while the service is running, or stop the service and copy the database together with any `-wal` and `-shm` sidecars. Never replace `/data/mcp-hub/data` during an application deployment.

### Ask an agent to update installed user-scope skills

The Node updater discovers existing user-scope copies across Hermes, Cursor, OpenCode, Claude Code, and Codex. It never creates a missing harness installation. Its generated prompt pins the downloaded skill by SHA-256 and forbids credential/config changes.

```bash
# Inspect detected installations and the exact agent prompt; no mutation
npm run update-harness-skills -- --dry-run

# Ask Cursor Agent to update every detected user-scope copy
npm run update-harness-skills -- --run --agent cursor

# Alternative agent runners
npm run update-harness-skills -- --run --agent opencode
npm run update-harness-skills -- --run --agent hermes
```

Cursor is the default runner. The script exits without invoking an agent when no existing user-scope copies are found.

The production rotation command atomically updates both the service secret and Hermes' protected `MCP_ARAVIND_HTML_PUBLISHER_API_KEY` credential without printing either value. It also removes the retired `MCP_ARTIFACT_API_KEY` entry. Start a new Hermes session after rotation so long-lived clients cannot retain the prior header.

A no-agent Hermes cron job runs `scripts/watchdog.sh` once per minute. The wrapper executes the Node watchdog; no Python runtime is used.
