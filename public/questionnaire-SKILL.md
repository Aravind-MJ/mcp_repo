---
name: aravind-questionnaire-collector
description: Use when collecting answers through shareable forms.
version: 1.5.0
author: Aravind M J, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [mcp, questionnaires, forms, surveys, sqlite]
    related_skills: []
---

# Aravind Questionnaire Collector

Use the `aravind_questionnaires` MCP to create and manage questionnaires, submit attributable answers, return expiring signed answer links, and retrieve responses.

## Endpoint and trust model

- Endpoint: `https://mcp.aravindmj.in/questionnaire/mcp`
- Transport: Streamable HTTP
- Authentication: `Authorization: Bearer <shared-secret>`
- Public guide: `https://mcp.aravindmj.in/questionnaire/README.md`
- Private browser index: `https://mcp.aravindmj.in/questionnaires` (Caddy Basic Auth)

The MCP management plane requires Bearer authentication. Keep the credential provisioned by the service owner in the harness's protected secret store; never print, log, embed, or rotate it. Treat delete and update operations literally and confirm destructive intent when it was not explicit. Browser answering links are temporary bearer capabilities: anyone with an unexpired default link can answer the latest revision; explicit revision links answer one immutable revision. Authenticated MCP clients can submit directly without a signed link.

## Workflow

1. Translate the requested form into stable question IDs and supported types.
2. Call `create_questionnaire` with a concise title, optional introduction, questions, and optional presentation settings.
3. Verify the returned `questionnaire_id` is 24 alphanumeric characters and the URL includes `expires` and `signature`.
4. Give the user the returned revisionless latest URL and its expiry. Mint an exact-revision URL only when immutable historical access is requested.
5. When answering through MCP, call `submit_questionnaire_response` with the questionnaire ID, optional revision, and the complete flat answer object. Check `authentication_type` first: omit `respondent` for `anonymous`; pass the respondent name and email for `self_report`; for `email_verified`, call `request_questionnaire_email_verification`, get the six-digit code from the respondent (it can take a few minutes and may be in spam or junk), call `verify_questionnaire_email`, then submit with `response_id`, `verification_proof`, and the same respondent email.
6. Use `list_questionnaire_responses`, optionally filtered to `submitted`, to list response metadata, attribution, and IDs.
7. Use `get_questionnaire_response` for each answer body you need.
8. Close collection with `set_questionnaire_status(status="closed")`; do not delete merely to stop answers.
9. Use `delete_questionnaire` only when all revisions and responses should be permanently removed.

## Revisions

`update_questionnaire` never mutates an existing form. It creates the next immutable revision. Default signed URLs use `/questionnaire/{id}` and resolve the latest revision, so an unexpired default URL follows updates. Exact links use `/questionnaire/{id}/r/{revision}` and remain tied to their immutable revision. Responses remain separately identifiable by `revision`.

An already loaded latest page is response-scoped to the revision it displayed, so a respondent can finish safely if an update occurs mid-form. Reloading the default URL displays the newest revision.

Omit unchanged fields during an update. Use `get_questionnaire_signed_url` without `revision` for the default latest link; supply `revision` only for an exact snapshot. Latest and exact signatures are scope-bound and non-transferable. Lifetimes range from 60 seconds through one year and default to one week.

## Question types

- `short_text`, `long_text`, `email`, `url`, `phone`
- `number`, `date`, `time`, `datetime`
- `single_choice`, `multiple_choice`, `dropdown`, `yes_no`, `consent`
- `rating`, `scale`, `ranking`, `matrix`
- `file_upload`, `repeatable_rows`

Choice-like questions require options with stable `value` and human-readable `label`. Matrix questions also require rows in the same shape. Do not repurpose option values within a revision.

### Nested follow-ups

Model a follow-up under its direct parent with `children`. Add `show_when` to a child when it should appear only for named parent answers:

