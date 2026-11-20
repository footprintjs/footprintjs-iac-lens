import type { SystemTopologyView, TopologyNodeView, TopologyBoundaryView, TopologyConnectionView } from 'footprintjs-iac/system-topology';
import type {AdapterDeploymentView} from '../../../src/core/adapter-deployment.ts';
import {resolveTopologyDeploymentStep,type RecordedDeploymentStep} from '../../../src/core/topology-deployment-step.ts';
import { DetailsPanel } from '../../components/DetailsPanel.tsx';
import type { ConnectionRun } from '../../../src/core/types.ts';
import { CommunicationDeclaration } from '../../components/CommunicationDeclaration.tsx';
export type TopologySelection = { kind: 'node' | 'boundary' | 'connection'; id: string };
export function TopologyEvidence({ view, selection, onClose, adapter, connectionRun, onRecordedStep }: { view: SystemTopologyView; selection: TopologySelection; onClose(): void; connectionRun?: ConnectionRun; adapter?:AdapterDeploymentView; onRecordedStep?(step:RecordedDeploymentStep):void }) {
  const row: TopologyNodeView | TopologyBoundaryView | TopologyConnectionView | undefined = selection.kind === 'node' ? view.nodes.find(item => item.id === selection.id) : selection.kind === 'boundary' ? view.boundaries.find(item => item.id === selection.id) : view.connections.find(item => item.id === selection.id);
  if (!row) return null;
  const node = selection.kind === 'node' ? row as TopologyNodeView : undefined;
  const boundary = selection.kind === 'boundary' ? row as TopologyBoundaryView : undefined;
  return <DetailsPanel title={row.label ?? row.id} onClose={onClose}><div className="topology-evidence">
    <p><strong>{node?.statusLabel ?? row.status}</strong>{node ? ` · ${node.originLabel}` : ''}</p>
    {selection.kind === 'connection' && 'from' in row && row.kind === 'communicatesWith' && <>
      <CommunicationDeclaration details={row.details}/>
      <h3>FootPrint checks</h3>
      {row.checkIds?.length ? <ul>{row.checkIds.map(id => {
        const check = view.observations.checks.find(item => item.id === id);
        const outcome = !check ? 'Not checked' : !check.evidence.complete && (check.status === 'passed' || check.status === 'failed') ? 'Incomplete recording' : check.status;
        const source = view.nodes.find(n => n.id === row.from);
        const target = view.nodes.find(n => n.id === row.to);
        const measured = check?.evidence.complete && check.evidence.runtimeStageId && connectionRun?.id === check.evidence.runId
          ? connectionRun.events.find(e => e.runId === check.evidence.runId && e.runtimeStageId === check.evidence.runtimeStageId
            && source?.bindings.resourceIds.includes(e.from) && target?.bindings.resourceIds.includes(e.to)
            && (check.status === 'passed' && e.status === 'connected' || check.status === 'failed' && e.status === 'failed'))
          : undefined;
        return <li key={id}>{id} · {outcome}{measured?.observation && <p>{measured.observation.method} · {Math.round(measured.observation.latencyMs)} ms</p>}{measured?.message && <p>{measured.message}</p>}{check?.evidence.runtimeStageId && <code>{check.evidence.runtimeStageId}</code>}</li>;
      })}</ul> : <p>No check registered for this connection.</p>}
    </>}
    {node?.description && <p>{node.description}</p>}
    {node && <dl><dt>Evidence scope</dt><dd>{node.evidenceScope}</dd><dt>Installed</dt><dd>{node.facts.installed}</dd><dt>Running</dt><dd>{node.facts.running}</dd><dt>Connected</dt><dd>{node.facts.connected}</dd></dl>}
    {boundary && <p>{boundary.observed ? 'Boundary has recorded observations.' : 'Declared placement; host readiness is unconfirmed.'}</p>}
    {node?.evidenceScope === 'shared-resource' && <p>These components share one provider operation. Their individual installation is not separately confirmed.</p>}
    {node?.limitations.map((text, index) => <p key={index}>{text}</p>)}
    {node&&<><h3>Recorded actions</h3>{(node.actions??[]).length?<ul>{node.actions!.map((action,index)=>{const step=adapter&&resolveTopologyDeploymentStep(adapter,action);return <li key={index}><strong>{action.label}</strong> · {action.status} · {action.scope==='shared-resource'?'Shared service operation':'This component'}{step&&onRecordedStep?<button type="button" className="button button-secondary" onClick={()=>onRecordedStep(step)}>Show deployment step</button>:<small> Native deployment step unavailable.</small>}</li>;})}</ul>:<p>No matching adapter action was recorded.</p>}</>}
    <h3>Native FootPrint evidence</h3>{row.evidence.length ? <ul>{row.evidence.map((evidence, index) => <li key={index}><strong>{evidence.kind}</strong> · {evidence.complete ? 'Complete' : 'Incomplete'}<code>{evidence.runId}</code>{evidence.runtimeStageId && <code>{evidence.runtimeStageId}</code>}</li>)}</ul> : <p>No matching native observations yet.</p>}
  </div></DetailsPanel>;
}
