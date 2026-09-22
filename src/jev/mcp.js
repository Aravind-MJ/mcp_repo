import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { DEFAULT_JEV_MODEL, LATEST_JEV_MODEL } from "./client.js";

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
const questions = z.record(z.string().min(1).max(128), question).refine((value) => {
  const count = Object.keys(value).length;
  return count >= 1 && count <= 1_000;
}, "questions must contain between 1 and 1000 entries");
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

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

export function createJevMcpServer(client) {
  const server = new McpServer({
    name: "personal-jev-decisions",
    title: "Jev Structured Decisions",
    version: "1.0.0",
    description: "Makes fast typed semantic decisions with Jev through OpenRouter.",
  });

  server.registerTool("make_decisions", {
    title: "Make typed Jev decisions",
    description: "Evaluate one text or structured state against independent typed questions in parallel. Noul returns a yes probability; choice returns one declared option and its distribution; score returns a position on an ordered rubric. Jev does not generate prose, count reliably, perform arithmetic, or explain its reasoning.",
    inputSchema: {
      state,
      questions,
      model: z.enum([DEFAULT_JEV_MODEL, LATEST_JEV_MODEL]).optional().default(DEFAULT_JEV_MODEL)
        .describe("Pin typesafe/jev-1.13 for stable tuned thresholds; use ~typesafe/jev-latest only when accepting model drift"),
    },
    outputSchema: decisionOutput,
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: true },
  }, async ({ state: inputState, questions: inputQuestions, model }) => toolResult(
    await client.makeDecisions({ state: inputState, questions: inputQuestions, model }),
  ));

  return server;
}
