---
name: aravind-decision-maker
description: Use when making typed decisions through the decision MCP.
version: 1.0.0
author: Aravind M J, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [mcp, classification, routing, decisions]
    related_skills: []
---

# Aravind decision maker

Use the authenticated decision MCP for bounded semantic classification, routing, yes/no propositions, and ordered scoring. It supports Cloudflare Clef Flash and TypeSafe Jev through OpenRouter without binding the integration to either model.

## When to use

Use for classification, routing, yes/no judgments, and ordered scoring over a bounded answer space. Do not use for prose generation or deterministic calculations.

## Connection

- Server name: `aravind_decision_maker`
- Streamable HTTP endpoint: `https://mcp.aravindmj.in/decisions/mcp`
- Installation guide: `https://mcp.aravindmj.in/decisions/README.md`
- Companion skill: `https://mcp.aravindmj.in/decisions/SKILL.md`
- Protected log dashboard: `https://mcp.aravindmj.in/decisions/logs`
- Tool: `aravind_decision_maker.make_decisions`

Clients use the existing shared MCP bearer. The separate OpenRouter key stays on the host. Never request, reveal, or transmit the upstream key.

## Model selection

Omit `model` to follow the persistent default selected in the protected log dashboard. The initial default is `cloudflare/clef-flash`.

Set `model` explicitly to one of:

- `cloudflare/clef-flash`, served by Cloudflare.
- `typesafe/jev-1.13`, served by TypeSafe, which may report a dated snapshot.

An explicit model overrides the dashboard for that call only. Saving the dashboard selector takes effect on subsequent calls and survives service restarts. Failures do not trigger automatic fallback. Recalibrate thresholds when changing models; Clef Flash's model ID is not an immutable weights snapshot.

## Questions

Supply one shared text or structured JSON `state` and a map of independent questions. Use at most 64 questions. Question IDs must contain only letters, digits, underscores, or hyphens and be at most 100 characters.

- `noul`: one yes/no proposition. Supply `instructions` and optionally `criteria` with `true` and `false` descriptions. The returned `noul` is the probability of yes.
- `choice`: one of 2 to 255 labels. Supply `instructions` and a `criteria` object mapping each declared label to its description. Read both the selected `choice` and its full `probabilities` distribution.
- `score`: an ordered rubric with 2 to 255 descriptions in `criteria`. The returned `score` is a probability-weighted zero-based position, not an integer category.

Example:

```json
{
  "model": "cloudflare/clef-flash",
  "state": "Checkout fails for all customers.",
  "questions": {
    "owner": {
      "type": "choice",
      "instructions": "Which team should handle this?",
      "criteria": {
        "technical": "Outages and software errors",
        "billing": "Invoice questions",
        "other": "Anything else"
      }
    }
  }
}
```

## Procedure and safety

1. Use code for exact counts, arithmetic, dates, hashes, and deterministic comparisons. Decision models do not replace those tools or generate prose and explanations.
2. Send the smallest relevant state without secrets. State goes to OpenRouter and the selected upstream provider. The hub also retains full arguments and results in its private audit database.
3. Keep Cloudflare state short. Its current text path truncates state to roughly the first 2,000 tokens despite the advertised context window.
4. Define concrete, distinguishable criteria. Include an `other` or `none` choice where appropriate.
5. Batch independent questions about the same state in one call. Dependent questions require sequential application logic.
6. Verify every submitted question has a matching typed answer, only declared choice labels, and probabilities from 0 through 1. Verify the served model and matching provider.
7. Apply thresholds outside the model, calibrated on representative labeled examples. A schema-valid answer can be wrong; probability and confidence alone do not authorize irreversible, privileged, medical, legal, financial, or safety-critical action.
8. Record the served model, provider, and usage where reproducibility matters. Never fabricate missing usage or assume missing cost means zero.

## Installation verification

Read back the registration, reconnect or reload MCPs, and verify discovery of exactly `make_decisions`. A harmless real tool call must succeed; discovery alone does not prove the provider path. Model-switch verification requires saving the dashboard setting, reading the selected option back, and making a call that omits `model`.