```json
{
  "id": "decision",
  "type": "single_choice",
  "title": "Keep the current rule?",
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

Use explicit structure and conditions rather than title numbering or adjacency. `show_when` compares with the direct parent; for multiple-choice parents, any matching selection activates the child. Omit `show_when` for an always-visible child. Keep IDs unique across all levels. Answers remain a flat ID-to-value object; inactive branches are omitted and active required children are enforced. The total 200-question limit includes nested fields, with at most eight levels.

Useful validation fields:

- Text: `min_length`, `max_length`
- Number: `min`, `max`, `step`
- Multiple choice: `min_selections`, `max_selections`
- Rating settings: `max` (3–10), `icon` (`star`, `heart`, `number`)
- Scale settings: `min`, `max`, `min_label`, `max_label`

### Image uploads

Use `file_upload` when the respondent must send a photo or screenshot, such as a receipt or a damaged item. It accepts JPEG, PNG, and WebP only. Settings: `formats` (subset of `jpeg`, `png`, `webp`; default all three), `min_files` (default 0), `max_files` (default 1, at most 10), and `max_bytes` (default 5242880, at most 10485760). Required means at least one image. The answer is an array of attachment IDs: `"receipt": ["<24-character ID>"]`.

Only the respondent's browser can upload, through the signed answer link. You cannot upload on a respondent's behalf, and `submit_questionnaire_response` cannot reference an uploaded image because each image belongs to the browser draft that uploaded it. If the user wants to answer through MCP, make the `file_upload` question optional or send them the link.

To read images back, call `get_questionnaire_response`. Its `attachments` array lists each image with `question_id`, `row_id`, `field_id`, `filename`, `content_type`, `width`, `height`, `bytes`, and a `download_url` that expires after one hour (`expires_at`). Fetch the URL to view the image. Do not share or log it, because anyone with it can download the image until it expires. Call the tool again for a fresh URL.

### Repeatable rows

Use `repeatable_rows` when the respondent lists a variable number of similar items, such as rooms, line items, or people. Give it `fields` (1 to 20, IDs unique within the group) and optional `settings`: `min_rows` (default 0), `max_rows` (default 10, at most 50), and `add_label` (default "Add row"). A field can be any ordinary type or `file_upload`. Do not nest `repeatable_rows`, and do not put `show_when` or `children` on fields or on the group.

The answer is an ordered array of rows:

```json
{ "rooms": [{ "row_id": "r1", "values": { "name": "Kitchen", "size": 12 } }] }
```

`row_id` is 1 to 40 characters from `A-Z a-z 0-9 _ -` and must be unique within the answer. Keep it stable when rows are reordered. A row has only `row_id` and `values`, and `values` uses only the group's field IDs. A required group needs at least `max(1, min_rows)` rows; an optional group takes 0 rows or at least `min_rows`. Errors name the location, for example `rooms[2].name: an answer is required`.

## Response semantics

Browser drafts are technical records with random IDs and no respondent identity; name and email are attached only at final submission. Set `authentication_type` when creating a questionnaire: `anonymous` (default, no identity accepted), `self_report` (name and email required, not checked), or `email_verified` (name self-reported, email confirmed by a one-time code). Each revision keeps its own mode, and `update_questionnaire` keeps the previous mode unless you pass one. Draft edit tokens are never exposed through management tools, are isolated to the current browser tab, and are stored only as hashes in SQLite. Response versions reject stale-tab overwrites. Drafts may contain incomplete input because autosave runs while a person types; `status="submitted"` is the reliable filter for finalized answers. Legacy submissions created before identity tracking return `respondent: null` with `identity_status: "legacy_missing"`.

## Safety

- Do not request secrets, passwords, private keys, payment card data, or unnecessary sensitive personal data in a questionnaire.
- Treat respondent names as self-asserted in every mode. Treat emails as verified only when `identity_status` is `email_verified`. Neither proves uniqueness: one email may submit several responses.
- Never ask the user to paste a verification code into a questionnaire answer, and never log or repeat a code or `verification_proof`.
- Anyone holding the shared MCP bearer token can manage questionnaires and read responses.
- A signed answer URL stops working at expiry, but already stored responses remain until deleted.
- Closing prevents new saves; deleting permanently removes all revisions and responses.
- Deleting a response or questionnaire also deletes its uploaded images. Images in submitted responses are otherwise kept.
