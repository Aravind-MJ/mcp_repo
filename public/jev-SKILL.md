---
name: aravind-jev-decisions
description: Make bounded typed decisions with Jev through OpenRouter.
version: 0.1.0
author: Aravind M J, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [mcp, jev, classification, routing, decisions]
    related_skills: []
---

# Aravind Jev Decisions

Use Aravind's authenticated MCP to make fast, bounded semantic decisions with TypeSafe Jev through OpenRouter. Jev returns typed probabilities and choices; it does not generate prose or reasoning.

## When to Use

Use this skill for:

- routing or classifying text into known options;
- scoring a state against an ordered rubric;
- estimating whether a clearly defined proposition is true;
- evaluating several independent judgments about the same state in parallel;
- gating a reversible workflow with a threshold calibrated on representative data.

Do not use it for writing, summarization, code generation, counting, arithmetic, date comparison, multi-step reasoning, or explanations. Do not let a model probability alone authorize irreversible, privileged, medical, legal, financial, or safety-critical action.

## Prerequisites

- MCP server name: `aravind_jev_decisions`
- Streamable HTTP endpoint: `https://mcp.aravindmj.in/jev/mcp`
- Public install guide: `https://mcp.aravindmj.in/jev/README.md`
- Protected shared MCP bearer credential configured by Aravind
- Server-side OpenRouter key; clients must never request, receive, or transmit it

## Tool

Call the qualified `aravind_jev_decisions.make_decisions` tool. Supply one shared `state`, a map of independent `questions`, and normally omit `model` to use pinned `typesafe/jev-1.13`.

### Noul

Use `noul` for one yes/no proposition. Its `noul` result is the probability of yes.

```json
{
  "type": "noul",
  "instructions": "Is the customer reporting a software defect?",
  "criteria": {
    "true": "Broken or unexpected product behavior.",
    "false": "A question or feature request."
  }
}
```

### Choice

Use `choice` for one-of-N labels. Define concrete, mutually distinguishable criteria and include `other` or `none` when the listed options may not fit.

```json
{
  "type": "choice",
  "instructions": "Which team should own this ticket?",
  "criteria": {
    "billing": "Charges, invoices, refunds, or seats on the bill.",
    "technical": "Bugs, outages, login failures, or integrations.",
    "other": "Anything else."
  }
}
```

### Score

Use `score` for ordered degrees. Put the lowest condition first and make adjacent levels behaviorally distinct.

```json
{
  "type": "score",
  "instructions": "How urgent is this ticket?",
  "criteria": ["Can wait", "Fix this week", "Blocking revenue now"]
}
```

## Procedure

1. Confirm the answer space is bounded and semantic. If exact code can compute the answer, use code instead.
2. Build the smallest relevant `state`. Remove secrets and irrelevant context; more context can reduce decision quality.
3. Write stable question IDs and one narrow judgment per question. Questions in a request cannot depend on one another's answers.
4. Define concrete criteria. Avoid overlapping choice labels and vague score levels.
5. Put every independent question over that state in one `make_decisions` call so Jev evaluates them in parallel.
6. Check each returned `type` matches its question. Read the full distribution, not only the selected choice or score.
7. Apply an explicit policy outside Jev: accept above a threshold validated on labeled examples; otherwise ask a human, gather context, or escalate to a reasoning model.
8. Log the served model snapshot and usage when reproducibility and cost matter. Never log credentials or unnecessarily sensitive state.

## Model Selection

Keep the default `typesafe/jev-1.13` when thresholds or evaluations depend on stable behavior. Use `~typesafe/jev-latest` only when the user accepts model drift, then re-evaluate thresholds after the alias advances.

## Pitfalls

- A schema-valid answer can be wrong. “Cannot hallucinate” means Jev cannot invent an undeclared output shape, not that its judgment is always correct.
- Confidence summarizes a distribution; it is not a universal safety score. Tune thresholds against the cost of false positives and false negatives.
- A `noul` value near `0.5` means yes and no are similarly likely, not “medium.”
- A score is a probability-weighted position whose zero index is the first criterion.
- Do not ask for free text, explanations, counts, arithmetic, or dependent chains.
- Do not silently switch from the pinned model to the latest alias.
- State is sent to OpenRouter and TypeSafe. Minimize it and follow the user's data-handling constraints.

## Verification

A valid call returns:

- one answer for every submitted question ID;
- matching `noul`, `choice`, or `score` answer types;
- only declared labels for choice answers;
- probabilities in the range 0 through 1;
- a served Jev model snapshot and provider;
- usage metadata when supplied by OpenRouter.

Before automating a consequential branch, test representative labeled examples and document the chosen threshold and fallback path.
