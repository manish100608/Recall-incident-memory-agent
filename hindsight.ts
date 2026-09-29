import { randomUUID } from 'node:crypto';
import type { ActiveIncident, Incident, MemoryMatch, FeedbackPayload } from '../shared/types.js';
import { findHistoricalIncident, historicalIncidents } from './incident-data.js';
import { redact } from './safety.js';

export const RECALL_TAG = 'recall-app-v1';

export class HindsightError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(message: string, code = 'hindsight_unavailable', status?: number) {
    super(message);
    this.name = 'HindsightError';
    this.code = code;
    this.status = status;
  }
}

interface HindsightResult {
  id: string;
  text: string;
  type?: string;
  context?: string | null;
  occurred_start?: string | null;
  document_id?: string | null;
  tags?: string[];
  metadata?: Record<string, string>;
  scores?: { final?: number | null };
}

interface RecallResponse { results?: HindsightResult[] }

function settings() {
  const base = process.env.HINDSIGHT_BASE_URL?.trim();
  const key = process.env.HINDSIGHT_API_KEY?.trim();
  const bank = process.env.HINDSIGHT_BANK_ID?.trim();
  const missing = [
    !base && 'HINDSIGHT_BASE_URL',
    !key && 'HINDSIGHT_API_KEY',
    !bank && 'HINDSIGHT_BANK_ID',
  ].filter(Boolean);
  if (missing.length) {
    throw new HindsightError(`Hindsight is not configured: missing ${missing.join(', ')}.`, 'provider_not_configured', 503);
  }
  let parsed: URL;
  try { parsed = new URL(base!); } catch {
    throw new HindsightError('HINDSIGHT_BASE_URL is not a valid URL.', 'provider_not_configured', 503);
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new HindsightError('HINDSIGHT_BASE_URL must use HTTP or HTTPS.', 'provider_not_configured', 503);
  }
  return { base: base!.replace(/\/+$/, ''), key: key!, bank: encodeURIComponent(bank!) };
}

async function hindsightRequest<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const { base, key, bank } = settings();
  let response: Response;
  try {
    response = await fetch(`${base}/v1/default/banks/${bank}${path}`, {
      method: init.method ?? 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(init.timeoutMs ?? 45_000),
    });
  } catch (error) {
    const detail = redact(error instanceof Error ? error.message : String(error)).slice(0, 240);
    throw new HindsightError(`Hindsight network request failed: ${detail || 'connection error'}.`, 'hindsight_network_error');
  }
  const text = await response.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { message: text }; }
  if (!response.ok) {
    const detail = redact(JSON.stringify(parsed ?? {})).slice(0, 420);
    throw new HindsightError(`Hindsight returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`, 'hindsight_http_error', response.status);
  }
  return parsed as T;
}

function narrative(incident: Incident, includeCorrection: boolean): string {
  const metrics = incident.metrics;
  const lines = [
    `Historical production incident ${incident.id} occurred on ${incident.date} in the ${incident.service} service with ${incident.severity} severity.`,
    `Symptoms: ${incident.symptoms.join('; ')}.`,
    `Metric pattern: HTTP 500 rate ${metrics.http_500_rate}%, p95 latency ${metrics.p95_latency_ms} ms, database connections ${metrics.db_connection_pct}%, CPU ${metrics.cpu_pct}%, memory ${metrics.memory_pct}%.`,
    incident.deploy_version ? `Deploy version: ${incident.deploy_version}.` : '',
    incident.initial_diagnosis ? `Initial diagnosis (historical belief, not current truth): ${incident.initial_diagnosis}.` : '',
    incident.hypotheses_tried.length ? `Hypotheses tried: ${incident.hypotheses_tried.join('; ')}.` : '',
    incident.failed_fixes.length ? `Failed fixes that must not be repeated as if they worked: ${incident.failed_fixes.join('; ')}.` : '',
    incident.root_cause ? `Confirmed historical root cause: ${incident.root_cause}` : '',
    incident.resolution ? `Resolution: ${incident.resolution}` : '',
    incident.outcome ? `Outcome: ${incident.outcome.status}; time to resolve ${incident.outcome.minutes_to_resolve} minutes.` : '',
    includeCorrection && incident.engineer_correction ? `Engineer correction superseding the initial belief: ${incident.engineer_correction}` : '',
  ].filter(Boolean);
  return redact(lines.join('\n'));
}

