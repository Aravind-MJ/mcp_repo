# Aravind Questionnaire Collector MCP

Create and manage revisioned questionnaires, collect attributable submissions, share expiring signed answer links, and retrieve responses stored in SQLite.

Give this URL to an agent in any MCP-capable harness. The agent should identify its own harness and complete the installation using that harness's native MCP and skill mechanisms.

- **MCP endpoint:** `https://mcp.aravindmj.in/questionnaire/mcp`
- **Transport:** MCP Streamable HTTP
- **Authentication:** `Authorization: Bearer <shared-secret>`
- **Recommended server name:** `aravind_questionnaires`
- **Companion skill:** `https://mcp.aravindmj.in/questionnaire/SKILL.md`
- **Health check:** `https://mcp.aravindmj.in/healthz`
- **Private index:** `https://mcp.aravindmj.in/questionnaires` (Caddy Basic Auth)

> The MCP control endpoint requires Bearer authentication. Authenticated clients can create, list, update, close, answer, inspect responses for, or delete questionnaires. Public browser answering pages still require an unexpired HMAC-signed URL; direct MCP submissions do not.

The browser index is separately protected by Caddy Basic Auth. It lists questionnaires and response counts, copies fresh one-week links, opens or closes collection, renders answers for review, and provides confirmed deletion controls. The Basic Auth credential remains distinct from the MCP Bearer credential.

## Harness-neutral self-installation

If you are an agent reading this guide, install the service in the harness where you are currently running:

1. **Identify the harness and scope.** Inspect the current runtime, its MCP help/documentation, and its existing MCP configuration. Use the harness's native user-level MCP configuration unless the user explicitly requests a project/workspace-only installation.
2. **Check for an existing registration.** Look for the exact server name `aravind_questionnaires`. If it already exists, update it in place instead of creating a duplicate.
3. **Register the remote server.** Configure MCP Streamable HTTP at `https://mcp.aravindmj.in/questionnaire/mcp` under the exact name `aravind_questionnaires`.
4. **Set authentication correctly.** Configure `Authorization: Bearer <shared-secret>` on every request with the credential provisioned by the service owner. Do not invent, expose, or rotate credentials. If it is unavailable, stop and ask Aravind to configure it securely.
5. **Enable the complete toolset.** Enable all thirteen tools listed below rather than selecting only creation tools.
6. **Install the companion skill.** If the harness supports agent skills, fetch `https://mcp.aravindmj.in/questionnaire/SKILL.md`, validate that its frontmatter name is `aravind-questionnaire-collector`, and install it through the harness's native user-level skill mechanism. Update an existing copy rather than creating another one.
7. **Reload the tool schema.** Reconnect the MCP server or start a new agent session, according to the harness's lifecycle.
8. **Verify before reporting success.** Confirm initialization and all thirteen tools. Create a harmless disposable questionnaire, exercise browser submission and `submit_questionnaire_response`, retrieve both identified responses, delete the questionnaire, and confirm it is absent from `list_questionnaires`.
9. **Report the result.** State the harness, installation scope, local server name, discovered tools, skill location if applicable, and smoke-test cleanup result.

Use the current harness's native CLI, settings UI, or configuration file. Do not copy commands for another harness merely because they appear in this guide.

## Configuration adaptation

- **CLI-based harness:** inspect its current MCP `add`, `list`, and `test` help, then use those native commands.
- **JSON, YAML, or TOML harness:** adapt the canonical fields below to its schema while preserving the exact server name, URL, transport, and authorization header.
- **GUI-based harness:** add a remote/HTTP MCP server with the same values and select the protected Bearer credential provisioned by the service owner.
- **Harness without skill support:** install the MCP alone and retain this guide as usage reference.

Canonical configuration shape:

```json
{
  "mcpServers": {
    "aravind_questionnaires": {
      "type": "http",
      "url": "https://mcp.aravindmj.in/questionnaire/mcp",
      "headers": {
        "Authorization": "Bearer ${ARAVIND_QUESTIONNAIRE_MCP_TOKEN}"
      }
    }
  }
}
```

Field names vary by harness. Preserve the semantics rather than forcing this JSON shape into an incompatible configuration format.

## Hermes Agent example

For Hermes:

```text
hermes mcp add aravind_questionnaires \
  --url https://mcp.aravindmj.in/questionnaire/mcp \
  --auth header

hermes mcp test aravind_questionnaires
```

Enter the credential provisioned by the service owner only at the hidden credential prompt, enable all thirteen tools, and start a new session so the discovered tools enter the session's tool schema. For a Hermes deployment, environment variables are managed in **hPanel → Hermes Agent → Dashboard → Environment**, not shell startup files or project `.env` files.

## Tools

