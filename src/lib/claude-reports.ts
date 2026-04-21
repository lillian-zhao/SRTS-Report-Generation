import Anthropic from "@anthropic-ai/sdk";
import type { AuditContext } from "./audit-context";
import { contextToPromptText } from "./audit-context";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ── Shared helper ──────────────────────────────────────────────────────────────

async function callClaude(system: string, user: string): Promise<string> {
  const message = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: user }],
  });
  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected Claude response type");
  return block.text;
}

function parseJson<T>(raw: string): T {
  // Claude sometimes wraps JSON in a markdown code block — strip it.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  return JSON.parse(cleaned) as T;
}

// ── Report type: DOMI Internal ────────────────────────────────────────────────

export type DomiContent = {
  preExistingConcernsNarrative: string;
  infrastructureNarrative: string;
  trafficNarrative: string;
  criticalFlags: string[];
  topConcerns: { concern: string; severity: string }[];
  immediateActions: string[];
  shortTermActions: string[];
  longTermActions: string[];
};

export async function generateDomiContent(ctx: AuditContext): Promise<DomiContent> {
  const system = `You are a professional urban planner and walkability analyst writing a confidential internal report for DOMI (Department of Mobility and Infrastructure), City of Pittsburgh. 
Your audience is city planners and traffic engineers who will use this report to prioritize capital projects and operational improvements.
Tone: technical, direct, action-oriented. Use specific location references where provided.
Severity ratings: Critical = immediate safety risk; High = significant barrier; Medium = notable but not urgent; Low = minor.
Return ONLY valid JSON with this exact structure, no prose outside the JSON:
{
  "preExistingConcernsNarrative": "1-2 sentence summary of known issues before the audit",
  "infrastructureNarrative": "2-3 sentence technical summary of infrastructure findings",
  "trafficNarrative": "2-3 sentence technical summary of traffic and safety findings, call out any critical safety incidents by location",
  "criticalFlags": ["specific item requiring immediate attention with location if known"],
  "topConcerns": [
    {"concern": "concise concern description", "severity": "Critical|High|Medium|Low"},
    {"concern": "...", "severity": "..."},
    {"concern": "...", "severity": "..."}
  ],
  "immediateActions": ["action within 0-3 months, specific and actionable"],
  "shortTermActions": ["action within 3-6 months"],
  "longTermActions": ["longer-term project or study recommendation"]
}`;

  const user = `Generate the DOMI Internal report content for this walkability audit:\n\n${contextToPromptText(ctx)}`;
  const raw = await callClaude(system, user);
  return parseJson<DomiContent>(raw);
}

// ── Report type: School & Community ──────────────────────────────────────────

export type SchoolCommunityContent = {
  aboutNarrative: string;
  areasOfConcern: string[];
  parentConcernsSummary: string;
  whatHappensNext: string[];
};

export async function generateSchoolCommunityContent(
  ctx: AuditContext,
): Promise<SchoolCommunityContent> {
  const system = `You are writing a walkability audit summary for school administrators, parent-teacher organizations, and school community partners on behalf of the City of Pittsburgh's Safe Routes to School (SRTS) program.
Tone: warm, informative, collaborative. Avoid technical jargon. Use "we" language (the audit team). Parents and teachers are your audience — they care about student safety and want to understand what's happening and what comes next.
Return ONLY valid JSON with this exact structure:
{
  "aboutNarrative": "2-sentence summary of this audit: who participated, what was assessed",
  "areasOfConcern": ["plain-language description of a specific safety concern observed on the route — 5 to 7 items"],
  "parentConcernsSummary": "1-2 sentences summarizing what parents and students have reported as concerns, based on the pre-audit survey data",
  "whatHappensNext": ["specific action the SRTS team or city will take — 4 to 5 items, written as commitments"]
}`;

  const user = `Generate the School & Community report content for this walkability audit:\n\n${contextToPromptText(ctx)}`;
  const raw = await callClaude(system, user);
  return parseJson<SchoolCommunityContent>(raw);
}

// ── Report type: Public Update ────────────────────────────────────────────────

export type PublicContent = {
  programBlurb: string;
  keyFindings: string[];
  nextSteps: string[];
};

export async function generatePublicContent(ctx: AuditContext): Promise<PublicContent> {
  const system = `You are writing a one-page public community update on behalf of the City of Pittsburgh's Safe Routes to School (SRTS) program.
Tone: accessible, community-positive, brief. This will be posted online and distributed at community meetings. No technical jargon. Max 1-2 sentences per bullet.
Return ONLY valid JSON with this exact structure:
{
  "programBlurb": "2-sentence description of the SRTS program and the purpose of walkability audits, written for a general public audience",
  "keyFindings": ["plain-language finding from the audit — 4 to 5 items, each 1 sentence"],
  "nextSteps": ["brief description of a next step or commitment — 2 to 3 items"]
}`;

  const user = `Generate the Public Update report content for this walkability audit:\n\n${contextToPromptText(ctx)}`;
  const raw = await callClaude(system, user);
  return parseJson<PublicContent>(raw);
}
