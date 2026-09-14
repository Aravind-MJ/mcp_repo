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
5. **Enable the complete toolset.** Enable all eleven tools listed below rather than selecting only creation tools.
6. **Install the companion skill.** If the harness supports agent skills, fetch `https://mcp.aravindmj.in/questionnaire/SKILL.md`, validate that its frontmatter name is `aravind-questionnaire-collector`, and install it through the harness's native user-level skill mechanism. Update an existing copy rather than creating another one.
7. **Reload the tool schema.** Reconnect the MCP server or start a new agent session, according to the harness's lifecycle.
8. **Verify before reporting success.** Confirm initialization and all eleven tools. Create a harmless disposable questionnaire, exercise browser submission and `submit_questionnaire_response`, retrieve both identified responses, delete the questionnaire, and confirm it is absent from `list_questionnaires`.
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

Enter the credential provisioned by the service owner only at the hidden credential prompt, enable all eleven tools, and start a new session so the discovered tools enter the session's tool schema. For a Hermes deployment, environment variables are managed in **hPanel → Hermes Agent → Dashboard → Environment**, not shell startup files or project `.env` files.

## Tools

| Tool | Purpose |
|---|---|
| `create_questionnaire` | Create revision 1 and return a one-week signed latest-revision answer URL. |
| `update_questionnaire` | Create a new immutable revision and return the stable latest-revision URL; omitted fields are preserved. |
| `get_questionnaire` | Read the current or an exact revision, response counts, and a matching fresh signed URL. |
| `list_questionnaires` | List current questionnaires and counts with pagination. |
| `get_questionnaire_signed_url` | Mint a latest-revision link by default, or an exact-revision link when `revision` is supplied, valid from 60 seconds through one year. |
| `submit_questionnaire_response` | Submit complete answers with required respondent name and email directly through MCP; no browser draft or signed link is needed. |
| `set_questionnaire_status` | Open or close response collection without deleting data. |
| `delete_questionnaire` | Permanently delete all revisions and responses. |
| `list_questionnaire_responses` | List bounded response metadata, optionally by revision or status. |
| `get_questionnaire_response` | Read one response, its respondent attribution, and answers by ID. |
| `delete_questionnaire_response` | Permanently delete one response. |

## Supported answer types

- Text: `short_text`, `long_text`, `email`, `url`, `phone`
- Numeric and temporal: `number`, `date`, `time`, `datetime`
- Choice: `single_choice`, `multiple_choice`, `dropdown`, `yes_no`, `consent`
- Structured: `rating`, `scale`, `ranking`, `matrix`

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
- The browser creates an anonymous draft only after the respondent starts answering; name and email are not included in autosaves.
- A random edit token is isolated to the current browser tab in session storage; only its SHA-256 hash is stored in SQLite. Optimistic response versions reject stale-tab overwrites.
- Autosave accepts in-progress typing. Final submission enforces required fields, formats, ranges, selection limits, and a respondent name and email.
- `submit_questionnaire_response` creates one final identified response atomically. Omit `revision` to answer the current revision, or supply an exact revision.
- The service does not create respondent accounts or cookies. It stores the submitted name and email with the finalized response for attribution.
- Closing a questionnaire blocks draft creation and updates while retaining all definitions and responses.
- Updating a questionnaire creates a new revision. Existing default links begin showing it automatically; explicit `/r/{revision}` links keep showing their exact prior revision.

## Verification

A valid installation should discover all eleven tools. Create a disposable questionnaire, submit once through its signed browser flow and once with `submit_questionnaire_response`, confirm both list entries include respondent attribution, retrieve their answers with `get_questionnaire_response`, then delete the disposable questionnaire.
