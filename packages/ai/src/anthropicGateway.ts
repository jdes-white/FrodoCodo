import Anthropic from "@anthropic-ai/sdk";
import type { IntelligenceRequest, ModelGateway } from "./modelGateway.js";

/**
 * Real Claude-backed gateway. Only ever instantiated server-side (§21) —
 * the API key must never reach a client bundle. Not wired to a live key by
 * default in this repo (AI_PROVIDER=stub); see .env.example and
 * docs/ai-architecture.md before enabling this in a deployment.
 */
export class AnthropicGateway implements ModelGateway {
  readonly id = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = "claude-sonnet-5") {
    if (!apiKey) throw new Error("AnthropicGateway requires an API key");
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generateNarrative(request: IntelligenceRequest): Promise<unknown> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(request) }],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("AnthropicGateway: no text content in response");
    }
    return JSON.parse(extractJson(textBlock.text));
  }
}

const SYSTEM_PROMPT = `You are the financial coach inside a household budgeting app. You explain
numbers the app already calculated — you never calculate or invent numbers yourself. Every dollar
figure in your response MUST be copied verbatim from the fact sheet you are given; do not compute
new totals, percentages, or projections. Prefer language like "at your current rate...", "the data
shows...", "one option would be..." over giving personalized financial, tax, credit, or investment
advice. Respond with ONLY a JSON object of the form {"narrative": string}, no other text.`;

function buildUserPrompt(request: IntelligenceRequest): string {
  const parts = [`Request type: ${request.type}`];
  if (request.question) parts.push(`Household question: ${request.question}`);
  if (request.insightTitle) parts.push(`Insight to explain: ${request.insightTitle}`);
  parts.push(`Fact sheet (the only numbers you may reference):\n${JSON.stringify(request.factSheet, null, 2)}`);
  return parts.join("\n\n");
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AnthropicGateway: response did not contain JSON");
  return text.slice(start, end + 1);
}
