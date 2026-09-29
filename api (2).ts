import express, { type Request, type Response } from 'express';
import type { FeedbackPayload } from '../shared/types.js';
import { activeIncidents, findActiveIncident, findHistoricalIncident, historicalIncidents } from './incident-data.js';
import { analysisErrorMessage, compareMemory, runAnalysis, runEvaluation } from './analysis-service.js';
import { clearHindsightBank, getIncidentTimeline, HindsightError, retainFeedback, seedPastIncidents } from './hindsight.js';
import { redact } from './safety.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/_app/health') {
    res.setHeader('Cache-Control', 'private, no-store');
  }
  next();
});

function sendError(res: Response, error: unknown, defaultMessage: string) {
  const parsed = analysisErrorMessage(error);
  return res.status(parsed.status).json({ error: { code: parsed.code, message: parsed.message || defaultMessage } });
}

function isFeedbackKind(value: unknown): value is FeedbackPayload['kind'] {
  return value === 'worked' || value === 'didnt_work' || value === 'wrong_because';
}

app.get('/_app/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'recall-api' }));

app.get('/api/incidents/active', (_req, res) => {
  res.json({ incidents: activeIncidents });
});

app.get('/api/incidents/history', (_req, res) => {
  res.json({ incidents: historicalIncidents.map(({ id, date, service, severity }) => ({ id, date, service, severity })) });
});

app.get('/api/incidents/:id', (req, res) => {
  const id = String(req.params.id);
  const incident = findActiveIncident(id) ?? findHistoricalIncident(id);
  if (!incident) return res.status(404).json({ error: { code: 'incident_not_found', message: `Incident ${id} was not found.` } });
  return res.json({ incident });
});

app.post('/api/incidents/:id/analyze', async (req, res) => {
  const incident = findActiveIncident(String(req.params.id));
  if (!incident) return res.status(404).json({ error: { code: 'incident_not_found', message: 'Active incident not found.' } });
  const memoryEnabled = req.body?.memoryEnabled ?? true;
  if (typeof memoryEnabled !== 'boolean') return res.status(400).json({ error: { code: 'invalid_request', message: 'memoryEnabled must be a boolean.' } });
  try {
    const analysis = await runAnalysis(incident, memoryEnabled);
    return res.json({ analysis });
  } catch (error) {
    return sendError(res, error, 'Incident analysis could not be completed.');
  }
});

app.post('/api/incidents/:id/feedback', async (req, res) => {
  const incidentId = String(req.params.id);
  const incident = findActiveIncident(incidentId) ?? findHistoricalIncident(incidentId);
  if (!incident) return res.status(404).json({ error: { code: 'incident_not_found', message: 'Incident not found.' } });
  const kind = req.body?.kind;
  if (!isFeedbackKind(kind)) return res.status(400).json({ error: { code: 'invalid_feedback', message: 'kind must be worked, didnt_work, or wrong_because.' } });
  const text = typeof req.body?.text === 'string' ? redact(req.body.text).trim().slice(0, 1200) : '';
  if (kind === 'wrong_because' && !text) return res.status(400).json({ error: { code: 'correction_required', message: 'Add the engineer correction before saving it.' } });
  const suppliedMinutes = Number(req.body?.minutes_to_resolution);
  const elapsedMinutes = 'started_at' in incident
    ? Math.max(1, Math.round((Date.now() - new Date(incident.started_at).getTime()) / 60_000))
    : incident.outcome?.minutes_to_resolve ?? 1;
  const minutes = kind === 'worked'
    ? (Number.isFinite(suppliedMinutes) && suppliedMinutes > 0 ? Math.round(suppliedMinutes) : elapsedMinutes)
    : undefined;
  const feedback: FeedbackPayload = { kind, ...(text ? { text } : {}), ...(minutes ? { minutes_to_resolution: minutes } : {}) };
  try {
    const saved = await retainFeedback(incident, feedback);
    return res.json({ feedback: { kind, retained: true, incident_id: incident.id, service: incident.service, timestamp: saved.timestamp, minutes_to_resolution: minutes ?? null } });
  } catch (error) {
    return sendError(res, error, 'Feedback could not be retained in Hindsight.');
  }
});

app.get('/api/memory/timeline/:incidentId', async (req, res) => {
  try {
    const timeline = await getIncidentTimeline(String(req.params.incidentId));
    return res.json({ timeline });
  } catch (error) {
    return sendError(res, error, 'Memory timeline could not be loaded from Hindsight.');
  }
});

app.post('/api/compare/:id', async (req, res) => {
  const incident = findActiveIncident(String(req.params.id));
  if (!incident) return res.status(404).json({ error: { code: 'incident_not_found', message: 'Active incident not found.' } });
  try {
    const comparison = await compareMemory(incident);
    return res.json({ comparison });
  } catch (error) {
    return sendError(res, error, 'Memory comparison could not be completed.');
  }
});

app.post('/api/admin/seed', async (req, res) => {
  const includeHeroCorrection = req.body?.includeHeroCorrection ?? true;
  if (typeof includeHeroCorrection !== 'boolean') return res.status(400).json({ error: { code: 'invalid_request', message: 'includeHeroCorrection must be a boolean.' } });
  try {
    const seeded = await seedPastIncidents(includeHeroCorrection);
    return res.json({ seed: { ...seeded, correction_included: includeHeroCorrection, incidents: historicalIncidents.length } });
  } catch (error) {
    return sendError(res, error, 'Incident memories could not be seeded in Hindsight.');
  }
});

app.post('/api/admin/reset', async (req, res) => {
  if (req.body?.confirmed !== true) return res.status(400).json({ error: { code: 'confirmation_required', message: 'Set confirmed=true after the UI warning before clearing the configured Hindsight bank.' } });
  try {
    const reset = await clearHindsightBank();
    return res.json({ reset });
  } catch (error) {
    if (error instanceof HindsightError) return sendError(res, error, 'Hindsight bank reset failed.');
    return sendError(res, error, 'Hindsight bank reset failed.');
  }
});

app.post('/api/eval/run', async (_req, res) => {
  try {
    const run = await runEvaluation();
    return res.json({ evaluation: run });
  } catch (error) {
    return sendError(res, error, 'Live evaluation did not complete; no scores were fabricated.');
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'route_not_found', message: 'API route not found.' } }));
app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? redact(error.message) : 'Unexpected server error.';
  res.status(500).json({ error: { code: 'server_error', message } });
});

export default app;
