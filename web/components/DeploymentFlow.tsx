import { useMemo, useState } from 'react';
import { Background, BackgroundVariant, Controls, ReactFlow } from '@xyflow/react';
import type { DashboardState } from '../../src/core/types.ts';
import { buildDeploymentFlowView } from '../lib/deployment-flow-view.ts';
import { DeploymentStep } from './DeploymentStep.tsx';
import { Icon } from './Icon.tsx';
import { CanvasFit } from './CanvasFit.tsx';
import './deployment-flow.css';

const nodeTypes = { 'deployment-step': DeploymentStep };

/** The resource pipeline is ordered by captured execution, never by capability category. */
export function DeploymentFlow({ state, selected, fitWindow = false, onSelect }: { state: DashboardState; selected?: string; fitWindow?: boolean; onSelect(id: string | undefined): void }) {
  const [prerequisites, setPrerequisites] = useState(false);
  const view = useMemo(() => buildDeploymentFlowView(state, selected, prerequisites), [state, selected, prerequisites]);
  const { flow } = view;
  if (!flow.nodes.length) return null;
  const overlap = flow.columns.some(column => column.overlapping);
  const preview = flow.layoutSource === 'schedule-preview';
  const native = flow.layoutSource === 'native-chart' || preview;
  const layoutKey = JSON.stringify(view.nodes.map(node => [node.id, node.position.x, node.position.y, node.width, node.height]));
  return <section className="deployment-flow" aria-label="Deployment flow">
    <div className="deployment-flow-heading"><div><span className="eyebrow">FOLLOW THE DEPLOYMENT</span><h2>{native ? 'The deployment, one step at a time' : flow.basis === 'recorded' ? 'What ran, in the order it started' : 'What must be ready before the next step'}</h2><p>{native ? 'Boxes and branches come from the native chart. Numbers and colours follow its live recorder.' : flow.basis === 'recorded' ? 'Read the numbered steps from left to right. Click any step to see what it contains.' : 'Arrows show prerequisites. Actual start order appears when FootPrint records the run.'}</p></div>
      <span className={`flow-source flow-source-${flow.basis}`}><i/>{preview ? 'Planned native schedule' : native ? 'Native chart + events' : flow.basis === 'recorded' ? 'Recorded execution' : state.run?.status === 'idle' ? 'Before execution' : 'Order not recorded'}</span></div>
    <div className="deployment-flow-toolbar"><span><Icon name="arrow" size={14}/>{native ? 'Next: scheduled · then: observed · needs: prerequisite' : flow.basis === 'recorded' ? prerequisites ? 'Solid: ran next · dashed: prerequisite' : 'Solid arrows: finished, then started' : 'Dashed arrows: must be ready first'}</span>{(native || flow.basis === 'recorded') && <button aria-pressed={prerequisites} onClick={() => setPrerequisites(!prerequisites)}>{prerequisites ? 'Hide prerequisites' : 'Show prerequisites'}</button>}<small>Drag to pan · use + / − to zoom</small></div>
    <div className="deployment-flow-canvas" style={fitWindow ? undefined : { height: flow.columns.some(column => column.resourceIds.length > 1) ? 470 : 315 }}>
      <ReactFlow key={`${state.graph?.digest}:${flow.layoutSource}:${flow.basis}`} nodes={view.nodes} edges={view.edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: .12, minZoom: fitWindow ? .15 : .72, maxZoom: 1 }}
        minZoom={fitWindow ? .15 : .35} maxZoom={1.6} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => onSelect(node.id)} onPaneClick={() => onSelect(undefined)} proOptions={{ hideAttribution: false }}>
        <CanvasFit enabled={fitWindow} layoutKey={layoutKey} padding={.12}/>
        <Background variant={BackgroundVariant.Dots} gap={21} size={1} color="#dce3ed"/><Controls showInteractive={false} position="bottom-left"/>
      </ReactFlow>
    </div>
    <div className="deployment-flow-explainer">{overlap ? <span><strong>Work overlapped.</strong> Some steps were active at the same time. Numbers follow their individual recorded starts.</span> : <span>{native ? 'Scheduled together is the native fork; overlap is confirmed only when live execution records it.' : flow.basis === 'recorded' ? 'Numbers follow recorded starts, including checks of existing resources.' : 'Branches describe dependencies; they do not promise parallel execution.'}</span>}<span>Compute, Storage and Network are labels, not a fixed sequence.</span></div>
    {flow.existingPrerequisites.length > 0 && <p className="deployment-existing"><Icon name="check" size={13}/><strong>Already available:</strong> {flow.existingPrerequisites.map(item => item.label).join(', ')}. These are not deployment steps.</p>}
    {flow.warnings.length > 0 && <p className="deployment-flow-warning" role="status">{flow.warnings.join(' ')}</p>}
  </section>;
}
