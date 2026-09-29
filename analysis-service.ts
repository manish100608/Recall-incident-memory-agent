import { randomUUID } from 'node:crypto';
import type { ActiveIncident, Analysis, Confidence, EvaluationCase, EvaluationRun, EvaluationRow, Incident, MemoryMatch } from '../shared/types.js';
import { evaluationCases, findHistoricalIncident } from './incident-data.js';
import { recallIncidentMemories, reflectLesson } from './hindsight.js';
import { analyzeWithGroq, GroqError } from './groq.js';
import { redact } from './safety.js';

const confidenceOrder: Confidence[] = ['low', 'medium', 'high'];

function adjustConfidence(confidence: Confidence, memories: MemoryMatch[]): Confidence {
  const resolved = memories.filter((memory) => memory.incident?.outcome?.status === 'resolved').length;
  const recurred = memories.filter((memory) => memory.incident?.outcome?.status === 'recurred').length;
  let index = confidenceOrder.indexOf(confidence);
  if (resolved > recurred) index = Math.min(confidenceOrder.length - 1, index + 1);
  if (recurred > resolved) index = Math.max(0, index - 1);
  return confidenceOrder[index] ?? confidence;
}

function citedIds(draftIds: string[], memories: MemoryMatch[]): string[] {
  const allowed = new Set(memories.map((memory) => memory.incident?.id ?? memory.metadata?.incident_id ?? memory.tags?.find((tag) => tag.startsWith('incident:'))?.slice(9)).filter((value): value is string => Boolean(value)));
  return [...new Set(draftIds.filter((id) => allowed.has(id)))].slice(0, 8);
}

function activeFromHistorical(incident: Incident): ActiveIncident {
  return {
    id: incident.id,
    service: incident.service,
    severity: incident.severity,
    status: 'investigating',
    symptoms: incident.symptoms,
    metrics: incident.metrics,
    log_snippet: incident.log_snippet,
    deploy_version: incident.deploy_version ?? 'unknown',
    started_at: incident.date,
    root_cause: null,
  };
}

export async function runAnalysis(incident: ActiveIncident, memoryEnabled: boolean, includeReflect = true): Promise<Analysis> {
  const memories = memoryEnabled ? await recallIncidentMemories(incident) : [];
  const draft = await analyzeWithGroq(incident, memories);
  const status = !memoryEnabled ? 'memory_off' : memories.length ? 'matches' : 'no_comparable_incident';
  let lesson: string | null = null;
  if (memoryEnabled && memories.length && includeReflect) {
    try {
      lesson = await reflectLesson(`Lesson from previous incident for ${incident.service}: ${incident.symptoms.join('; ')}. Metrics: HTTP 500 ${incident.metrics.http_500_rate}%, p95 ${incident.metrics.p95_latency_ms} ms, DB connections ${incident.metrics.db_connection_pct}%. Prioritize engineer corrections and failed fixes; never treat a superseded belief as current truth.`);
    } catch {
      // Reflect is optional: recall and Groq remain real, while an unsupported Reflect result is not fabricated.
      lesson = null;
    }
  }
  return {
    possible_cause: draft.possible_cause,
    confidence: memoryEnabled ? adjustConfidence(draft.confidence, memories) : draft.confidence,
    recommended_steps: draft.recommended_steps,
    things_not_to_do: draft.things_not_to_do,
    cited_incident_ids: memoryEnabled ? citedIds(draft.cited_incident_ids, memories) : [],
    comparable_status: status,
    similar_incidents: memories,
    lesson_from_previous_incident: lesson,
    model: draft.model,
  };
}

function canonicalCause(text: string): string | null {
  const value = text.toLowerCase();
  if (/connection.{0,24}leak|leak.{0,24}connection/.test(value)) return 'connection-leak';
  if (/nested.{0,24}(parser|facet)|parser.{0,24}(regression|deploy|compatib)|bad deploy/.test(value)) return 'bad-deploy-parser';
  if (/memory leak|heap leak|unbounded.{0,30}retry|retry.{0,30}memory/.test(value)) return 'memory-leak';
  if (/expired.{0,24}cert|cert.{0,24}expired/.test(value)) return 'expired-certificate';
  if (/replication slot|wal.{0,30}(retain|disk|full)|disk.{0,30}(full|wal)|no space left/.test(value)) return 'disk-full';
  if (/upstream.{0,24}timeout|timeout.{0,24}upstream|acquirer.{0,30}(timeout|deadline)|provider.{0,24}timeout/.test(value)) return 'upstream-timeout';
  if (/cache.{0,40}(version|schema)|stale.{0,24}(preference|cache)/.test(value)) return 'stale-preference-cache';
  if (/watermark|shard.{0,24}(replay|rebalance)|duplicate.{0,24}results/.test(value)) return 'shard-watermark';
  return null;
}