export async function seedPastIncidents(includeHeroCorrection = true): Promise<{ retained: number; message: string }> {
  const items = historicalIncidents.map((incident) => ({
    content: narrative(incident, includeHeroCorrection),
    context: 'Recall production incident response history',
    timestamp: incident.date,
    document_id: `recall-app-${incident.id}`,
    metadata: {
      incident_id: incident.id,
      service: incident.service,
      deploy_version: incident.deploy_version ?? 'unknown',
      outcome: incident.outcome?.status ?? 'unknown',
      root_cause: incident.root_cause ?? 'unknown',
      initial_diagnosis: incident.initial_diagnosis ?? incident.hypotheses_tried[0] ?? 'unknown',
      engineer_correction: includeHeroCorrection ? (incident.engineer_correction ?? '') : '',
      correction_included: String(Boolean(includeHeroCorrection && incident.engineer_correction)),
      source: 'Recall incidents.json seed',
    },
    tags: [RECALL_TAG, `incident:${incident.id}`, `service:${incident.service}`],
  }));
  const result = await hindsightRequest<{ success?: boolean; items_count?: number; message?: string }>('/memories', {
    method: 'POST', body: { async: false, items }, timeoutMs: 150_000,
  });
  if (result?.success === false) throw new HindsightError('Hindsight did not accept the incident seed.', 'hindsight_seed_failed');
  const retained = result?.items_count ?? 0;
  if (retained !== historicalIncidents.length) {
    throw new HindsightError(`Hindsight accepted ${retained} of ${historicalIncidents.length} incident memories.`, 'hindsight_seed_incomplete');
  }
  return { retained, message: result.message ?? 'Incident memories retained in Hindsight.' };
}

export async function clearHindsightBank(): Promise<{ deleted_count: number; message: string }> {
  const result = await hindsightRequest<{ success?: boolean; deleted_count?: number; message?: string }>('/memories', { method: 'DELETE' });
  if (result?.success === false) throw new HindsightError('Hindsight did not confirm the memory reset.', 'hindsight_reset_failed');
  return { deleted_count: result?.deleted_count ?? 0, message: result?.message ?? 'Hindsight memories cleared.' };
}

export async function retainFeedback(incident: ActiveIncident | Incident, feedback: FeedbackPayload): Promise<{ retained: boolean; document_id: string; timestamp: string }> {
  const timestamp = new Date().toISOString();
  const documentId = `recall-app-feedback-${incident.id}-${randomUUID()}`;
  const kindText = feedback.kind === 'worked'
    ? `Engineer feedback: the recommendation worked; resolved in ${feedback.minutes_to_resolution ?? 'unknown'} minutes.`
    : feedback.kind === 'didnt_work'
      ? `Engineer feedback: the attempted recommendation did not work. Failed-fix note: ${feedback.text || 'No additional detail supplied.'}`
      : `Engineer correction supersedes the prior belief for ${incident.id}: ${feedback.text ?? ''}`;
  const content = redact(`${kindText} Incident ${incident.id}, service ${incident.service}, deploy ${incident.deploy_version ?? 'unknown'}.`);
  const result = await hindsightRequest<{ success?: boolean; items_count?: number }>('/memories', {
    method: 'POST',
    body: {
      async: false,
      items: [{
        content,
        context: 'Recall engineer feedback and corrected incident beliefs',
        timestamp,
        document_id: documentId,
        metadata: {
          incident_id: incident.id,
          service: incident.service,
          feedback_type: feedback.kind,
          supersedes_previous_belief: String(feedback.kind === 'wrong_because'),
          correction_text: feedback.kind === 'wrong_because' ? redact(feedback.text ?? '') : '',
          feedback_timestamp: timestamp,
          failed_fix: feedback.kind === 'didnt_work' ? redact(feedback.text ?? '') : '',
          minutes_to_resolution: String(feedback.minutes_to_resolution ?? ''),
        },
        tags: [RECALL_TAG, `incident:${incident.id}`, `service:${incident.service}`, `feedback:${feedback.kind}`],
      }],
    },
  });
  if (result?.success === false || (result?.items_count ?? 0) < 1) {
    throw new HindsightError('Hindsight did not confirm the feedback memory.', 'hindsight_feedback_failed');
  }
  return { retained: true, document_id: documentId, timestamp };
}

