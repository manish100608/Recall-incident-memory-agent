import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertCircle, ArrowRight, Check, ChevronDown, Clock3, Database, History, Loader2, Search, ShieldCheck, Sparkles, TrendingUp, X } from 'lucide-react';
import type { ActiveIncident, Analysis, EvaluationRun, FeedbackKind } from '../shared/types';
import { api, ApiError } from './api';
import DemoReplay from './DemoReplay';

type Screen = 'investigation' | 'memory' | 'evaluation';
const screens: Array<{ id: Screen; label: string; path: string; icon: typeof Activity }> = [
  { id: 'investigation', label: 'Investigation', path: '/', icon: Activity },
  { id: 'memory', label: 'Memory timeline', path: '/memory', icon: History },
  { id: 'evaluation', label: 'Evaluation', path: '/evaluation', icon: TrendingUp },
];

function screenFromPath(): Screen {
  if (window.location.pathname === '/memory') return 'memory';
  if (window.location.pathname === '/evaluation') return 'evaluation';
  return 'investigation';
}
function formatDate(value: string | null | undefined): string {
  if (!value) return 'Timestamp unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(date);
}
function shortDate(value: string | undefined): string {
  if (!value) return 'Date not recorded';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}
function severityClass(severity: string): string {
  return severity.toLowerCase().replace('-', '');
}
function friendlyError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

function Header({ screen, navigate }: { screen: Screen; navigate: (next: Screen) => void }) {
  return <header className="topbar">
    <div className="brand-lockup">
      <img className="brand-mark" src="/recall-mark.png" alt="" />
      <span className="brand-name">Recall<span className="brand-dot">.</span></span>
      <span className="brand-divider" />
      <span className="brand-context">On-call memory</span>
    </div>
    <nav className="main-nav" aria-label="Main navigation">
      {screens.map(({ id, label, path, icon: Icon }) => <button key={id} type="button" className={`nav-item ${screen === id ? 'active' : ''}`} onClick={() => navigate(id)}>
        <Icon size={15} strokeWidth={1.8} /> <span>{label}</span>
      </button>)}
    </nav>
    <div className="header-status">
      <span className="status-pip" /> <span>Incident workspace</span>
    </div>
  </header>;
}

function SafetyBanner() {
  return <div className="safety-banner"><ShieldCheck size={16} /><span>Recommendations only. Recall never executes actions.</span><span className="safety-separator" /><span className="safety-note">Human review required</span></div>;
}

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`severity-badge ${severityClass(severity)}`}><span className="severity-dot" />{severity}</span>;
}

function MetricCard({ label, value, unit, tone = '' }: { label: string; value: number; unit: string; tone?: string }) {
  return <div className={`metric-card ${tone}`}>
    <span className="metric-label">{label}</span>
    <span className="metric-value">{value}<small>{unit}</small></span>
  </div>;
}

function ConfidencePill({ value }: { value: string }) {
  return <span className={`confidence-pill confidence-${value}`}>{value} confidence</span>;
}

