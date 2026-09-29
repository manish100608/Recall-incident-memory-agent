import type { ActiveIncident, Confidence, MemoryMatch } from '../shared/types.js';
import { redact } from './safety.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const PRIMARY_MODEL = 'openai/gpt-oss-120b';
export const FALLBACK_MODEL = 'qwen/qwen3-32b';
const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    possible_cause: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    recommended_steps: { type: 'array', items: { type: 'string' } },
    things_not_to_do: { type: 'array', items: { type: 'string' } },
    cited_incident_ids: { type: 'array', items: { type: 'string' } },
  },
  required: ['possible_cause', 'confidence', 'recommended_steps', 'things_not_to_do', 'cited_incident_ids'],
  additionalProperties: false,
} as const;

export interface AnalysisDraft {
  possible_cause: string;
  confidence: Confidence;
  recommended_steps: string[];
  things_not_to_do: string[];
  cited_incident_ids: string[];
  model: string;
}

export class GroqError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(message: string, code = 'groq_unavailable', status?: number) {
    super(message);
    this.name = 'GroqError';
    this.code = code;
    this.status = status;
  }
}

class MalformedAnalysisError extends GroqError {
  constructor(message: string) { super(message, 'malformed_model_output'); }
}

function groqKey(): string {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new GroqError('Groq is not configured: missing GROQ_API_KEY.', 'provider_not_configured', 503);
  return key;
}

function systemPrompt(memoryAvailable: boolean): string {
  return [
    'You are Recall, a cautious production incident triage assistant. You only recommend; you never execute or claim to execute actions.',
    'Return one JSON object with exactly these keys: possible_cause (string), confidence (low|medium|high), recommended_steps (string array), things_not_to_do (string array), cited_incident_ids (string array). No markdown, no tools, no function calls.',
    'Use concise, operationally safe language. Separate observations from hypotheses. Never invent cited incident IDs.',
    memoryAvailable
      ? 'Use only the supplied real Hindsight memories as historical evidence. Prioritize engineer corrections and explicitly failed fixes over earlier diagnoses. A belief marked superseded is never current truth; mention it only as something not to repeat. If histories conflict, state uncertainty and lower confidence.'
      : 'No Hindsight memory is available for this run. Do not imply that a historical incident was retrieved or cite historical IDs. Give only generic, reversible diagnostic recommendations.',
    'If no comparable memory is provided, say that no comparable past incident was found and explain that any guidance is generic.',
    'Never recommend a destructive or irreversible change as a first step. Do not output executable commands, scripts, or automated remediation.',
  ].join('\n');
}

function userPrompt(incident: ActiveIncident, memories: MemoryMatch[]): string {
  const current = {
    id: incident.id,
    service: incident.service,
    severity: incident.severity,
    symptoms: incident.symptoms,
    metrics: incident.metrics,
    deploy_version: incident.deploy_version,
    log_snippet: incident.log_snippet.map(redact),
  };
  const memoryContext = memories.map((memory) => ({
    incident_id: memory.incident?.id ?? memory.metadata?.incident_id ?? memory.tags?.find((tag) => tag.startsWith('incident:'))?.slice(9),
    text: redact(memory.text),
    metadata: memory.metadata ?? {},
    score: memory.score_weighted ?? memory.score ?? 0,
    older_than_six_months: Boolean(memory.older),
  }));
  return [
    `Current incident JSON: ${JSON.stringify(current)}`,
    `Comparable Hindsight memories: ${JSON.stringify(memoryContext)}`,
    memories.length ? 'A recalled incident with outcome=resolved increases evidentiary confidence; one with outcome=recurred or a failed fix decreases it. Older memories have lower weight.' : 'There are no comparable Hindsight memories for this run.',
    'Return a concise JSON analysis now.',
  ].join('\n');
}