function incidentIdFor(result: HindsightResult): string | undefined {
  if (result.metadata?.incident_id) return result.metadata.incident_id;
  return result.tags?.find((tag) => tag.startsWith('incident:'))?.slice('incident:'.length);
}

const SYMPTOM_STOPWORDS = new Set(['after', 'again', 'also', 'began', 'between', 'during', 'from', 'have', 'into', 'only', 'other', 'remain', 'remains', 'stayed', 'that', 'their', 'there', 'these', 'this', 'those', 'when', 'while', 'with', 'without', 'normal', 'healthy', 'service', 'incident']);

function symptomTerms(incident: ActiveIncident | Incident): Set<string> {
  const normalized = incident.symptoms.join(' ').toLowerCase().replace(/\b5xx\b/g, 'http500').replace(/\b500s?\b/g, 'http500');
  const terms = normalized.match(/[a-z0-9]{4,}/g) ?? [];
  return new Set(terms.map((term) => term.endsWith('ies') && term.length > 5 ? `${term.slice(0, -3)}y` : term.endsWith('s') && term.length > 5 && !term.endsWith('ss') ? term.slice(0, -1) : term).filter((term) => !SYMPTOM_STOPWORDS.has(term)));
}

function comparableEvidence(current: ActiveIncident | Incident, historical: Incident): { comparable: boolean; why: string } {
  const sameService = historical.service.toLowerCase() === current.service.toLowerCase();
  const sameDeploy = Boolean(current.deploy_version && current.deploy_version !== 'unknown' && historical.deploy_version && current.deploy_version === historical.deploy_version);
  const currentTerms = symptomTerms(current);
  const pastTerms = symptomTerms(historical);
  let sharedSymptoms = 0;
  for (const term of currentTerms) if (pastTerms.has(term)) sharedSymptoms += 1;
  const metricBands: Array<[number, number, number]> = [
    [current.metrics.http_500_rate, historical.metrics.http_500_rate, 3],
    [current.metrics.p95_latency_ms, historical.metrics.p95_latency_ms, 1000],
    [current.metrics.db_connection_pct, historical.metrics.db_connection_pct, 80],
    [current.metrics.cpu_pct, historical.metrics.cpu_pct, 85],
    [current.metrics.memory_pct, historical.metrics.memory_pct, 85],
  ];
  const sharedElevatedMetrics = metricBands.filter(([now, past, threshold]) => now >= threshold && past >= threshold).length;
  const similarSymptoms = sharedSymptoms >= 2;
  const similarMetricPattern = sharedElevatedMetrics >= 3;
  // Hindsight scores rank results but are not calibrated across queries. Require a known incident
  // identity plus explicit service/deploy and symptom or elevated-metric evidence instead of a score-only match.
  const comparable = (sameService && (similarSymptoms || similarMetricPattern))
    || (sameDeploy && (similarSymptoms || similarMetricPattern || sharedSymptoms >= 1));
  const reasons: string[] = [];
  if (sameService) reasons.push('same service');
  if (sameDeploy) reasons.push('same deploy version');
  if (similarSymptoms) reasons.push('similar symptom pattern');
  if (similarMetricPattern) reasons.push('similar elevated metric pattern');
  if (!reasons.length && sharedSymptoms >= 1) reasons.push('shared symptom cue');
  return { comparable, why: reasons.join(' · ') };
}