function AnalysisSummary({ analysis, memorySide = false, compact = false }: { analysis: Analysis; memorySide?: boolean; compact?: boolean }) {
  return <div className={`analysis-summary ${memorySide ? 'memory-highlight' : ''} ${compact ? 'compact-summary' : ''}`}>
    <div className="summary-topline">
      <div className="summary-title"><Sparkles size={15} /><span>Possible cause</span>{memorySide && <span className="memory-only-chip">HINDSIGHT</span>}</div>
      <ConfidencePill value={analysis.confidence} />
    </div>
    <p className="cause-text">{analysis.possible_cause}</p>
    <div className="analysis-columns">
      <div><h4>Recommended steps</h4><ul>{analysis.recommended_steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ul></div>
      <div className="dont-do"><h4>Things not to do</h4><ul>{analysis.things_not_to_do.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ul></div>
    </div>
    {analysis.cited_incident_ids.length > 0 && <div className="citation-line"><History size={13} /><span>Evidence:</span>{analysis.cited_incident_ids.map((id) => <span className="incident-citation" key={id}>{id}</span>)}</div>}
    {analysis.comparable_status === 'no_comparable_incident' && <div className="empty-memory"><Search size={14} /><span>No comparable past incident found</span></div>}
    {memorySide && analysis.lesson_from_previous_incident && <div className="lesson-note"><span className="lesson-label">Lesson from previous incident</span><p>{analysis.lesson_from_previous_incident}</p></div>}
    {memorySide && analysis.comparable_status === 'matches' && !analysis.lesson_from_previous_incident && <div className="reflect-note">Hindsight Reflect did not return a lesson for this request; recalled incident evidence remains available.</div>}
    <div className="model-stamp">Analysis by {analysis.model}</div>
  </div>;
}

function MemoryCard({ memory }: { memory: Analysis['similar_incidents'][number] }) {
  const incident = memory.incident;
  return <article className="memory-card">
    <div className="memory-card-top">
      <div><span className="memory-id">{incident?.id ?? memory.metadata?.incident_id ?? 'Historical memory'}</span><span className="memory-date">{shortDate(incident?.date ?? memory.occurred_start ?? undefined)}</span></div>
      {memory.older && <span className="older-badge">Older incident</span>}
    </div>
    <div className="memory-service-row"><span className="memory-service">{incident?.service ?? memory.metadata?.service ?? 'Service not recorded'}</span>{incident?.outcome && <span className={`outcome-tag ${incident.outcome.status}`}>{incident.outcome.status}</span>}</div>
    <p className="memory-root-cause"><strong>Root cause</strong>{incident?.root_cause ?? memory.text}</p>
    {incident?.failed_fixes?.[0] && <p className="memory-failed"><strong>What failed last time</strong>{incident.failed_fixes[0]}</p>}
    <div className="why-match"><span>Why this matched</span><p>{memory.why_matched}</p></div>
    <div className="memory-score"><span>Hindsight relevance</span><span>{typeof memory.score === 'number' ? memory.score.toFixed(2) : 'retrieved'}</span></div>
  </article>;
}

function Investigation({
  incidents, incidentsLoading, incidentsError, selectedId, onSelect, analysis, analysisLoading, analysisError,
  memoryOn, onMemoryToggle, onRetry, comparison, comparisonLoading, comparisonError, onFeedback,
}: {
  incidents: ActiveIncident[]; incidentsLoading: boolean; incidentsError: string; selectedId: string; onSelect: (id: string) => void;
  analysis: Analysis | null; analysisLoading: boolean; analysisError: string; memoryOn: boolean; onMemoryToggle: () => void;
  onRetry: () => void; comparison: { without_memory: Analysis; with_memory: Analysis } | null;
  comparisonLoading: boolean; comparisonError: string; onFeedback: (kind: FeedbackKind, text?: string) => Promise<void>;
}) {
  const selected = incidents.find((incident) => incident.id === selectedId) ?? incidents[0];
  const [logsOpen, setLogsOpen] = useState(false);
  const [wrongOpen, setWrongOpen] = useState(false);
  const [wrongText, setWrongText] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  useEffect(() => { setLogsOpen(false); setWrongOpen(false); setWrongText(''); setFeedbackMessage(''); setFeedbackError(''); }, [selectedId]);
  const submitFeedback = async (kind: FeedbackKind, text?: string) => {
    setFeedbackBusy(true); setFeedbackError(''); setFeedbackMessage('');
    try { await onFeedback(kind, text); setFeedbackMessage('Feedback retained in Hindsight.'); setWrongOpen(false); setWrongText(''); }
    catch (error) { setFeedbackError(friendlyError(error)); }
    finally { setFeedbackBusy(false); }
  };
  return <main className="page-wrap">
    <div className="page-heading">
      <div><div className="eyebrow"><span className="eyebrow-dot" />LIVE INCIDENT RESPONSE</div><h1>Investigate with memory.</h1><p>Ground the next decision in what your team has already learned.</p></div>
      <div className="heading-meta"><span className="heading-time"><Clock3 size={14} />Updated just now</span><span className="live-badge"><span className="status-pip" />Live workspace</span></div>
    </div>
    <SafetyBanner />
    <div className="investigation-grid">
      <aside className="panel incident-queue">
        <div className="panel-heading"><div><div className="eyebrow small">ON-CALL QUEUE</div><h2>Active incidents <span className="count-pill">{incidents.length || '—'}</span></h2></div><span className="queue-live">LIVE</span></div>
        {incidentsLoading && <div className="state-inline"><Loader2 className="spin" size={16} />Loading active incidents…</div>}
        {incidentsError && <div className="inline-error"><AlertCircle size={15} /><span>{incidentsError}</span></div>}
        <div className="incident-list">
          {incidents.map((incident) => <button key={incident.id} type="button" className={`incident-row ${selected?.id === incident.id ? 'selected' : ''}`} onClick={() => onSelect(incident.id)}>
            <div className="incident-row-top"><span className="incident-id">{incident.id}</span><SeverityBadge severity={incident.severity} /></div>
            <div className="incident-service">{incident.service}</div>
            <div className="incident-row-foot"><span className="row-status"><span />Investigating</span><span>{incident.metrics.http_500_rate.toFixed(1)}% 5xx</span></div>
          </button>)}
        </div>
        <div className="queue-footer"><span className="status-pip" />Active response channel</div>
      </aside>

      <section className="center-column">
        {!selected && <div className="panel empty-panel"><div className="empty-icon"><Activity size={18} /></div><h2>{incidentsError ? 'Incident queue unavailable' : 'No active incidents'}</h2><p>{incidentsError || 'Active incidents will appear here when the API is available.'}</p></div>}
        {selected && <>
          <section className="panel incident-detail">
            <div className="incident-title-row"><div><div className="incident-overline">{selected.id}<span className="overline-divider">/</span> ACTIVE INCIDENT</div><h2>{selected.service}</h2></div><SeverityBadge severity={selected.severity} /></div>
            <div className="symptom-section"><h3>Current symptoms</h3><ul className="symptom-list">{selected.symptoms.map((symptom) => <li key={symptom}><span className="symptom-dot" />{symptom}</li>)}</ul></div>
            <div className="metric-grid">
              <MetricCard label="HTTP 500 rate" value={selected.metrics.http_500_rate} unit="%" tone="danger" />
              <MetricCard label="P95 latency" value={selected.metrics.p95_latency_ms} unit="ms" tone="warning" />
              <MetricCard label="DB connections" value={selected.metrics.db_connection_pct} unit="%" tone="warning" />
              <MetricCard label="CPU" value={selected.metrics.cpu_pct} unit="%" />
              <MetricCard label="Memory" value={selected.metrics.memory_pct} unit="%" />
            </div>
            <div className="deploy-strip"><span className="deploy-label">DEPLOY</span><code>{selected.deploy_version}</code><span className="deploy-sep" /><span className="deploy-status">Root cause not yet confirmed</span></div>
            <button className="log-toggle" type="button" onClick={() => setLogsOpen((open) => !open)} aria-expanded={logsOpen}><span><Activity size={14} />Recent log excerpt</span><ChevronDown size={15} className={logsOpen ? 'rotate' : ''} /></button>
            {logsOpen && <pre className="log-block">{selected.log_snippet.join('\n')}</pre>}
          </section>

          <section className="panel analysis-panel">
            <div className="panel-heading analysis-heading"><div><div className="eyebrow small"><Sparkles size={12} />AI-ASSISTED TRIAGE</div><h2>Analysis <span className="ai-label">RECOMMENDATIONS ONLY</span></h2></div>
              <div className="analysis-actions"><button type="button" className={`memory-switch ${memoryOn ? 'is-on' : ''}`} role="switch" aria-checked={memoryOn} aria-busy={comparisonLoading} disabled={comparisonLoading} onClick={onMemoryToggle}><Database size={13} /><span>Hindsight memory</span><strong>{memoryOn ? 'ON' : 'OFF'}</strong></button></div>
            </div>
            {analysisLoading && !comparisonLoading && <div className="analysis-loading"><div className="loading-orbit"><Loader2 size={20} className="spin" /></div><div><strong>{memoryOn ? 'Recalling team experience…' : 'Analyzing current signals…'}</strong><span>{memoryOn ? 'Checking real Hindsight memories, then asking Groq.' : 'Memory is off for this analysis.'}</span></div></div>}
            {analysisError && <div className="error-state"><AlertCircle size={16} /><div><strong>Analysis unavailable</strong><span>{analysisError}</span></div><button type="button" onClick={onRetry}>Retry</button></div>}
            {!analysisLoading && !comparisonLoading && !comparison && !analysisError && analysis && <AnalysisSummary analysis={analysis} memorySide={memoryOn} />}
            {comparisonError && !analysisError && <div className="inline-error comparison-error"><AlertCircle size={15} />{comparisonError}</div>}
            {comparisonLoading && <div className="comparison-loading"><Loader2 className="spin" size={16} />Running independent memory-off and memory-on analyses…</div>}
            {!comparisonLoading && comparison && <div className="comparison-block">
              <div className="comparison-title-row"><div><span className="eyebrow small">SIDE-BY-SIDE</span><h3>What memory changes</h3></div><button type="button" className="icon-button" aria-label="Close comparison" onClick={() => window.dispatchEvent(new CustomEvent('recall:close-comparison'))}><X size={15} /></button></div>
              <div className="comparison-grid"><div className="comparison-card"><div className="comparison-card-title"><span className="comparison-dot off" />Without memory</div><AnalysisSummary analysis={comparison.without_memory} compact /></div><div className="comparison-card memory-side"><div className="comparison-card-title"><span className="comparison-dot on" />With Hindsight memory</div><AnalysisSummary analysis={comparison.with_memory} memorySide compact /></div></div>
            </div>}
            <FeedbackPanel onSubmit={submitFeedback} busy={feedbackBusy} message={feedbackMessage} error={feedbackError} wrongOpen={wrongOpen} setWrongOpen={setWrongOpen} wrongText={wrongText} setWrongText={setWrongText} />
          </section>
        </>}
      </section>

      <aside className="panel similar-panel">
        <div className="panel-heading similar-heading"><div><div className="eyebrow small"><Database size={12} />HINDSIGHT MEMORY</div><h2>Similar incidents</h2></div><span className={`memory-state ${memoryOn ? 'enabled' : ''}`}>{memoryOn ? 'ON' : 'OFF'}</span></div>
        {!memoryOn && <div className="memory-off-state"><div className="empty-icon"><Database size={17} /></div><strong>Memory is off</strong><p>Turn on Hindsight memory to compare current symptoms with past incidents.</p></div>}
        {memoryOn && analysisLoading && <div className="memory-loading"><Loader2 className="spin" size={16} /><span>Retrieving relevant history…</span></div>}
        {memoryOn && analysisError && <div className="memory-off-state error-memory"><AlertCircle size={17} /><strong>Memory unavailable</strong><p>{analysisError}</p></div>}
        {memoryOn && !analysisLoading && !analysisError && analysis?.comparable_status === 'no_comparable_incident' && <div className="memory-off-state"><div className="empty-icon"><Search size={17} /></div><strong>No comparable past incident found</strong><p>Hindsight returned no relevant memory for this symptom pattern. No match is being forced.</p></div>}
        {memoryOn && !analysisLoading && !analysisError && analysis?.similar_incidents.map((memory) => <MemoryCard key={memory.id} memory={memory} />)}
        {memoryOn && !analysisLoading && !analysisError && analysis && analysis.similar_incidents.length === 0 && analysis.comparable_status === 'matches' && <div className="memory-off-state"><Search size={17} /><strong>No comparable past incident found</strong></div>}
        <div className="similar-footer"><span className="hindsight-mark"><Database size={13} /></span><span>Long-term memory powered by Hindsight</span></div>
      </aside>
    </div>
    <DemoReplay />
  </main>;
}

function FeedbackPanel({ onSubmit, busy, message, error, wrongOpen, setWrongOpen, wrongText, setWrongText }: {
  onSubmit: (kind: FeedbackKind, text?: string) => Promise<void>; busy: boolean; message: string; error: string;
  wrongOpen: boolean; setWrongOpen: (value: boolean) => void; wrongText: string; setWrongText: (value: string) => void;
}) {
  return <div className="feedback-area">
    <div className="feedback-heading"><div><span className="eyebrow small">CLOSE THE LOOP</span><h3>Was this useful?</h3></div><span className="feedback-source">Your feedback updates Hindsight</span></div>
    <div className="feedback-buttons"><button type="button" className="feedback-button worked" disabled={busy} onClick={() => void onSubmit('worked')}><Check size={14} />Worked</button><button type="button" className="feedback-button" disabled={busy} onClick={() => void onSubmit('didnt_work')}><X size={14} />Didn’t work</button><button type="button" className="feedback-button wrong" disabled={busy} onClick={() => setWrongOpen(!wrongOpen)}>Wrong because…</button></div>
    {wrongOpen && <div className="correction-form"><label htmlFor="correction">Engineer correction <span>— this supersedes the earlier belief</span></label><textarea id="correction" rows={3} value={wrongText} onChange={(event) => setWrongText(event.target.value)} placeholder="What was actually wrong, and what did the evidence show?" /><div className="correction-actions"><span>Stored as a timestamped Hindsight memory.</span><button type="button" className="button-primary small-button" disabled={busy || !wrongText.trim()} onClick={() => void onSubmit('wrong_because', wrongText.trim())}>{busy ? <Loader2 size={14} className="spin" /> : 'Save correction'}<ArrowRight size={14} /></button></div></div>}
    {busy && <span className="feedback-status"><Loader2 size={13} className="spin" />Saving to Hindsight…</span>}
    {message && <span className="feedback-status success"><Check size={13} />{message}</span>}
    {error && <span className="feedback-status error"><AlertCircle size={13} />{error}</span>}
  </div>;
}

function MemoryTimeline({ selectedId }: { selectedId: string }) {
  const [incidents, setIncidents] = useState<Array<{ id: string; date: string; service: string; severity: string }>>([]);
  const [incidentId, setIncidentId] = useState(selectedId || 'INC-0831');
  const [timeline, setTimeline] = useState<Awaited<ReturnType<typeof api.timeline>>['timeline'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { setIncidentId(selectedId || 'INC-0831'); }, [selectedId]);
  useEffect(() => {
    let alive = true;
    api.historicalIncidents().then(({ incidents: found }) => {
      if (!alive) return;
      setIncidents(found);
      if (!found.some((item) => item.id === incidentId) && found[0]) setIncidentId(found[0].id);
    }).catch((reason) => { if (alive) setError(friendlyError(reason)); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(''); setTimeline(null);
    api.timeline(incidentId).then((result) => { if (alive) setTimeline(result.timeline); })
      .catch((reason) => { if (alive) setError(friendlyError(reason)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [incidentId, reloadKey]);
  const correction = timeline?.correction;
  const corrected = Boolean(correction);
  return <main className="page-wrap subpage-wrap">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" />MEMORY EVOLUTION</div><h1>Beliefs change. Keep the trail.</h1><p>See how evidence and engineer corrections reshape the current understanding.</p></div><div className="heading-meta"><span className="memory-source-pill"><Database size={13} />REAL HINDSIGHT MEMORY</span></div></div>
    <SafetyBanner />
    <section className="panel timeline-panel">
      <div className="timeline-toolbar"><div><span className="eyebrow small">INCIDENT CHAIN</span><h2>{timeline?.incident?.id ?? incidentId} <span className="service-inline">/ {timeline?.incident?.service ?? 'Incident history'}</span></h2></div><label className="select-wrap"><span>Incident</span><select value={incidentId} onChange={(event) => setIncidentId(event.target.value)}>{incidents.map((item) => <option key={item.id} value={item.id}>{item.id} — {item.service}</option>)}</select><ChevronDown size={15} /></label></div>
      {loading && <div className="timeline-loading"><Loader2 className="spin" size={18} />Loading timeline from Hindsight…</div>}
      {error && <div className="error-state timeline-error"><AlertCircle size={16} /><div><strong>Timeline unavailable</strong><span>{error}</span></div><button type="button" onClick={() => setReloadKey((key) => key + 1)}>Retry</button></div>}
      {!loading && !error && timeline && <div className="belief-timeline">
        <div className={`belief-step ${corrected ? 'superseded' : ''}`}><div className="timeline-rail"><span className="timeline-node belief-node"><Search size={13} /></span><span className="timeline-line" /></div><article className="belief-card"><div className="belief-meta"><span className="belief-kicker">ORIGINAL BELIEF</span><span className="belief-time">{formatDate(timeline.incident?.date)}</span></div><h3 className={corrected ? 'struck' : ''}>{timeline.original_belief ?? 'No original diagnosis has been retained.'}</h3>{corrected && <span className="superseded-label">Superseded by later evidence</span>}</article></div>
        <div className={`belief-step ${corrected ? 'correction-step' : 'waiting-step'}`}><div className="timeline-rail"><span className="timeline-node correction-node"><History size={14} /></span><span className="timeline-line" /></div><article className="belief-card correction-card"><div className="belief-meta"><span className="belief-kicker">ENGINEER CORRECTION</span><span className="belief-time">{formatDate(timeline.correction_timestamp)}</span></div><h3>{correction ?? 'No engineer correction has been recalled from Hindsight yet.'}</h3>{corrected && <span className="superseded-label correction-label">Supersedes the earlier belief</span>}</article></div>
        <div className="belief-step"><div className="timeline-rail"><span className="timeline-node current-node"><Check size={14} /></span></div><article className="belief-card current-card"><div className="belief-meta"><span className="belief-kicker">CURRENT BELIEF</span><span className="belief-time">{corrected ? 'Based on corrected memory' : 'Awaiting correction'}</span></div><h3>{timeline.current_belief ?? 'No corrected root cause is currently recorded.'}</h3></article></div>
      </div>}
      <div className="timeline-footer"><ShieldCheck size={14} /><span>Superseded beliefs remain visible for context and are never treated as current truth.</span></div>
    </section>
    {timeline?.memories?.length ? <section className="timeline-evidence"><div className="section-title"><div><span className="eyebrow small">RECALLED EVIDENCE</span><h2>Hindsight memories</h2></div><span>{timeline.memories.length} matches</span></div><div className="evidence-grid">{timeline.memories.map((memory) => <article className="panel evidence-card" key={memory.id}><div className="evidence-card-meta"><code>{memory.incident?.id ?? memory.metadata?.incident_id}</code><span>{memory.older && 'Older incident'}</span></div><p>{memory.text}</p></article>)}</div></section> : null}
  </main>;
}

function AccuracyChart({ run }: { run: EvaluationRun }) {
  const width = 760; const height = 250; const left = 42; const right = 18; const top = 18; const bottom = 34;
  const x = (index: number) => left + (run.rows.length <= 1 ? 0 : index * (width - left - right) / (run.rows.length - 1));
  const y = (value: number) => top + (1 - value) * (height - top - bottom);
  const pathFor = (pick: (row: EvaluationRun['rows'][number]) => number) => run.rows.map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(pick(row))}`).join(' ');
  return <div className="chart-frame"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Cumulative top-one accuracy memory off versus on">
    {[0, 0.25, 0.5, 0.75, 1].map((value) => <g key={value}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} className="chart-gridline" /><text x={left-10} y={y(value)+4} textAnchor="end" className="chart-axis-label">{Math.round(value*100)}%</text></g>)}
    <path d={pathFor((row) => row.memory_off_cumulative_accuracy)} className="chart-line chart-line-off" />
    <path d={pathFor((row) => row.memory_on_cumulative_accuracy)} className="chart-line chart-line-on" />
    {run.rows.map((row, index) => <g key={row.id}><circle cx={x(index)} cy={y(row.memory_off_cumulative_accuracy)} r="4" className="chart-dot-off" /><circle cx={x(index)} cy={y(row.memory_on_cumulative_accuracy)} r="4" className="chart-dot-on" /><text x={x(index)} y={height-8} textAnchor="middle" className="chart-axis-label">{index+1}</text></g>)}
  </svg><div className="chart-legend"><span><i className="legend-swatch off" />Memory OFF</span><span><i className="legend-swatch on" />Memory ON</span><span className="chart-axis-note">Incident sequence</span></div></div>;
}

function Evaluation() {
  const [run, setRun] = useState<EvaluationRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const start = async () => {
    setLoading(true); setError(''); setRun(null);
    try { const result = await api.runEvaluation(); setRun(result.evaluation); }
    catch (reason) { setError(friendlyError(reason)); }
    finally { setLoading(false); }
  };
  return <main className="page-wrap subpage-wrap">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" />EVIDENCE, NOT ASSUMPTION</div><h1>Does memory improve triage?</h1><p>Measure cumulative top-1 accuracy across eight held-out incidents.</p></div><button type="button" className="button-primary run-eval-button" onClick={() => void start()} disabled={loading}>{loading ? <><Loader2 size={15} className="spin" />Running live analysis…</> : <><TrendingUp size={15} />Run 8-incident evaluation</>}</button></div>
    <SafetyBanner />
    <section className="panel evaluation-panel">
      <div className="evaluation-top"><div><div className="eyebrow small">CUMULATIVE TOP-1 ACCURACY</div><h2>Memory off vs. on</h2></div>{run && <div className="run-meta"><span>Run {run.run_id.slice(0,8)}</span><span>{formatDate(run.completed_at)}</span><span className="live-result"><span className="status-pip" />Live run</span></div>}</div>
      {loading && <div className="evaluation-loading"><div className="loading-orbit"><Loader2 size={20} className="spin" /></div><div><strong>Running actual model calls</strong><span>Each of the 8 held-out cases is analyzed once without memory and once with Hindsight.</span><span>Results are added only as provider responses complete. This may take a minute.</span></div></div>}
      {error && <div className="error-state evaluation-error"><AlertCircle size={16} /><div><strong>Evaluation did not complete</strong><span>{error}</span><span>No accuracy values were fabricated or reused.</span></div><button type="button" onClick={() => void start()}>Retry</button></div>}
      {!run && !loading && !error && <div className="evaluation-empty"><div className="empty-icon"><TrendingUp size={18} /></div><strong>No evaluation run yet</strong><p>Start a live run to generate model predictions for 8 independent cases. The chart and table will contain only results from this run.</p><span><Database size={13} />Hindsight memories are scoped to Recall; evaluation cases are not seeded into memory.</span></div>}
      {run && !loading && <><div className="evaluation-kpis"><div className="eval-kpi"><span>Memory OFF</span><strong>{(run.memory_off_top1_accuracy*100).toFixed(1)}<small>%</small></strong><span>{run.rows.filter((row) => row.memory_off_correct).length} / {run.rows.length} correct</span></div><div className="eval-kpi memory-kpi"><span>Memory ON</span><strong>{(run.memory_on_top1_accuracy*100).toFixed(1)}<small>%</small></strong><span>{run.rows.filter((row) => row.memory_on_correct).length} / {run.rows.length} correct</span></div><div className="eval-kpi delta-kpi"><span>Accuracy delta</span><strong>{((run.memory_on_top1_accuracy-run.memory_off_top1_accuracy)*100 >= 0 ? '+' : '')}{((run.memory_on_top1_accuracy-run.memory_off_top1_accuracy)*100).toFixed(1)}<small>pp</small></strong><span>Measured on this run only</span></div></div><AccuracyChart run={run} /><div className="results-header"><div><span className="eyebrow small">RUN RESULTS</span><h3>Case-by-case predictions</h3></div><span>{run.rows.length} completed cases</span></div><div className="table-scroll"><table className="results-table"><thead><tr><th>Case</th><th>Service</th><th>Known cause</th><th>Memory OFF</th><th>Memory ON</th><th>Hindsight citations</th></tr></thead><tbody>{run.rows.map((row) => <tr key={row.id}><td><code>{row.id}</code></td><td>{row.service}</td><td>{row.correct_cause}</td><td><span className={`result-prediction ${row.memory_off_correct ? 'correct' : 'incorrect'}`}>{row.memory_off_correct ? <Check size={12} /> : <X size={12} />}{row.memory_off_prediction}</span></td><td><span className={`result-prediction ${row.memory_on_correct ? 'correct' : 'incorrect'}`}>{row.memory_on_correct ? <Check size={12} /> : <X size={12} />}{row.memory_on_prediction}</span></td><td>{row.cited_incident_ids.map((id) => <code className="incident-citation" key={id}>{id}</code>)}</td></tr>)}</tbody></table></div><div className="evaluation-footnote"><ShieldCheck size={14} />Truth labels are not sent to the model. Scores are computed from actual live Groq responses and real Hindsight recall.</div></>}
    </section>
  </main>;
}

function App() {
  const [screen, setScreen] = useState<Screen>(screenFromPath);
  const [incidents, setIncidents] = useState<ActiveIncident[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [incidentsError, setIncidentsError] = useState('');
  const [selectedId, setSelectedId] = useState('INC-0902');
  const [memoryOn, setMemoryOn] = useState(false);
  const skipNextAnalysis = useRef(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [comparison, setComparison] = useState<{ without_memory: Analysis; with_memory: Analysis } | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState('');
  const selected = useMemo(() => incidents.find((incident) => incident.id === selectedId) ?? incidents[0], [incidents, selectedId]);

  const navigate = (next: Screen) => {
    const target = screens.find((item) => item.id === next)!;
    if (window.location.pathname !== target.path) window.history.pushState({}, '', target.path);
    setScreen(next);
  };
  useEffect(() => {
    const pop = () => setScreen(screenFromPath());
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    let alive = true;
    setIncidentsLoading(true); setIncidentsError('');
    api.activeIncidents().then(({ incidents: found }) => {
      if (!alive) return;
      setIncidents(found);
      if (!found.some((item) => item.id === selectedId) && found[0]) setSelectedId(found[0].id);
    }).catch((error) => { if (alive) setIncidentsError(friendlyError(error)); })
      .finally(() => { if (alive) setIncidentsLoading(false); });
    return () => { alive = false; };
  }, []);
  const loadAnalysis = useCallback(async (id: string, useMemory: boolean) => {
    setAnalysis(null); setAnalysisLoading(true); setAnalysisError(''); setComparison(null); setComparisonError('');
    try { const result = await api.analyze(id, useMemory); setAnalysis(result.analysis); }
    catch (error) { setAnalysisError(friendlyError(error)); }
    finally { setAnalysisLoading(false); }
  }, []);
  const runComparison = useCallback(async () => {
    if (!selected) return;
    setAnalysis(null); setAnalysisLoading(true); setAnalysisError('');
    setComparison(null); setComparisonLoading(true); setComparisonError('');
    try {
      const result = await api.compare(selected.id);
      setComparison(result.comparison);
      setAnalysis(result.comparison.with_memory);
    } catch (error) {
      const message = friendlyError(error);
      setComparisonError(message); setAnalysisError(message);
    } finally { setAnalysisLoading(false); setComparisonLoading(false); }
  }, [selected?.id]);
  useEffect(() => {
    if (!selected || screen !== 'investigation') return;
    if (skipNextAnalysis.current) { skipNextAnalysis.current = false; return; }
    if (memoryOn) void runComparison();
    else void loadAnalysis(selected.id, false);
  }, [selected?.id, memoryOn, screen, loadAnalysis, runComparison]);
  const handleMemoryToggle = () => {
    if (memoryOn) {
      setComparison(null); setComparisonError(''); setMemoryOn(false);
      return;
    }
    skipNextAnalysis.current = true;
    setMemoryOn(true);
    void runComparison();
  };
  useEffect(() => {
    const close = () => { setComparison(null); setComparisonError(''); setMemoryOn(false); };
    window.addEventListener('recall:close-comparison', close);
    return () => window.removeEventListener('recall:close-comparison', close);
  }, []);
  const handleFeedback = async (kind: FeedbackKind, text?: string) => {
    if (!selected) throw new Error('Select an active incident first.');
    await api.feedback(selected.id, { kind, ...(text ? { text } : {}) });
    setComparison(null);
    if (!memoryOn) { skipNextAnalysis.current = true; setMemoryOn(true); }
    void runComparison();
  };

  return <div className="app-shell">
    <Header screen={screen} navigate={navigate} />
    {screen === 'investigation' && <Investigation incidents={incidents} incidentsLoading={incidentsLoading} incidentsError={incidentsError} selectedId={selected?.id ?? selectedId} onSelect={setSelectedId} analysis={analysis} analysisLoading={analysisLoading} analysisError={analysisError} memoryOn={memoryOn} onMemoryToggle={handleMemoryToggle} onRetry={() => memoryOn ? void runComparison() : selected && void loadAnalysis(selected.id, false)} comparison={comparison} comparisonLoading={comparisonLoading} comparisonError={comparisonError} onFeedback={handleFeedback} />}
    {screen === 'memory' && <MemoryTimeline selectedId="INC-0831" />}
    {screen === 'evaluation' && <Evaluation />}
    <footer className="app-footer"><span>Recall <span className="brand-dot">.</span> Incident response memory</span><span>Suggestions only · Human decisions stay with your team</span></footer>
  </div>;
}

export default App;
