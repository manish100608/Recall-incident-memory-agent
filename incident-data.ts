import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActiveIncident, EvaluationCase, Incident } from '../shared/types.js';

function readFixture<T>(name: string): T {
  const file = join(process.cwd(), 'data', name);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export const historicalIncidents = readFixture<Incident[]>('incidents.json');
export const activeIncidents = readFixture<ActiveIncident[]>('active_incidents.json');
export const evaluationCases = readFixture<EvaluationCase[]>('eval_cases.json');

export function findHistoricalIncident(id: string): Incident | undefined {
  return historicalIncidents.find((incident) => incident.id === id);
}

export function findActiveIncident(id: string): ActiveIncident | undefined {
  return activeIncidents.find((incident) => incident.id === id);
}
