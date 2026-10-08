import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { invalidResponseError } from "./client.js";

import { DEFAULT_DECISION_MODEL, DECISION_MODELS } from "./settings.js";

const instructions = z.string().min(1).max(8_000).describe("A narrow semantic judgment to make about the supplied state");
const criterion = z.string().min(1).max(4_000);
const criteriaRecord = z.record(z.string().min(1).max(128), criterion);

const noulQuestion = z.object({
  type: z.literal("noul"),
  instructions,
  criteria: z.object({ true: criterion, false: criterion }).optional(),
});

const choiceQuestion = z.object({
  type: z.literal("choice"),
  instructions,
  criteria: criteriaRecord.refine((value) => {
    const count = Object.keys(value).length;
    return count >= 2 && count <= 255;
  }, "choice criteria must define between 2 and 255 options"),
});

const scoreQuestion = z.object({
  type: z.literal("score"),
  instructions,
  criteria: z.array(criterion).min(2).max(255).describe("Ordered descriptions from the lowest to highest position"),
});

const question = z.discriminatedUnion("type", [noulQuestion, choiceQuestion, scoreQuestion]);
const questions = z.record(z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/), question).refine((value) => {
  const count = Object.keys(value).length;
  return count >= 1 && count <= 64;
}, "questions must contain between 1 and 64 entries");
const state = z.union([
  z.string().min(1),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()).min(1),
]).describe("The text or structured JSON context every question evaluates");
const probability = z.number().min(0).max(1);
const answer = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: probability.optional(),
    probabilities: z.record(z.string(), probability),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number().min(0),
    confidence: probability.optional(),
    probabilities: z.record(z.string(), probability),
    legend: z.record(z.string(), z.string()).optional(),
  }),
]);
const decisionOutput = {
  id: z.string().optional(),
  model: z.string(),
  provider: z.string().optional(),
  answers: z.record(z.string(), answer),
  usage: z.record(z.string(), z.unknown()).optional(),
};
const decisionResult = z.object(decisionOutput);

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

export function createDecisionMcpServer(client, calls, defaultModel = DEFAULT_DECISION_MODEL) {
  const server = new McpServer({
    name: "personal-decision-maker",
    title: "Decision Maker",
    version: "1.0.0",
    description: "Makes fast typed semantic decisions with a selectable model through OpenRouter.",
  });

  server.registerTool("make_decisions", {
    title: "Make typed decisions",
    description: "Evaluate one text or structured state against independent typed questions in parallel. Noul returns a yes probability; choice returns one declared option and its distribution; score returns a position on an ordered rubric. Decision models do not generate prose, count reliably, perform arithmetic, or explain its reasoning.",
    inputSchema: {
      state,
      questions,
      model: z.enum(Object.keys(DECISION_MODELS)).optional()
        .describe("Optional per-call override. Omit to use the default model selected in the private log dashboard."),
    },
    outputSchema: decisionOutput,
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: true },
  }, async ({ state: inputState, questions: inputQuestions, model }, extra) => {
    const call = calls.claim(extra.requestId);
    let payload;
    try {
      payload = await client.makeDecisions({ state: inputState, questions: inputQuestions, model: model ?? defaultModel });
    } catch (error) {
      call.fail(error);
      throw error;
    }
    // McpServer rejects output that fails this schema with its own error, so audit it the same way.
    if (decisionResult.safeParse(payload).success) call.succeed(payload);
    else call.fail(invalidResponseError(payload));
    return toolResult(payload);
  });

  return server;
}