function contradictsCurrentSignal(current: ActiveIncident | Incident, historical: Incident): boolean {
  const present = current.symptoms.join(' ').toLowerCase();
  const past = [historical.symptoms.join(' '), historical.root_cause ?? '', historical.initial_diagnosis ?? ''].join(' ').toLowerCase();
  const conflicts = [
    { domain: /\b(memory|rss|heap)\b/, healthy: /\b(stable|normal|healthy|low)\b/, failed: /\b(leak|growth|growing|high|elevated|increas(?:e|ed|ing)|rising|spik(?:e|ed)|saturat(?:e|ed|ion))\b/ },
    { domain: /\b(certificates?|tls|certificate)\b/, healthy: /\b(valid|normal|healthy|renewed|current)\b/, failed: /\b(expir(?:e|ed|y)|invalid|untrusted|handshake fail(?:ure)?|tls fail(?:ure)?)\b/ },
    { domain: /\b(database|db|connections?|pool)\b/, healthy: /\b(low|normal|healthy|stable)\b/, failed: /\b(exhaust(?:ed|ion)|leak|saturat(?:ed|ion)|high|elevated|waiters?)\b/ },
    { domain: /\b(disk|volume|storage|wal)\b/, healthy: /\b(low|normal|healthy|stable|available)\b/, failed: /\b(full|no.space|exhaust(?:ed|ion)|saturat(?:ed|ion)|high|elevated)\b/ },
    { domain: /\b(cpu|processor)\b/, healthy: /\b(low|normal|healthy|stable)\b/, failed: /\b(high|elevated|saturat(?:ed|ion)|spik(?:e|ed)|increas(?:e|ed|ing)|rising)\b/ },
  ];
  return conflicts.some(({ domain, healthy, failed }) => domain.test(present) && healthy.test(present) && domain.test(past) && failed.test(past));
}

function recalledText(result: HindsightResult): string {
  const metadata = result.metadata ?? {};
  const additions: string[] = [];
  if (metadata.correction_included === 'true' && metadata.engineer_correction) {
    additions.push(`Engineer correction superseding the initial belief: ${metadata.engineer_correction}`);
  }
  if (metadata.feedback_type === 'wrong_because' && metadata.correction_text) {
    additions.push(`Engineer correction superseding the prior belief: ${metadata.correction_text}`);
  }
  if (metadata.feedback_type === 'didnt_work' && metadata.failed_fix) {
    additions.push(`Failed fix to avoid repeating: ${metadata.failed_fix}`);
  }
  const pieces = [redact(result.text), ...additions.map(redact)].filter(Boolean);
  return [...new Set(pieces)].join('\n');
}

export async function recallIncidentMemories(current: ActiveIncident | Incident): Promise<MemoryMatch[]> {
  const query = [
    `Current ${current.service} incident ${current.id}.`,
    `Symptoms: ${current.symptoms.join('; ')}.`,
    `Metric pattern: HTTP 500 ${current.metrics.http_500_rate}%, p95 ${current.metrics.p95_latency_ms} ms, DB connections ${current.metrics.db_connection_pct}%, CPU ${current.metrics.cpu_pct}%, memory ${current.metrics.memory_pct}%.`,
    `Deploy version: ${current.deploy_version ?? 'unknown'}. Find genuinely comparable historical incidents, failed fixes, and engineer corrections; prefer corrected beliefs over superseded early diagnoses.`,
  ].join(' ');
  const response = await hindsightRequest<RecallResponse>('/memories/recall', {
    method: 'POST',
    body: { query: redact(query), budget: 'mid', max_tokens: 2400, tags: [RECALL_TAG], tags_match: 'any_strict' },
  });
  const results = Array.isArray(response?.results) ? response.results : [];
  const cutoff = Date.now() - 183 * 24 * 60 * 60 * 1000;
  const grouped = new Map<string, MemoryMatch>();
  for (const result of results) {
    // Defense in depth: do not let an unscoped or unrelated bank result become app evidence.
    if (!result.tags?.includes(RECALL_TAG)) continue;
    const incidentId = incidentIdFor(result);
    if (!incidentId) continue;
    const historical = findHistoricalIncident(incidentId);
    if (!historical && incidentId !== current.id) continue;
    const evidence = historical ? comparableEvidence(current, historical) : { comparable: true, why: 'same incident' };
    if (incidentId !== current.id && !evidence.comparable) continue;
    if (historical && incidentId !== current.id && contradictsCurrentSignal(current, historical)) continue;
    const date = result.occurred_start ?? historical?.date ?? null;
    const older = Boolean(date && new Date(date).getTime() < cutoff);
    const score = typeof result.scores?.final === 'number' ? result.scores.final : 0;
    const scoreWeighted = score * (older ? 0.62 : 1);
    const text = recalledText(result);
    const existing = grouped.get(incidentId);
    if (existing) {
      if (!existing.text.includes(text)) existing.text = `${existing.text}\n${text}`;
      existing.metadata = { ...(existing.metadata ?? {}), ...(result.metadata ?? {}) };
      existing.tags = [...new Set([...(existing.tags ?? []), ...(result.tags ?? [])])];
      existing.score = Math.max(existing.score ?? 0, score);
      existing.score_weighted = Math.max(existing.score_weighted ?? 0, scoreWeighted);
      existing.older = Boolean(existing.older && older);
      continue;
    }
    grouped.set(incidentId, {
      id: result.id,
      text,
      type: result.type,
      context: result.context,
      occurred_start: date,
      document_id: result.document_id,
      tags: result.tags,
      metadata: result.metadata,
      score,
      score_weighted: scoreWeighted,
      older,
      why_matched: evidence.why,
      incident: historical,
    });
  }
  return [...grouped.values()].sort((a, b) => (b.score_weighted ?? 0) - (a.score_weighted ?? 0)).slice(0, 6);
}

