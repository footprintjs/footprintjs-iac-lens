import { useMemo, useState } from 'react';
import { Background, BackgroundVariant, Controls, ReactFlow } from '@xyflow/react';
import type { DashboardState } from '../../src/core/types.ts';
import { eventTime } from '../../src/core/model.ts';
import { buildDeploymentFlowView, deploymentStepTitle } from '../lib/deployment-flow-view.ts';
import { DeploymentStep } from './DeploymentStep.tsx';
import { Icon } from './Icon.tsx';
import './deployment-flow.css';

const nodeTypes = { 'deployment-step': DeploymentStep };

/** The resource pipeline is ordered by captured execution, never by capability category. */
export function DeploymentFlow({ state, selected, onSelect }: { state: DashboardState; selected?: string; onSelect(id: string | undefined): void }) {
  const [prerequisites, setPrerequisites] = useState(false);
  const view = useMemo(() => buildDeploymentFlowView(state, selected, prerequisites), [state, selected, prerequisites]);
  const { flow } = view;
  if (!flow.nodes.length) return null;
  const resource = flow.nodes.find(node => node.id === selected);
  const overlap = flow.columns.some(column => column.overlapping);
  const native = flow.layoutSource === 'native-chart';
  return <section className="deployment-flow" aria-label="Deployment flow">
    <div className="deployment-flow-heading"><div><span className="eyebrow">FOLLOW THE DEPLOYMENT</span><h2>{native ? 'The deployment, one step at a time' : flow.basis === 'recorded' ? 'What ran, in the order it started' : 'What must be ready before the next step'}</h2><p>{native ? 'Boxes and branches come from the native chart. Numbers and colours follow its live recorder.' : flow.basis === 'recorded' ? 'Read the numbered steps from left to right. Click any step to see what it contains.' : 'Arrows show prerequisites. Actual start order appears when FootPrint records the run.'}</p></div>
      <span className={`flow-source flow-source-${flow.basis}`}><i/>{native ? 'Native chart + events' : flow.basis === 'recorded' ? 'Recorded execution' : state.run?.status === 'idle' ? 'Before execution' : 'Order not recorded'}</span></div>
    <div className="deployment-flow-toolbar"><span><Icon name="arrow" size={14}/>{native ? 'Next: scheduled · then: observed · needs: prerequisite' : flow.basis === 'recorded' ? prerequisites ? 'Solid: ran next · dashed: prerequisite' : 'Solid arrows: finished, then started' : 'Dashed arrows: must be ready first'}</span>{(native || flow.basis === 'recorded') && <button aria-pressed={prerequisites} onClick={() => setPrerequisites(!prerequisites)}>{prerequisites ? 'Hide prerequisites' : 'Show prerequisites'}</button>}<small>Drag to pan · use + / − to zoom</small></div>
    <div className="deployment-flow-canvas" style={{ height: flow.columns.some(column => column.resourceIds.length > 1) ? 470 : 315 }}>
      <ReactFlow key={`${state.graph?.digest}:${flow.layoutSource}:${flow.basis}`} nodes={view.nodes} edges={view.edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: .12, minZoom: .72, maxZoom: 1 }}
        minZoom={.35} maxZoom={1.6} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => onSelect(node.id)} onPaneClick={() => onSelect(undefined)} proOptions={{ hideAttribution: false }}>
        <Background variant={BackgroundVariant.Dots} gap={21} size={1} color="#dce3ed"/><Controls showInteractive={false} position="bottom-left"/>
      </ReactFlow>
    </div>
    <div className="deployment-flow-explainer">{overlap ? <span><strong>Work overlapped.</strong> Some steps were active at the same time. Numbers follow their individual recorded starts.</span> : <span>{native ? 'Scheduled together is the native fork; overlap is confirmed only when live execution records it.' : flow.basis === 'recorded' ? 'Numbers follow recorded starts, including checks of existing resources.' : 'Branches describe dependencies; they do not promise parallel execution.'}</span>}<span>Compute, Storage and Network are labels, not a fixed sequence.</span></div>
    {flow.existingPrerequisites.length > 0 && <p className="deployment-existing"><Icon name="check" size={13}/><strong>Already available:</strong> {flow.existingPrerequisites.map(item => item.label).join(', ')}. These are not deployment steps.</p>}
    {flow.warnings.length > 0 && <p className="deployment-flow-warning" role="status">{flow.warnings.join(' ')}</p>}
    {resource && <div className="deployment-step-details" aria-label="Selected deployment step">
      <div><strong>{resource.observed ? `Step ${resource.observed.step} · ` : ''}{deploymentStepTitle(resource)}</strong><button className="icon-button" onClick={() => onSelect(undefined)} aria-label="Close deployment step"><Icon name="close" size={15}/></button></div>
      <p><code>{resource.id}</code>{resource.observed && <> · Started {eventTime(resource.observed.startedAt)}{resource.observed.finishedAt !== undefined && <> · Finished {eventTime(resource.observed.finishedAt)}</>}</>}</p>
      {resource.progress.runtimeStageId && <p>Recorded stage: <code>{resource.progress.runtimeStageId}</code></p>}
      {resource.capabilities.length > 0 && <ul>{resource.capabilities.map(unit => <li key={`${unit.blockId}:${unit.unitId}`}><span>{unit.label}</span><small>{unit.mode === 'embedded' ? 'Embedded here · shares this runtime’s readiness' : unit.resourceIds.length > 1 ? 'Shared capability · also requires other resources' : 'Mapped to this resource'}</small>{unit.description && <p>{unit.description}</p>}</li>)}</ul>}
      <p className="deployment-detail-note">Ready is the recorded deployment result. Runtime health and connection checks are separate.</p></div>}
  </section>;
}
