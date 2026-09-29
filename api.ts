import type { ActiveIncident, Analysis, EvaluationRun, FeedbackPayload, Incident } from '../shared/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code = 'api_error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('The Recall API is unreachable. Check the connection and try again.', 0, 'network_error');
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const detail = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : {};
    throw new ApiError(String(detail.message ?? `Request failed with HTTP ${response.status}.`), response.status, String(detail.code ?? 'api_error'));
  }
  if (payload === null) throw new ApiError('The server returned an unreadable response.', response.status, 'invalid_response');
  return payload as T;
}

export const api = {
  activeIncidents: () => request<{ incidents: ActiveIncident[] }>('/api/incidents/active'),
  historicalIncidents: () => request<{ incidents: Array<Pick<Incident, 'id' | 'date' | 'service' | 'severity'>> }>('/api/incidents/history'),
  incident: (id: string) => request<{ incident: Incident }>(`/api/incidents/${encodeURIComponent(id)}`),
  analyze: (id: string, memoryEnabled: boolean) => request<{ analysis: Analysis }>(`/api/incidents/${encodeURIComponent(id)}/analyze`, {
    method: 'POST', body: JSON.stringify({ memoryEnabled }),
  }),
  compare: (id: string) => request<{ comparison: { without_memory: Analysis; with_memory: Analysis } }>(`/api/compare/${encodeURIComponent(id)}`, {
    method: 'POST', body: JSON.stringify({}),
  }),
  feedback: (id: string, feedback: FeedbackPayload) => request<{ feedback: { retained: boolean; timestamp: string; incident_id: string; service: string; minutes_to_resolution: number | null } }>(`/api/incidents/${encodeURIComponent(id)}/feedback`, {
    method: 'POST', body: JSON.stringify(feedback),
  }),
  timeline: (id: string) => request<{ timeline: {
    incident?: { id: string; date: string; service: string; severity: string };
    original_belief: string | null;
    correction: string | null;
    correction_timestamp: string | null;
    current_belief: string | null;
    memories: Analysis['similar_incidents'];
  } }>(`/api/memory/timeline/${encodeURIComponent(id)}`),
  runEvaluation: () => request<{ evaluation: EvaluationRun }>('/api/eval/run', {
    method: 'POST', body: JSON.stringify({}),
  }),
  seed: (includeHeroCorrection = true) => request<{ seed: { retained: number; correction_included: boolean; incidents: number } }>('/api/admin/seed', {
    method: 'POST', body: JSON.stringify({ includeHeroCorrection }),
  }),
  reset: () => request<{ reset: { deleted_count: number; message: string } }>('/api/admin/reset', {
    method: 'POST', body: JSON.stringify({ confirmed: true }),
  }),
};