export async function reflectLesson(query: string): Promise<string | null> {
  const result = await hindsightRequest<{ text?: string; structured_output?: unknown }>('/reflect', {
    method: 'POST',
    body: {
      query: redact(query),
      budget: 'low',
      max_tokens: 480,
      tags: [RECALL_TAG],
      tags_match: 'any_strict',
    },
  });
  return typeof result?.text === 'string' && result.text.trim() ? redact(result.text.trim()) : null;
}

export async function getIncidentTimeline(incidentId: string): Promise<{
  incident: Incident | undefined;
  original_belief: string | null;
  correction: string | null;
  correction_timestamp: string | null;
  current_belief: string | null;
  memories: MemoryMatch[];
}> {
  const incident = findHistoricalIncident(incidentId);
  const base: ActiveIncident | Incident = incident ?? {
    id: incidentId,
    service: 'unknown',
    severity: 'SEV-3',
    status: 'investigating',
    symptoms: [`incident ${incidentId}`],
    metrics: { http_500_rate: 0, p95_latency_ms: 0, db_connection_pct: 0, cpu_pct: 0, memory_pct: 0 },
    log_snippet: [],
    deploy_version: 'unknown',
    started_at: new Date().toISOString(),
    root_cause: null,
  };
  const memories = await recallIncidentMemories(base);
  const corrections = memories.flatMap((memory) => {
    const metadata = memory.metadata ?? {};
    if (metadata.feedback_type === 'wrong_because' && metadata.correction_text) {
      return [{ text: metadata.correction_text, timestamp: metadata.feedback_timestamp ?? memory.occurred_start ?? null, feedback: true }];
    }
    if (metadata.correction_included === 'true' && metadata.engineer_correction) {
      return [{ text: metadata.engineer_correction, timestamp: memory.occurred_start ?? null, feedback: false }];
    }
    const match = memory.text.match(/Engineer correction (?:superseding the initial belief|supersedes the prior belief for [^:]+):\s*([\s\S]+)/i);
    if (!match) return [];
    const text = match[1].split(/\s+Incident [A-Z]+-?\d+, service /i)[0].trim();
    const isFeedback = /supersedes the prior belief for /i.test(match[0]);
    return text ? [{ text, timestamp: memory.occurred_start ?? null, feedback: isFeedback }] : [];
  }).sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime());
  const correction = corrections[0]?.text ?? null;
  const recalledMetadata = memories.find((memory) => memory.metadata?.incident_id === incidentId)?.metadata;
  const original = recalledMetadata?.initial_diagnosis ?? incident?.initial_diagnosis ?? incident?.hypotheses_tried[0] ?? null;
  const current = corrections[0]?.feedback
    ? correction
    : (correction ? (recalledMetadata?.root_cause ?? incident?.root_cause ?? correction) : null);
  return {
    incident,
    original_belief: original,
    correction,
    correction_timestamp: corrections[0]?.timestamp ?? (correction ? incident?.date ?? null : null),
    current_belief: current,
    memories,
  };
}