| Tool | Purpose |
|---|---|
| `create_questionnaire` | Create revision 1 and return a one-week signed latest-revision answer URL. |
| `update_questionnaire` | Create a new immutable revision and return the stable latest-revision URL; omitted fields are preserved. |
| `get_questionnaire` | Read the current or an exact revision, response counts, and a matching fresh signed URL. |
| `list_questionnaires` | List current questionnaires and counts with pagination. |
| `get_questionnaire_signed_url` | Mint a latest-revision link by default, or an exact-revision link when `revision` is supplied, valid from 60 seconds through one year. |
| `submit_questionnaire_response` | Submit complete answers directly through MCP. `anonymous` takes no respondent, `self_report` requires name and email, and `email_verified` also needs `response_id` and `verification_proof`. |
| `request_questionnaire_email_verification` | For `email_verified` questionnaires: email a six-digit code to the respondent and return the pending `response_id`. Pass that `response_id` again to resend or change the email. |
| `verify_questionnaire_email` | Check the code the respondent received and return a single-use `verification_proof` for that response and email. |
| `set_questionnaire_status` | Open or close response collection without deleting data. |
| `delete_questionnaire` | Permanently delete all revisions and responses. |
| `list_questionnaire_responses` | List bounded response metadata, optionally by revision or status. |
| `get_questionnaire_response` | Read one response, its respondent attribution, and answers by ID. Each uploaded image comes with a `download_url` that expires after one hour. |
| `delete_questionnaire_response` | Permanently delete one response. |

## Supported answer types

- Text: `short_text`, `long_text`, `email`, `url`, `phone`
- Numeric and temporal: `number`, `date`, `time`, `datetime`
- Choice: `single_choice`, `multiple_choice`, `dropdown`, `yes_no`, `consent`
- Structured: `rating`, `scale`, `ranking`, `matrix`
- Images and groups: `file_upload`, `repeatable_rows`

Every question has a stable `id`, `type`, `title`, optional `description`, and optional `required`. Choice, ranking, and matrix questions use `{ "value", "label", "description?" }` option objects. Text/number/multiple-choice validation and rating/scale settings are supported.

## Nested and conditional follow-ups

Put follow-up fields in a parent's `children` array. A child may include `show_when`, an array of direct-parent answer values that activate it. For a multiple-choice parent, any selected matching value activates the child. Without `show_when`, the child is always shown beneath its parent.

```json
{
  "id": "decision",
  "type": "single_choice",
  "title": "Keep the current rule?",
  "required": true,
  "options": [
    { "value": "keep", "label": "Keep it" },
    { "value": "change", "label": "Change it" }
  ],
  "children": [
    {
      "id": "change_detail",
      "type": "long_text",
      "title": "What should change?",
      "required": true,
      "show_when": ["change"]
    }
  ]
}
```

Conditions are explicit; numbering and adjacent placement never imply a relationship. IDs are unique across the entire tree, nesting is limited to eight levels, and the 200-question limit includes every nested field. Response answer objects remain flat by stable ID. Inactive branches are omitted from autosaves and submissions, and required validation applies only while a child is active.

## File uploads

A `file_upload` question collects JPEG, PNG, or WebP images. Its optional `settings`:

| Setting | Default | Allowed |
|---|---|---|
| `formats` | `["jpeg", "png", "webp"]` | Any non-empty subset of `jpeg`, `png`, `webp`. SVG is never accepted. |
| `min_files` | `0` | `0` through `max_files` |
| `max_files` | `1` | `1` through `10` |
| `max_bytes` | `5242880` (5 MiB) | Up to `10485760` (10 MiB) per image |

A required `file_upload` question needs at least one image.

```json
{
  "id": "receipt",
  "type": "file_upload",
  "title": "Photo of the receipt",
  "required": true,
  "settings": { "formats": ["jpeg", "png"], "max_files": 3 }
}
```

The answer is an array of attachment IDs:

```json
{ "receipt": ["Ab3dEf6hIj9kLm2nOp5qRs8t"] }
```

Only the answering browser can upload. It needs a draft and its edit token, and it works in every authentication mode. An attachment belongs to the response that uploaded it, and the management bearer token does not bypass that. An MCP submission therefore cannot reference an upload; use an optional `file_upload` question if some respondents will answer through MCP.

The browser flow uses the signed questionnaire URL and the `X-Questionnaire-Edit-Token` header on every call:

1. `POST .../responses/{response_id}/attachments/capability` with JSON `{ "question_id", "row_id"?, "field_id"? }`. The reply holds `upload_expires` and `upload_signature`, valid for 5 minutes and bound to that response, revision, question, row, and field.
2. `POST .../responses/{response_id}/attachments?question_id=...&row_id=...&field_id=...&filename=...&upload_expires=...&upload_signature=...` with the raw image as the body. The reply holds `attachment_id`, `filename`, `content_type`, `width`, `height`, and `bytes`.
3. `GET .../responses/{response_id}/attachments/{attachment_id}` previews an image the draft owns.
4. Autosave or submit the answer with the returned IDs.

