import type { AgentComponentGraphView } from '../../../../src/core/agent-components.ts';
import { RecordingSummary } from '../AgentDetails.tsx';
import { RecordedStages } from '../RecordedStages.tsx';
import { componentStatusLabels, progressPresentation, runtimeBoundaryLabel } from './model.ts';

type Selection = { kind: 'node' | 'boundary'; id: string };
export function ComponentDetails({ view, selection }: { view: AgentComponentGraphView; selection: Selection }) {
  const node = selection.kind === 'node' ? view.nodes.find(node => node.id === selection.id) : undefined;
  const boundary = selection.kind === 'boundary' ? view.boundaries.find(boundary => boundary.id === selection.id) : undefined;
  const item = node ?? boundary;
  if (!item) return <p>This object is outside the current admitted component graph.</p>;
  const progress = progressPresentation(item.progress);
  return <div className="agents-details"><dl>
    <div><dt>Current outcome</dt><dd>{componentStatusLabels[item.status]}</dd></div>
    <div><dt>Recorded progress</dt><dd>{progress.label}{!progress.determinate && ' · Total not established'}</dd></div>
    <div><dt>Identity</dt><dd><code>{item.id}</code></dd></div>
    {node && <><div><dt>Roles</dt><dd>{node.roles.join(', ') || 'No role supplied'}</dd></div>
      <div><dt>Work in this flow</dt><dd>{node.selected ? node.required ? 'Required' : 'Optional' : 'Not selected'}</dd></div>
      {node.storage && <div><dt>Storage</dt><dd>{node.storage === 'memory' ? 'Process memory · volatile' : 'Persistent store'}</dd></div>}
      {node.sharing && <div><dt>Sharing</dt><dd>{node.sharing === 'shared' ? 'Shared physical resource' : 'Dedicated resource'}</dd></div>}
      {node.physicalBindingId && <div><dt>Physical binding</dt><dd><code>{node.physicalBindingId}</code></dd></div>}</>}
    {boundary && <><div><dt>Boundary</dt><dd>{runtimeBoundaryLabel(boundary)}</dd></div><div><dt>Runtime identity</dt><dd>{boundary.observed ? 'Observed by the native adapter' : 'Not confirmed by the native adapter'}</dd></div><div><dt>Boundary type</dt><dd>{boundary.kind}</dd></div></>}
  </dl>
    {node && <RecordedStages stages={node.stages ?? []} title="Native component subflow"/>}
    {boundary && <section><h3>Declared members</h3><ul>{view.nodes.filter(node => node.boundaryId === boundary.id).map(node => <li key={node.id}>{node.label} · {componentStatusLabels[node.status]}</li>)}{view.boundaries.filter(child => child.parentId === boundary.id).map(child => <li key={child.id}>{runtimeBoundaryLabel(child)} · {componentStatusLabels[child.status]}</li>)}</ul></section>}
    <RecordingSummary reference={item.recording}/>
    {view.limitations.map((limitation, index) => <p className="agents-limitation" key={index}>{limitation}</p>)}
    <p>Containment and deployment order are separate. The border follows recorded completed work; it does not estimate elapsed or remaining time.</p>
  </div>;
}
