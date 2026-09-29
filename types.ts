export type Severity = 'SEV-1' | 'SEV-2' | 'SEV-3';
export type IncidentStatus = 'active' | 'resolved' | 'recurred';
export type Confidence = 'low' | 'medium' | 'high';

export interface Metrics {
  http_500_rate: number;
  p95_latency_ms: number;
  db_connection_pct: number;
  cpu_pct: number;
  memory_pct: number;
}

export interface Outcome {
  status: 'resolved' | 'recurred';
  minutes_to_resolve: number;
}

export interface Incident {
  id: string;
  date: string;
  service: string;
  severity: Severity;
  symptoms: string[];
  metrics: Metrics;
  log_snippet: string[];
  hypotheses_tried: string[];
  failed_fixes: string[];
  root_cause: string | null;
  resolution: string | null;
  outcome: Outcome | null;
  deploy_version: string | null;
  engineer_correction: string | null;
  initial_diagnosis?: string;
  evaluation_group?: string;
}

export interface ActiveIncident {
  id: string;
  service: string;
  severity: Severity;
  status: 'investigating';
  symptoms: string[];
  metrics: Metrics;
  log_snippet: string[];
  deploy_version: string;
  started_at: string;
  root_cause: null;
}

export interface MemoryMatch {
  id: string;
  text: string;
  type?: string;
  context?: string | null;
  occurred_start?: string | null;
  document_id?: string | null;
  tags?: string[];
  metadata?: Record<string, string>;
  score?: number;
  score_weighted?: number;
  older?: boolean;
  why_matched: string;
  incident?: Incident;
}

export interface Analysis {
  possible_cause: string;
  confidence: Confidence;
  recommended_steps: string[];
  things_not_to_do: string[];
  cited_incident_ids: string[];
  comparable_status: 'matches' | 'no_comparable_incident' | 'memory_off';
  similar_incidents: MemoryMatch[];
  lesson_from_previous_incident?: string | null;
  model: string;
}

export type FeedbackKind = 'worked' | 'didnt_work' | 'wrong_because';

export interface FeedbackPayload {
  kind: FeedbackKind;
  text?: string;
  minutes_to_resolution?: number;
}

export interface EvaluationCase {
  id: string;
  service: string;
  symptoms: string[];
  metrics: Metrics;
  deploy_version: string;
  correct_cause: string;
}

export interface EvaluationRow {
  id: string;
  service: string;
  correct_cause: string;
  memory_off_prediction: string;
  memory_off_correct: boolean;
  memory_on_prediction: string;
  memory_on_correct: boolean;
  memory_off_cumulative_accuracy: number;
  memory_on_cumulative_accuracy: number;
  cited_incident_ids: string[];
}

export interface EvaluationRun {
  run_id: string;
  started_at: string;
  completed_at: string;
  rows: EvaluationRow[];
  memory_off_top1_accuracy: number;
  memory_on_top1_accuracy: number;
  source: 'live_groq_and_hindsight';
}