The server decodes each image and re-encodes it. That strips EXIF, GPS, ICC, and all other metadata, applies the EXIF orientation, and keeps only the first frame of an animated image. The declared `Content-Type` must match the real bytes. Images may be at most 10,000 px per side and 40,000,000 px in total.

### Upload limits

| Limit | Value | Error |
|---|---|---|
| Concurrent uploads | 2 per response, 8 per questionnaire, 4 per source IP, 16 in total | `429` |
| Stored images per response | 100 attachments or 100 MiB | `409` |
| Stored images per questionnaire | 5,000 attachments or 2 GiB | `409` |
| Image size or dimensions | `max_bytes`; 10,000 px per side; 40,000,000 px in total | `413` |
| Format | Must be one of the question's `formats` and match the declared type | `415` |
| Upload capability | 5 minutes | `403` |
| Upload duration | 2 minutes | `408` |

Each upload reserves its slot in one SQLite `BEGIN IMMEDIATE` transaction. An abort or failure releases the slot and deletes the partial file.

### Retention

| Image state | Kept until |
|---|---|
| Partial upload | Deleted when the upload fails |
| In a draft | The draft expires after 7 days without an autosave or upload |
| Unreferenced or replaced | Deleted after a 24-hour grace period |
| In a submitted response | Someone deletes the response or the questionnaire |

Deleting a response or questionnaire deletes its files. An hourly sweep inside the service applies these rules and removes orphan files. Images are stored privately under `<data>/questionnaire/attachments/<questionnaire-id>/` and are never served as static files.

### Reading images back

`get_questionnaire_response` returns an `attachments` array with one entry for each image the answers reference:

```json
{
  "attachment_id": "Ab3dEf6hIj9kLm2nOp5qRs8t",
  "question_id": "rooms",
  "row_id": "r1",
  "field_id": "photo",
  "filename": "kitchen.png",
  "content_type": "image/png",
  "width": 1600,
  "height": 1200,
  "bytes": 482113,
  "sha256": "<64 hex characters>",
  "download_url": "https://mcp.aravindmj.in/questionnaire/{id}/attachments/{attachment_id}?expires=...&signature=...",
  "expires_at": "2026-10-09T13:00:00.000Z"
}
```

`row_id` and `field_id` are `null` for a top-level question. The download URL works for one hour without the bearer token, so treat it as a secret. Call `get_questionnaire_response` again for a fresh one. Downloads send `nosniff`, a sandbox CSP, `private, no-store`, and `noindex`. The private index shows the same images as thumbnails behind Basic Auth.

## Repeatable rows

A `repeatable_rows` question collects a list of rows with the same fields, such as rooms in a house or items in an order. Its optional `settings`:

| Setting | Default | Allowed |
|---|---|---|
| `min_rows` | `0` | `0` through `max_rows` |
| `max_rows` | `10` | Up to `50` |
| `add_label` | `"Add row"` | Button text |

`fields` holds 1 to 20 fields with IDs that are unique within the group. A field can use any ordinary type or `file_upload`. Fields cannot be `repeatable_rows`, cannot use `show_when` or `children`, and the group itself cannot have `children`.

```json
{
  "id": "rooms",
  "type": "repeatable_rows",
  "title": "Rooms",
  "required": true,
  "settings": { "min_rows": 1, "max_rows": 5, "add_label": "Add a room" },
  "fields": [
    { "id": "name", "type": "short_text", "title": "Room name", "required": true },
    { "id": "size", "type": "number", "title": "Size (m²)", "validation": { "min": 1 } },
    { "id": "photo", "type": "file_upload", "title": "Photo", "settings": { "max_files": 3 } }
  ]
}
```

The answer is an ordered array of rows. Each `values` object uses the field IDs and each field's normal answer shape:

```json
{
  "rooms": [
    { "row_id": "r1", "values": { "name": "Kitchen", "size": 12, "photo": ["Ab3dEf6hIj9kLm2nOp5qRs8t"] } },
    { "row_id": "r2", "values": { "name": "Den" } }
  ]
}
```

Rules:

- `row_id` is 1 to 40 characters of `A-Z`, `a-z`, `0-9`, `_`, or `-`, unique within the answer. Keep it the same when rows move; uploads in a row are bound to its `row_id`.
- Rows stay in the submitted order.
- A row may contain only `row_id` and `values`. Unknown field IDs are rejected.
- A required group needs at least `max(1, min_rows)` rows. An optional group accepts 0 rows or at least `min_rows`.
- Autosave checks each field's format and validation in every row. Submission also enforces required fields and the row count.

