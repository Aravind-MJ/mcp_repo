# Aravind Decision Maker MCP

This is the public installation guide for Aravind's private decision maker MCP. It calls Cloudflare's Clef Flash model through OpenRouter while keeping the upstream OpenRouter API key on the server.

- **MCP endpoint:** `https://mcp.aravindmj.in/decisions/mcp`
- **Transport:** MCP Streamable HTTP
- **Authentication:** `Authorization: Bearer <shared MCP credential>`
- **Recommended server name:** `aravind_decision_maker`
- **Companion skill:** `https://mcp.aravindmj.in/decisions/SKILL.md`
- **Model:** `cloudflare/clef-flash`
- **Upstream API:** `POST https://openrouter.ai/api/alpha/decisions`

The MCP bearer credential and upstream OpenRouter key are deliberately not published. Aravind must configure them through protected secret mechanisms. Never paste either credential into prompts, logs, source control, shell history, or this guide.

## Harness-neutral self-installation

1. Identify the current harness and its native user-level MCP configuration.
2. Check for `aravind_decision_maker`; update it in place rather than creating a duplicate.
3. Register Streamable HTTP endpoint `https://mcp.aravindmj.in/decisions/mcp` under that exact name.
4. Configure the same protected bearer credential used by Aravind's other authenticated MCP modules. Send it in the `Authorization` header on every MCP request.
5. Enable the complete toolset: exactly `make_decisions`.
6. Install `https://mcp.aravindmj.in/decisions/SKILL.md` through the harness's native user-level skill mechanism. Validate frontmatter name `aravind-decision-maker` and update an existing copy rather than duplicating it.
7. Reconnect or begin a new agent session so the tool schema reloads.
8. Verify authenticated initialization and tool discovery. Make one harmless decision request and inspect its typed answer, model, provider, and usage fields.
9. Report the harness, scope, server name, discovered tool, skill location, and smoke-test result without printing credentials.

Canonical shape, adapted to the harness's own schema:

```json
{
  "mcpServers": {
    "aravind_decision_maker": {
      "type": "http",
      "url": "https://mcp.aravindmj.in/decisions/mcp",
      "headers": {
        "Authorization": "Bearer ${ARAVIND_MCP_SHARED_TOKEN}"
      }
    }
  }
}
```

For Hermes Agent, use the hidden credential prompt:

```text
hermes mcp add aravind_decision_maker \
  --url https://mcp.aravindmj.in/decisions/mcp \
  --auth header
hermes mcp test aravind_decision_maker
```

## Tool

### `make_decisions`

Send one shared `state` and one or more independent typed questions. Questions are evaluated in parallel. Use at most 64 questions, with IDs of at most 100 letters, digits, underscores, or hyphens. Keep state short: Cloudflare currently truncates text state to roughly its first 2,000 tokens.

```json
{
  "model": "cloudflare/clef-flash",
  "state": {
    "customer_tier": "enterprise",
    "ticket": "Checkout is blank after clicking Pay."
  },
  "questions": {
    "is_bug": {
      "type": "noul",
      "instructions": "Is the customer reporting a software defect?",
      "criteria": {
        "true": "Broken or unexpected product behavior.",
        "false": "A question or feature request."
      }
    },
    "team": {
      "type": "choice",
      "instructions": "Which team should own this ticket?",
      "criteria": {
        "payments": "Checkout, billing, or payment processing.",
        "frontend": "Rendering, layout, or browser compatibility."
      }
    },
    "urgency": {
      "type": "score",
      "instructions": "How urgent is this ticket?",
      "criteria": ["Can wait", "Fix this week", "Blocking revenue"]
    }
  }
}
```

`noul` returns a probability from 0 to 1. `choice` returns a declared option, probabilities, and usually confidence. `score` returns a probability-weighted position over the ordered criteria, a legend, probabilities, and usually confidence. Responses also include the served model identifier, provider, token usage, and cost when OpenRouter supplies them.

Supported models are `cloudflare/clef-flash` and `typesafe/jev-1.13`. Choose the default in the protected [log dashboard](https://mcp.aravindmj.in/decisions/logs). Changes persist across restarts and affect subsequent calls that omit `model`. An explicit MCP `model` overrides the dashboard for that call only. Clef Flash is the initial default. Neither selection automatically falls back to the other model. Re-evaluate thresholds when changing models.

## Security and operating boundaries

- MCP clients never receive the OpenRouter API key. The service reads it from a protected runtime file for every request, so key rotation does not require code changes.
- Decision data is sent to OpenRouter and its upstream provider. Do not send secrets or data that policy forbids sharing with those processors.
- The hub keeps each tool call's full arguments and result in a private audit log behind the hub's Basic Auth. Do not send data that must not be retained.
- Decision models return a valid declared type, but its judgment can still be wrong. Type safety is not factual correctness.
- Confidence is evidence for a policy threshold, not permission to take an irreversible or high-stakes action. Keep human review or deterministic checks where the cost of error is high.
- Clef Flash is for bounded semantic decisions. Do not use it for prose generation, counting, arithmetic, date comparison, open-ended reasoning, or explanations.
- Give each question one independent judgment. Dependent decisions belong in sequential application logic.

## Verification

A correct installation satisfies all of these:

1. Missing or incorrect MCP bearer authentication returns HTTP `401`.
2. Authenticated MCP initialization succeeds and discovers exactly `make_decisions`.
3. A mixed request returns matching `noul`, `choice`, and `score` answers.
4. The response names the selected model and its corresponding Cloudflare or TypeSafe provider and includes OpenRouter usage metadata.
5. Rotating the upstream key through the setup wizard affects the next request without exposing either secret.