function predictionIsCorrect(prediction: string, correctCause: string): boolean {
  const predicted = canonicalCause(prediction);
  const expected = canonicalCause(correctCause);
  if (predicted && expected) return predicted === expected;
  const tokens = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  const expectedTokens = tokens(correctCause);
  const predictionTokens = tokens(prediction);
  if (!expectedTokens.size) return false;
  let overlap = 0;
  for (const token of expectedTokens) if (predictionTokens.has(token)) overlap += 1;
  return overlap / expectedTokens.size >= 0.45;
}

function asActiveCase(item: EvaluationCase): ActiveIncident {
  return {
    id: item.id,
    service: item.service,
    severity: 'SEV-2',
    status: 'investigating',
    symptoms: item.symptoms,
    metrics: item.metrics,
    log_snippet: [],
    deploy_version: item.deploy_version,
    started_at: new Date().toISOString(),
    root_cause: null,
  };
}

export async function runEvaluation(): Promise<EvaluationRun> {
  const startedAt = new Date().toISOString();
  const rows: EvaluationRow[] = [];
  let offCorrect = 0;
  let onCorrect = 0;
  for (const item of evaluationCases) {
    const active = asActiveCase(item);
    // Truth stays server-side and is deliberately omitted from both model prompts.
    const withoutMemory = await runAnalysis(active, false, false);
    const withMemory = await runAnalysis(active, true, false);
    const offIsCorrect = predictionIsCorrect(withoutMemory.possible_cause, item.correct_cause);
    const onIsCorrect = predictionIsCorrect(withMemory.possible_cause, item.correct_cause);
    if (offIsCorrect) offCorrect += 1;
    if (onIsCorrect) onCorrect += 1;
    rows.push({
      id: item.id,
      service: item.service,
      correct_cause: item.correct_cause,
      memory_off_prediction: withoutMemory.possible_cause,
      memory_off_correct: offIsCorrect,
      memory_on_prediction: withMemory.possible_cause,
      memory_on_correct: onIsCorrect,
      memory_off_cumulative_accuracy: offCorrect / (rows.length + 1),
      memory_on_cumulative_accuracy: onCorrect / (rows.length + 1),
      cited_incident_ids: withMemory.cited_incident_ids,
    });
  }
  return {
    run_id: randomUUID(),
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    rows,
    memory_off_top1_accuracy: offCorrect / rows.length,
    memory_on_top1_accuracy: onCorrect / rows.length,
    source: 'live_groq_and_hindsight',
  };
}

export async function compareMemory(incident: ActiveIncident): Promise<{ without_memory: Analysis; with_memory: Analysis }> {
  const [withoutMemory, withMemory] = await Promise.all([
    runAnalysis(incident, false, false),
    runAnalysis(incident, true, true),
  ]);
  return { without_memory: withoutMemory, with_memory: withMemory };
}

export function analysisErrorMessage(error: unknown): { code: string; message: string; status: number } {
  if (error instanceof GroqError) return { code: error.code, message: redact(error.message), status: error.status && error.status >= 400 && error.status < 600 ? error.status : 502 };
  if (error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('hindsight_')) {
    const status = 'status' in error && typeof error.status === 'number' && error.status >= 400 && error.status < 600 ? error.status : 502;
    return { code: error.code, message: redact(error.message), status };
  }
  return { code: 'analysis_error', message: error instanceof Error ? redact(error.message) : 'Analysis failed; try again.', status: 500 };
}

export function getActiveCaseForTimeline(id: string): ActiveIncident | undefined {
  const incident = findHistoricalIncident(id);
  return incident ? activeFromHistorical(incident) : undefined;
}
