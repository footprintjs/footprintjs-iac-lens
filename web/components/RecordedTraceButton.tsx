import { useState } from 'react';
import type { DashboardState } from '../../src/core/types.ts';
import type { DiagnosticFact, DiagnosticRun, RecordedDiagnostics } from '../../src/core/recorded-diagnostics.ts';
import { RecordedDependencyPanel } from './RecordedDependencyPanel.tsx';
import { DetailsPanel } from './DetailsPanel.tsx';
import { Icon } from './Icon.tsx';

const reasonLabels: Readonly<Record<string, string>> = { 'federated-login-failed': 'Federated sign-in check failed', 'jwks-probe-failed': 'Signing-key check failed' };
const factLabel = (fact: DiagnosticFact) => fact.code === 'http-status' ? `HTTP ${fact.value}` : fact.code === 'latency-ms' ? `${fact.value} ms`
  : fact.code === 'reason' ? reasonLabels[String(fact.value)] ?? String(fact.value).replaceAll('-', ' ') : String(fact.value);
export function RecordedTraceHistory({ history, initialRunId, technical = false }: { history: RecordedDiagnostics; initialRunId?: string; technical?: boolean }) {
  const [selectedRun, setSelectedRun] = useState(initialRunId), [selectedTarget, setSelectedTarget] = useState<string>();
  const [details, setDetails] = useState(technical);
  const runs = [...history.runs].sort((a,b) => b.sequence - a.sequence);
  const run = runs.find(run => run.id === selectedRun) ?? runs[0];
  const target = run?.targets.find(target => target.id === selectedTarget) ?? run?.targets.find(target => target.outcome === 'failed') ?? run?.targets[0];
  if (!run) return <div><p>No completed native runs have been recorded yet.</p>
    {history.limitations?.map((text,index) => <p key={index} className="recorded-trace-warning">{text}</p>)}
    {history.persistenceError && <p className="recorded-trace-warning">{history.persistenceError}</p>}</div>;
  return <div className="recorded-trace-history"><div className="recorded-trace-selectors"><label>Recorded run<select aria-label="Diagnostic run" value={run.id} onChange={event => { setSelectedRun(event.target.value); setSelectedTarget(target?.id); }}>
    {runs.map(run => <option value={run.id} key={run.id}>{run.label} · {run.outcome === 'failed' ? 'Failed' : 'Passed'}{run.configurationVersion ? ' · ' + run.configurationVersion.versionId : ''} · run {run.sequence}</option>)}</select></label>
    <label>Result<select aria-label="Diagnostic result" value={target?.id ?? ''} onChange={event => setSelectedTarget(event.target.value)}>{run.targets.map(target => <option key={target.id} value={target.id}>{target.label} · {target.outcome}</option>)}</select></label>
    <button aria-pressed={details} onClick={() => setDetails(!details)}>{details ? 'Simple explanation' : 'Show details'}</button></div>
    {target && <div className={`recorded-trace-facts trace-${target.outcome}`}><strong>{target.outcome === 'failed' ? 'This check failed' : target.outcome === 'passed' ? 'This check passed' : 'This result is unconfirmed'}</strong>{target.facts.map((fact,index) => <span key={index}>{factLabel(fact)}</span>)}</div>}
    {details && <p className="recorded-trace-identity">Native run: <code>{run.runtimeRunId ?? 'unavailable'}</code> · Domain run: <code>{run.runId}</code></p>}
    {run.configurationVersion && <p className="recorded-trace-identity">Setup version: <code>{run.configurationVersion.versionId}</code> · Head {run.configurationVersion.head}{details && <> · Release digest: <code>{run.configurationVersion.releaseDigest}</code> · Configuration digest: <code>{run.configurationVersion.configurationDigest}</code></>}{run.configurationVersion.association === 'matched-legacy-binding' && <small>Version associated from the exact retained legacy viewer binding; the original file and native capture are preserved.</small>}</p>}
    {run.limitations.map((text,index) => <p key={index} className="recorded-trace-warning">{text}</p>)}
    <RecordedDependencyPanel report={target?.trace} technical={details} subject={target && { id: target.id, label: target.label }}/>
    {history.omitted > 0 && <p>{history.omitted} older runs are outside this bounded view. Their native recordings remain with the host.</p>}
    {history.persistenceError && <p className="recorded-trace-warning">{history.persistenceError}</p>}
    {history.limitations?.map((text,index) => <p key={index} className="recorded-trace-warning">{text}</p>)}
  </div>;
}
export function RecordedTraceButton({ state, technical = false }: { state: DashboardState; technical?: boolean }) {
  const [opened, setOpened] = useState<{ runId?: string }>();
  const history = state.recordedDiagnostics;
  if (!history || (!history.runs.length && !history.limitations?.length && !history.persistenceError)) return null;
  const failed = state.connections?.status === 'failed' || state.identity?.status === 'failed' || state.run?.status === 'failed' || state.resourceFlow?.status === 'failed';
  const initial = failed ? [...history.runs].reverse().find(run => run.outcome === 'failed') : history.runs.at(-1);
  return <><button className="simple-button simple-secondary" onClick={() => setOpened({ runId: initial?.id })}><Icon name="evidence" size={15}/>{!history.runs.length ? 'History needs attention' : failed ? 'Why did this fail?' : 'Trace back'}</button>
    {opened && <DetailsPanel title="Recorded explanation" onClose={() => setOpened(undefined)}><RecordedTraceHistory history={history} initialRunId={opened.runId} technical={technical}/></DetailsPanel>}
  </>;
}