Error messages name the row and field. `rooms[2].name: an answer is required` points at a field in the second row, `rooms[1]: row_id must be unique` at a whole row, and `rooms: add at least 1 row` at the group.

## Example

```json
{
  "title": "Product feedback",
  "description": "Three quick questions.",
  "questions": [
    { "id": "name", "type": "short_text", "title": "Your name", "required": true },
    {
      "id": "priority",
      "type": "single_choice",
      "title": "What matters most?",
      "required": true,
      "options": [
        { "value": "speed", "label": "Speed" },
        { "value": "quality", "label": "Quality" }
      ]
    },
    { "id": "notes", "type": "long_text", "title": "Anything else?" }
  ],
  "settings": {
    "submit_label": "Send feedback",
    "completion_message": "Thanks—your feedback is recorded.",
    "accent_color": "#6d5dfc",
    "show_progress": true
  }
}
```

## Answering and autosave semantics

- The default signed link is revisionless (`/questionnaire/{id}`), is bound to the `latest` scope, and resolves the newest revision on every request until expiry.
- Supplying `revision` creates an immutable `/questionnaire/{id}/r/{revision}` link bound to that exact revision. Latest and exact signatures cannot be moved between scopes.
- Each loaded latest page receives a response-only scope bound to the revision it displayed, so an in-progress tab can autosave and submit safely if a newer revision is published. Reloading the default URL displays the newest revision.
- The browser creates an identity-free draft only after the respondent starts answering; name and email are never included in autosaves.
- A random edit token is isolated to the current browser tab in session storage; only its SHA-256 hash is stored in SQLite. Optimistic response versions reject stale-tab overwrites.
- Autosave accepts in-progress typing. Final submission enforces required fields, formats, ranges, selection limits, and the identity rules of the questionnaire's authentication mode.
- `submit_questionnaire_response` creates one final response atomically. Omit `revision` to answer the current revision, or supply an exact revision.
- The service does not create respondent accounts or cookies.

## Authentication modes

Each revision has an `authentication_type`. New questionnaires default to `anonymous`. `update_questionnaire` keeps the previous mode unless you pass a new one, and the change applies only to the new revision. Revisions created before modes existed are `self_report`.

| Mode | What the respondent provides | What is stored |
|---|---|---|
| `anonymous` | Nothing. Sending a name or email is rejected. Answers to email or phone questions are still allowed. | `respondent: null` |
| `self_report` | Name and email, typed in a dialog after the answers pass validation. Neither is checked. | Name and email, `identity_status: "self_reported"` |
| `email_verified` | Name (self-reported) and an email confirmed with a six-digit code. | Name, email, `email_verified_at`, `identity_status: "email_verified"` |

Responses include `authentication_type`, `identity_status` (`anonymous`, `self_reported`, `email_verified`, `legacy_missing`, or `pending` for drafts), `respondent`, and `email_verified_at` (set only for verified submissions). `legacy_missing` marks submissions made before identity was collected.

Email verification rules, the same for the browser and MCP:

- Codes are six random digits, expire after 10 minutes, and work once. Five wrong entries lock the code until a new one is sent.
- A new code can be requested after 60 seconds. Sending a new code, or changing the email, invalidates the earlier one.
- At most 5 codes per email per questionnaire per hour, and 20 per client IP per hour. Failed deliveries count toward both limits.
- A correct code returns a `verification_proof`, valid for 30 minutes. It is bound to the questionnaire, revision, response, and email, and is consumed in the same transaction that accepts the submission.
- Codes and proofs are stored only as SHA-256 hashes. Send-rate records keep hashed email and IP values only.
- If email delivery is not configured or the provider rejects the message, the request fails with an error that says no code was sent. There is no fallback to self-reporting.
- The same email may verify any number of separate responses.

MCP flow for `email_verified`:

1. `request_questionnaire_email_verification` with `questionnaire_id` and `respondent`. Keep the returned `response_id`.
2. Ask the respondent for the code from their inbox. It can take a few minutes and may land in spam or junk.
3. `verify_questionnaire_email` with `response_id`, `email`, and `code`.
4. `submit_questionnaire_response` with `response_id`, `verification_proof`, the same `respondent`, and `answers`.

The bearer token does not skip any of these steps.
- Closing a questionnaire blocks draft creation and updates while retaining all definitions and responses.
- Updating a questionnaire creates a new revision. Existing default links begin showing it automatically; explicit `/r/{revision}` links keep showing their exact prior revision.

## Verification

A valid installation should discover all thirteen tools. Create a disposable `self_report` questionnaire, submit once through its signed browser flow and once with `submit_questionnaire_response`, confirm both list entries include respondent attribution, retrieve their answers with `get_questionnaire_response`, then delete the disposable questionnaire.