function parseContent(content: unknown, requestedModel: string): AnalysisDraft {
  if (typeof content !== 'string' || !content.trim()) throw new MalformedAnalysisError('Groq returned an empty JSON response.');
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch {
    const withoutFence = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { parsed = JSON.parse(withoutFence); } catch { throw new MalformedAnalysisError('Groq returned malformed JSON.'); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new MalformedAnalysisError('Groq response must be a JSON object.');
  const candidate = parsed as Record<string, unknown>;
  const allowedConfidence = ['low', 'medium', 'high'];
  if (typeof candidate.possible_cause !== 'string' || !candidate.possible_cause.trim()) throw new MalformedAnalysisError('Groq JSON is missing possible_cause.');
  if (!allowedConfidence.includes(String(candidate.confidence))) throw new MalformedAnalysisError('Groq JSON confidence must be low, medium, or high.');
  if (!Array.isArray(candidate.recommended_steps) || candidate.recommended_steps.some((step) => typeof step !== 'string')) throw new MalformedAnalysisError('Groq JSON recommended_steps must be a string array.');
  if (!Array.isArray(candidate.things_not_to_do) || candidate.things_not_to_do.some((step) => typeof step !== 'string')) throw new MalformedAnalysisError('Groq JSON things_not_to_do must be a string array.');
  if (!Array.isArray(candidate.cited_incident_ids) || candidate.cited_incident_ids.some((id) => typeof id !== 'string')) throw new MalformedAnalysisError('Groq JSON cited_incident_ids must be a string array.');
  return {
    possible_cause: redact(candidate.possible_cause.trim()),
    confidence: candidate.confidence as Confidence,
    recommended_steps: candidate.recommended_steps.map((step) => redact(String(step).trim())).filter(Boolean).slice(0, 6),
    things_not_to_do: candidate.things_not_to_do.map((step) => redact(String(step).trim())).filter(Boolean).slice(0, 6),
    cited_incident_ids: candidate.cited_incident_ids.map(String).slice(0, 8),
    model: requestedModel,
  };
}

async function requestModel(model: string, incident: ActiveIncident, memories: MemoryMatch[]): Promise<AnalysisDraft> {
  const key = groqKey();
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_completion_tokens: 900,
        response_format: model === PRIMARY_MODEL
          ? { type: 'json_schema', json_schema: { name: 'recall_incident_analysis', strict: true, schema: ANALYSIS_SCHEMA } }
          : { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt(memories.length > 0) },
          { role: 'user', content: userPrompt(incident, memories) },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    const detail = redact(error instanceof Error ? error.message : String(error)).slice(0, 240);
    throw new GroqError(`Groq network request failed: ${detail || 'connection error'}.`, 'groq_network_error');
  }
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* provider error is rendered below */ }
  if (!response.ok) {
    const error = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : {};
    const detail = redact(String(error.message ?? text ?? 'provider request failed')).slice(0, 360);
    if (response.status === 400 && /failed to generate json|could not generate valid json/i.test(detail)) {
      throw new MalformedAnalysisError(`Groq model ${model} could not produce the required JSON response: ${detail}`);
    }
    throw new GroqError(`Groq model ${model} returned HTTP ${response.status}: ${detail}`, 'groq_http_error', response.status);
  }
  const choices = Array.isArray(body.choices) ? body.choices as Array<Record<string, unknown>> : [];
  const choice = choices[0];
  const message = choice?.message && typeof choice.message === 'object' ? choice.message as Record<string, unknown> : {};
  if (choice?.finish_reason === 'tool_calls' || Array.isArray(message.tool_calls) || message.function_call) {
    throw new MalformedAnalysisError(`Groq model ${model} returned a function/tool call instead of the required JSON object.`);
  }
  const responseModel = typeof body.model === 'string' ? body.model : model;
  return parseContent(message.content, responseModel);
}

export async function analyzeWithGroq(incident: ActiveIncident, memories: MemoryMatch[]): Promise<AnalysisDraft> {
  let primaryFailure: Error | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await requestModel(PRIMARY_MODEL, incident, memories);
    } catch (error) {
      primaryFailure = error instanceof Error ? error : new Error('Unknown Groq error.');
      // The agreed three-attempt retry applies to malformed JSON and tool/function-call outputs.
      if (!(error instanceof MalformedAnalysisError) || attempt === 3) break;
    }
  }
  try {
    return await requestModel(FALLBACK_MODEL, incident, memories);
  } catch (fallbackError) {
    const primaryMessage = redact(primaryFailure?.message ?? 'primary model failed');
    const fallbackMessage = redact(fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
    throw new GroqError(`Incident analysis failed. Primary ${PRIMARY_MODEL}: ${primaryMessage} Fallback ${FALLBACK_MODEL}: ${fallbackMessage}`, 'analysis_failed', fallbackError instanceof GroqError ? fallbackError.status : undefined);
  }
}
