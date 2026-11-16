import type { SystemTopologyView, TopologyNodeView, TopologyBoundaryView, TopologyConnectionView } from 'footprintjs-iac/system-topology';
import { DetailsPanel } from '../../components/DetailsPanel.tsx';
export type TopologySelection = { kind: 'node' | 'boundary' | 'connection'; id: string };
export function TopologyEvidence({ view, selection, onClose }: { view: SystemTopologyView; selection: TopologySelection; onClose(): void }) {
  const row: TopologyNodeView | TopologyBoundaryView | TopologyConnectionView | undefined = selection.kind === 'node' ? view.nodes.find(item => item.id === selection.id) : selection.kind === 'boundary' ? view.boundaries.find(item => item.id === selection.id) : view.connections.find(item => item.id === selection.id);
  if (!row) return null;
  const node = selection.kind === 'node' ? row as TopologyNodeView : undefined;
  const boundary = selection.kind === 'boundary' ? row as TopologyBoundaryView : undefined;
  return <DetailsPanel title={row.label ?? row.id} onClose={onClose}><div className="topology-evidence">
    <p><strong>{node?.statusLabel ?? row.status}</strong>{node ? ` · ${node.originLabel}` : ''}</p>
    {node?.description && <p>{node.description}</p>}
    {node && <dl><dt>Evidence scope</dt><dd>{node.evidenceScope}</dd><dt>Installed</dt><dd>{node.facts.installed}</dd><dt>Running</dt><dd>{node.facts.running}</dd><dt>Connected</dt><dd>{node.facts.connected}</dd></dl>}
    {boundary && <p>{boundary.observed ? 'Boundary has recorded observations.' : 'Declared placement; host readiness is unconfirmed.'}</p>}
    {node?.evidenceScope === 'shared-resource' && <p>These components share one provider operation. Their individual installation is not separately confirmed.</p>}
    {node?.limitations.map((text, index) => <p key={index}>{text}</p>)}
    <h3>Native FootPrint evidence</h3>{row.evidence.length ? <ul>{row.evidence.map((evidence, index) => <li key={index}><strong>{evidence.kind}</strong> · {evidence.complete ? 'Complete' : 'Incomplete'}<code>{evidence.runId}</code>{evidence.runtimeStageId && <code>{evidence.runtimeStageId}</code>}</li>)}</ul> : <p>No matching native observations yet.</p>}
  </div></DetailsPanel>;
}
