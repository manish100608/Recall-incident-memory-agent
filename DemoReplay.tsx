import { useState } from 'react';
import { AlertCircle, ArrowRight, Check, Circle, Database, Loader2, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { Analysis } from '../shared/types';
import { api, ApiError } from './api';

type StepKey = 'reset' | 'seed' | 'baseline' | 'correction' | 'improved';
type StepState = 'pending' | 'running' | 'completed' | 'failed';
type StepRecord = Record<StepKey, { state: StepState; detail: string }>;
const stepLabels: Array<{ key: StepKey; label: string }> = [
  { key: 'reset', label: 'Clear the configured Hindsight bank' },
  { key: 'seed', label: 'Seed all 18 histories without the INC-0831 correction' },
  { key: 'baseline', label: 'Analyze INC-0902 with memory off' },
  { key: 'correction', label: 'Retain the engineer correction for INC-0831' },
  { key: 'improved', label: 'Re-analyze INC-0902 with Hindsight memory on' },
];
function initialSteps(): StepRecord {
  return Object.fromEntries(stepLabels.map(({ key }) => [key, { state: 'pending', detail: '' }])) as StepRecord;
}
function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'The demo replay stopped unexpectedly.';
}

function ReplayAnalysis({ title, analysis, memory }: { title: string; analysis: Analysis; memory: boolean }) {
  return <article className={`replay-result ${memory ? 'replay-memory-result' : ''}`}>
    <div className="replay-result-title"><span className={`comparison-dot ${memory ? 'on' : 'off'}`} />{title}<span className={`confidence-pill confidence-${analysis.confidence}`}>{analysis.confidence}</span></div>
    <p className="replay-cause">{analysis.possible_cause}</p>
    <div className="replay-result-lists"><div><strong>Recommended steps</strong><ul>{analysis.recommended_steps.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div><div><strong>Do not repeat</strong><ul>{analysis.things_not_to_do.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div></div>
    <div className="replay-evidence">{analysis.cited_incident_ids.length ? <>Hindsight evidence: {analysis.cited_incident_ids.map((id) => <code key={id}>{id}</code>)}</> : analysis.comparable_status === 'memory_off' ? 'No Hindsight context was sent to this baseline.' : 'Hindsight returned no cited comparable incident.'}</div>
    <div className="model-stamp">Analysis by {analysis.model}</div>
  </article>;
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'completed') return <span className="replay-step-icon done"><Check size={12} /></span>;
  if (state === 'running') return <span className="replay-step-icon working"><Loader2 size={12} className="spin" /></span>;
  if (state === 'failed') return <span className="replay-step-icon failed"><AlertCircle size={12} /></span>;
  return <span className="replay-step-icon pending"><Circle size={10} /></span>;
}

export default function DemoReplay() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<StepRecord>(initialSteps);
  const [baseline, setBaseline] = useState<Analysis | null>(null);
  const [improved, setImproved] = useState<Analysis | null>(null);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  const perform = async <T,>(key: StepKey, action: () => Promise<{ value: T; detail: string }>): Promise<T> => {
    setSteps((current) => ({ ...current, [key]: { state: 'running', detail: '' } }));
    try {
      const result = await action();
      setSteps((current) => ({ ...current, [key]: { state: 'completed', detail: result.detail } }));
      return result.value;
    } catch (reason) {
      setSteps((current) => ({ ...current, [key]: { state: 'failed', detail: errorText(reason) } }));
      throw reason;
    }
  };

  const run = async () => {
    setBusy(true); setConfirming(false); setError(''); setComplete(false);
    setBaseline(null); setImproved(null); setSteps(initialSteps());
    try {
      await perform('reset', async () => {
        const result = await api.reset();
        return { value: result, detail: `Hindsight confirmed ${result.reset.deleted_count} memories deleted from the configured bank.` };
      });
      await perform('seed', async () => {
        const result = await api.seed(false);
        if (result.seed.incidents !== 18 || result.seed.retained !== 18 || result.seed.correction_included) throw new Error('Hindsight did not confirm 18 histories without the INC-0831 correction; replay stopped.');
        return { value: result, detail: `Hindsight confirmed ${result.seed.retained} histories; the INC-0831 correction is not included yet.` };
      });
      await perform('baseline', async () => {
        const result = await api.analyze('INC-0902', false);
        setBaseline(result.analysis);
        return { value: result.analysis, detail: `Live ${result.analysis.model} analysis completed with memory off.` };
      });
      await perform('correction', async () => {
        const { incident } = await api.incident('INC-0831');
        if (!incident.engineer_correction) throw new Error('INC-0831 has no engineer correction in the historical fixture; replay stopped.');
        const result = await api.feedback('INC-0831', { kind: 'wrong_because', text: incident.engineer_correction });
        if (!result.feedback.retained) throw new Error('Hindsight did not confirm the engineer correction; replay stopped.');
        return { value: result, detail: `Hindsight retained and timestamped the correction linked to ${result.feedback.incident_id}.` };
      });
      await perform('improved', async () => {
        const result = await api.analyze('INC-0902', true);
        setImproved(result.analysis);
        const cited = result.analysis.cited_incident_ids.includes('INC-0831');
        return { value: result.analysis, detail: cited ? 'Live Hindsight/Groq analysis cited the corrected INC-0831 memory.' : 'Live provider response returned; no INC-0831 citation was forced.' };
      });
      setComplete(true);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return <section className="panel demo-replay">
    <div className="demo-replay-header"><div><span className="eyebrow small"><RotateCcw size={12} />CONTROLLED MEMORY DEMO</span><h2>Reset &amp; replay demo</h2><p>See a real memory-off baseline, add the INC-0831 correction, then compare the live Hindsight-backed analysis.</p></div><span className="demo-state"><Database size={13} />HINDSIGHT + GROQ</span></div>
    <div className="demo-caution"><ShieldAlert size={15} /><span>The reset deletes <strong>all memories in the configured Hindsight bank</strong>, including records not created by Recall. It cannot be undone. Nothing runs until you confirm below.</span></div>
    {!busy && !complete && <div className="demo-start-row"><button type="button" className="button-primary" onClick={() => { setError(''); setConfirming(true); }}><RotateCcw size={14} />Reset &amp; replay demo<ArrowRight size={14} /></button><span>Five live steps · stops on the first failure</span></div>}
    {confirming && <div className="demo-confirmation" role="alertdialog" aria-labelledby="demo-confirm-title" aria-describedby="demo-confirm-description">
      <div className="demo-confirm-icon"><ShieldAlert size={17} /></div><div className="demo-confirm-copy"><strong id="demo-confirm-title">Confirm the bank-wide reset and five-step replay</strong><p id="demo-confirm-description">This permanently clears the selected bank before the demo begins. Other projects’ memories in that bank may be deleted. After reset, Recall will seed the 18 histories without the hero correction, run a real memory-off analysis, retain the correction, and run a real memory-on analysis. Continue only if that is what you intend.</p><div className="demo-confirm-actions"><button type="button" className="cancel-reset" onClick={() => setConfirming(false)}>Cancel</button><button type="button" className="confirm-reset" onClick={() => void run()}><ShieldCheck size={13} />Clear bank &amp; run demo</button></div></div>
    </div>}
    {(busy || complete || Object.values(steps).some((step) => step.state === 'failed')) && <div className="demo-progress" aria-live="polite">
      <div className="demo-progress-heading"><strong>{complete ? 'Replay complete' : busy ? 'Replay in progress' : 'Replay stopped'}</strong><span>{complete ? 'All five live steps returned successfully.' : busy ? 'Each phase must be confirmed by its provider before the next begins.' : 'No later step was run after the failure.'}</span></div>
      <ol>{stepLabels.map(({ key, label }) => <li className={`demo-step ${steps[key].state}`} key={key}><StepIcon state={steps[key].state} /><div><span>{label}</span>{steps[key].detail && <small>{steps[key].detail}</small>}</div></li>)}</ol>
    </div>}
    {error && <div className="demo-error" role="alert"><AlertCircle size={15} /><span>{error}</span></div>}
    {complete && baseline && improved && <div className="replay-results"><div className="section-title"><div><span className="eyebrow small">LIVE PROVIDER OUTPUTS</span><h3>What changed after the correction?</h3></div><span>Generated now — not preset</span></div><div className="replay-result-grid"><ReplayAnalysis title="Without memory" analysis={baseline} memory={false} /><ReplayAnalysis title="With Hindsight memory" analysis={improved} memory /></div>{!improved.cited_incident_ids.includes('INC-0831') && <div className="demo-no-match"><AlertCircle size={14} />This live result did not cite INC-0831. The provider response is shown as returned; Recall will not invent an improved result.</div>}</div>}
  </section>;
}
