# Aravind Jev Decisions MCP

This is the public installation guide for Aravind's private Jev decision MCP. It calls TypeSafe's Jev model through OpenRouter while keeping the upstream OpenRouter API key on the server.

- **MCP endpoint:** `https://mcp.aravindmj.in/jev/mcp`
- **Transport:** MCP Streamable HTTP
- **Authentication:** `Authorization: Bearer <shared MCP credential>`
- **Recommended server name:** `aravind_jev_decisions`
- **Companion skill:** `https://mcp.aravindmj.in/jev/SKILL.md`
- **Pinned model:** `typesafe/jev-1.13`
- **Upstream API:** `POST https://openrouter.ai/api/alpha/decisions`

The MCP bearer credential and upstream OpenRouter key are deliberately not published. Aravind must configure them through protected secret mechanisms. Never paste either credential into prompts, logs, source control, shell history, or this guide.

## Harness-neutral self-installation

1. Identify the current harness and its native user-level MCP configuration.
2. Check for `aravind_jev_decisions`; update it in place rather than creating a duplicate.
3. Register Streamable HTTP endpoint `https://mcp.aravindmj.in/jev/mcp` under that exact name.
4. Configure the same protected bearer credential used by Aravind's other authenticated MCP modules. Send it in the `Authorization` header on every MCP request.
5. Enable the complete toolset: exactly `make_decisions`.
6. Install `https://mcp.aravindmj.in/jev/SKILL.md` through the harness's native user-level skill mechanism. Validate frontmatter name `aravind-jev-decisions` and update an existing copy rather than duplicating it.
7. Reconnect or begin a new agent session so the tool schema reloads.
8. Verify authenticated initialization and tool discovery. Make one harmless decision request and inspect its typed answer, model, provider, and usage fields.
9. Report the harness, scope, server name, discovered tool, skill location, and smoke-test result without printing credentials.

Canonical shape, adapted to the harness's own schema:

```json
{
  "mcpServers": {
    "aravind_jev_decisions": {
      "type": "http",
      "url": "https://mcp.aravindmj.in/jev/mcp",
      "headers": {
        "Authorization": "Bearer ${ARAVIND_MCP_SHARED_TOKEN}"
      }
    }
  }
}
```

For Hermes Agent, use the hidden credential prompt:

```text
hermes mcp add aravind_jev_decisions \
  --url https://mcp.aravindmj.in/jev/mcp \
  --auth header
hermes mcp test aravind_jev_decisions
```

## Tool

### `make_decisions`

Send one shared `state` and one or more independent typed questions. Questions are evaluated in parallel.

```json
{
  "model": "typesafe/jev-1.13",
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

`noul` returns a probability from 0 to 1. `choice` returns a declared option, probabilities, and usually confidence. `score` returns a probability-weighted position over the ordered criteria, a legend, probabilities, and usually confidence. Responses also include the served model snapshot, provider, token usage, and cost when OpenRouter supplies them.

The default model is pinned to `typesafe/jev-1.13`. `~typesafe/jev-latest` is available only when deliberate model drift is acceptable. Thresholds tuned against one version must be re-evaluated before moving to another.

## Security and operating boundaries

- MCP clients never receive the OpenRouter API key. The service reads it from a protected runtime file for every request, so key rotation does not require code changes.
- Jev data is sent to OpenRouter and its upstream provider. Do not send secrets or data that policy forbids sharing with those processors.
- The hub keeps each tool call's full arguments and result in a private audit log behind the hub's Basic Auth. Do not send data that must not be retained.
- Jev always returns a valid declared type, but its judgment can still be wrong. Type safety is not factual correctness.
- Confidence is evidence for a policy threshold, not permission to take an irreversible or high-stakes action. Keep human review or deterministic checks where the cost of error is high.
- Jev is for bounded semantic decisions. Do not use it for prose generation, counting, arithmetic, date comparison, open-ended reasoning, or explanations.
- Give each question one independent judgment. Dependent decisions belong in sequential application logic.

## Verification

A correct installation satisfies all of these:

1. Missing or incorrect MCP bearer authentication returns HTTP `401`.
2. Authenticated MCP initialization succeeds and discovers exactly `make_decisions`.
3. A mixed request returns matching `noul`, `choice`, and `score` answers.
4. The response names a TypeSafe Jev model snapshot and includes OpenRouter usage metadata.
5. Rotating the upstream key through the setup wizard affects the next request without exposing either secret.
