import { useMemo, useState } from 'react';
import { queryRecordedDependencies, type RecordedDependencyInput, type RecordedDependencyResult } from 'footprintjs-iac/diagnostics/recorded';
import type { Recording } from '../../src/core/types.ts';
import './recorded-diagnostics.css';

type DependencyEdge = NonNullable<NonNullable<RecordedDependencyResult['dependencies']>['edges']>[number];
function simpleStageName(name: string, subject?: { id: string; label: string }): string {
  if (!subject?.id) return name;
  const escaped = subject.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return name.replace(new RegExp(`(^|[^\\p{L}\\p{N}_:-])${escaped}(?=$|[^\\p{L}\\p{N}_:-])`, 'gu'), (_match, prefix: string) => prefix + subject.label);
}
function displayLinks(edges: readonly DependencyEdge[], technical: boolean): { edge: DependencyEdge; count: number }[] {
  if (technical) return edges.map(edge => ({ edge, count: 1 }));
  const groups = new Map<string, { edge: DependencyEdge; count: number }>();
  for (const edge of edges) {
    const key = JSON.stringify([edge.to, edge.kind, edge.builtOn, edge.overlap, edge.basis]);
    const prior = groups.get(key);
    if (prior) prior.count++; else groups.set(key, { edge, count: 1 });
  }
  return [...groups.values()];
}

/** The base library owns ancestry; this component presents its exact nodes, edges and limitations. */
export function RecordedDependencyPanel({ report, technical = false, subject }: { report?: RecordedDependencyResult; technical?: boolean; subject?: { id: string; label: string } }) {
  const nodes = report?.dependencies?.nodes ?? {};
  const positions = new Map(report?.order.map(item => [item.nodeId, item.commitIndex]));
  const ordered = Object.entries(nodes).sort(([a],[b]) => (positions.get(a) ?? Infinity) - (positions.get(b) ?? Infinity) || a.localeCompare(b));
  const numbers = new Map(ordered.map(([id], index) => [id, index + 1]));
  const edges = report?.dependencies?.edges ?? [];
  if (!report) return <p className="recorded-trace-empty">The native dependency recording is not available yet.</p>;
  return <div className="recorded-dependency-panel">
    <div className="recorded-trace-summary"><strong>{report.status === 'available' ? `${ordered.length} recorded steps` : report.status === 'missing' ? 'No recorded writer for this result' : 'This recording could not answer the query'}</strong>
      <span>{report.summary.dataEdges} data · {report.summary.controlEdges} decisions{report.summary.partialWriteEdges ? ` · ${report.summary.partialWriteEdges} partial updates` : ''}{report.summary.possibleSourceEdges ? ` · ${report.summary.possibleSourceEdges} possible sources` : ''}</span></div>
    <p className="recorded-trace-order">Recorded commit order. Parallel work can start or read in a different order.</p>
    <ol className="recorded-trace-steps">{ordered.map(([id,node]) => <li key={id} className={id === report.dependencies?.writerId ? 'recorded-trace-outcome' : ''}>
      <span className="recorded-trace-step-number">{numbers.get(id)}</span><div><strong>{technical ? node.stageName || node.stageId : simpleStageName(node.stageName || node.stageId, subject)}</strong>
        {technical && <code>{id}{positions.has(id) ? ` · commit ${positions.get(id)}` : ' · commit position unavailable'}</code>}
        <div className="recorded-trace-links">{displayLinks(edges.filter(edge => edge.from === id), technical).map(({ edge, count },index) => <span key={index} className={`recorded-trace-link link-${edge.kind}${edge.overlap ? ' link-possible' : ''}`}>
          {edge.kind === 'control' ? 'Decision' : 'Data'} from {numbers.has(edge.to) ? `step ${numbers.get(edge.to)}` : 'an unpositioned step'}
          {edge.builtOn ? ' · partial update' : ''}{edge.overlap ? ' · possible source' : ''}{edge.basis ? ' · partial path' : ''}
          {count > 1 ? ` ×${count}` : ''}
          {technical && <code>{edge.key ?? ''}{edge.builtOn ? ` · ${edge.builtOn}` : ''}{edge.overlap ? ` · ${edge.overlap}` : ''}</code>}
        </span>)}</div>
        {technical && node.keysWritten.length > 0 && <small>Writes: {node.keysWritten.join(', ')}</small>}
        {(node.incompleteSources?.length || node.preRunReads || node.preRunBase || node.preRunView) && <small className="recorded-trace-warning">Some inputs originate outside this recorded step history.</small>}
      </div>
    </li>)}</ol>
    {(report.limitations.length > 0 || report.dependencies?.truncated || report.dependencies?.notes?.length) && <div className="recorded-trace-limits" role="status"><strong>Evidence limits</strong>
      <ul>{report.limitations.map((text,index) => <li key={index}>{text}</li>)}
        {report.dependencies?.truncated && <li>The query reached a recording limit. More dependencies may exist.</li>}
        {report.dependencies?.notes?.map((note,index) => <li key={'note-' + index}>{technical ? note.code : note.code.replaceAll('-', ' ')}</li>)}
      </ul></div>}
    <p className="recorded-trace-footer">Recorded dependencies explain this execution. Unobserved service internals remain unknown.</p>
    {technical && <details><summary>Diagnostic JSON</summary><pre>{JSON.stringify(report,null,2)}</pre></details>}
  </div>;
}

/** Updated reader beside the native timeline, without handing new provenance to the legacy resolver. */
export function RecordedDependencyInspector({ recording }: { recording: Recording }) {
  const snapshot = recording.snapshot as RecordedDependencyInput['snapshot'];
  const [selected, setSelected] = useState<string>();
  const keys = useMemo(() => {
    const rows = Array.isArray(snapshot.commitLog) ? snapshot.commitLog : [];
    const names = new Set<string>();
    for (const row of rows.slice(-50_000)) {
      if (!row || typeof row !== 'object') continue;
      const trace = (row as { trace?: { path?: unknown }[] }).trace;
      if (Array.isArray(trace)) for (const write of trace) if (write && typeof write === 'object' && typeof write.path === 'string') names.add(write.path);
    }
    return [...names].slice(-256);
  }, [snapshot.commitLog]);
  const key = selected && keys.includes(selected) ? selected : keys.findLast(key => key.startsWith('progress:')) ?? keys.at(-1);
  const report = useMemo(() => key ? queryRecordedDependencies({ snapshot,
    ...(recording.controlDeps ? { controlDeps: recording.controlDeps as RecordedDependencyInput['controlDeps'] } : {}) }, key) : undefined, [snapshot,key,recording.controlDeps]);
  return <section className="recorded-native-inspector" aria-label="Updated recorded dependency reader"><header><strong>Trace back</strong><label>Recorded result<select value={key ?? ''} onChange={event => setSelected(event.target.value)}>{keys.map(key => <option value={key} key={key}>{key.replaceAll('\u001f','.')}</option>)}</select></label></header>
    <RecordedDependencyPanel report={report} technical/>
  </section>;
}
