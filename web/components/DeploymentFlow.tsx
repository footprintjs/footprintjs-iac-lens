import type {RecordedDeploymentStep} from '../../src/core/topology-deployment-step.ts';
import { useMemo, useState } from 'react';
import { BackgroundVariant, Controls } from '@xyflow/react';
import {FootprintTheme,TracedFlow} from 'footprint-explainable-ui/flowchart';
import type { DashboardState } from '../../src/core/types.ts';
import { buildDeploymentFlowView } from '../lib/deployment-flow-view.ts';
import { DeploymentStep } from './DeploymentStep.tsx';
import { Icon } from './Icon.tsx';
import {createDeploymentTraceGraph} from '../lib/create-deployment-trace-graph.ts';
import {useLensTheme} from '../theme/LensThemeContext.tsx';
import { projectAdapterDeployment } from '../../src/core/adapter-deployment.ts';
import { AdapterDeploymentSlot } from '../features/adapter-deployment/AdapterDeploymentSlot.tsx';
import { DeploymentWaitDetails } from './DeploymentWaitDetails.tsx';
import './deployment-flow.css';

const nodeTypes = { 'deployment-step': DeploymentStep };

/** The resource pipeline is ordered by captured execution, never by capability category. */
export function DeploymentFlow({ state, selected, fitWindow = false, inlineStepDetails = false, onSelect, recordedStep, onClearRecordedStep }: { recordedStep?:RecordedDeploymentStep; onClearRecordedStep?():void; state: DashboardState; selected?: string; fitWindow?: boolean; inlineStepDetails?: boolean; onSelect(id: string | undefined): void }) {
  const theme=useLensTheme();
  const [prerequisites, setPrerequisites] = useState(false);
  const view = useMemo(() => buildDeploymentFlowView(state, selected, prerequisites), [state, selected, prerequisites]);
  const graph = useMemo(()=>createDeploymentTraceGraph(view),[view]);
  const adapter = useMemo(() => projectAdapterDeployment(state, selected), [state, selected]);
  const { flow } = view;
  const selectedNode = flow.nodes.find(node => node.id === selected);
  const stepDetails = inlineStepDetails && selectedNode && <section className="deployment-step-details" aria-label={`Step details for ${selectedNode.id}`}><h3>Step details <code>{selectedNode.id}</code></h3><DeploymentWaitDetails node={selectedNode} columns={flow.columns}/></section>;
  if (adapter.available) return <AdapterDeploymentSlot state={state} view={adapter} fitWindow={fitWindow} recordedStep={recordedStep} onClearRecordedStep={onClearRecordedStep}/>;
  if (!flow.nodes.length) return null;
  const overlap = flow.columns.some(column => column.overlapping);
  const preview = flow.layoutSource === 'schedule-preview';
  const children = flow.layoutSource === 'native-children';
  const native = flow.layoutSource === 'native-chart' || preview;
  const reasonsRecorded = flow.nodes.some(node => node.schedule);
  return <section className="deployment-flow" aria-label="Deployment flow">
    <div className="deployment-flow-heading"><div><span className="eyebrow">FOLLOW THE DEPLOYMENT</span><h2>{children ? 'The workflow, one resource at a time' : native ? 'The deployment, one step at a time' : flow.basis === 'recorded' ? 'What ran, in the order it started' : 'What must be ready before the next step'}</h2><p>{children ? 'Create and Connect have separate native recordings. Step numbers restart within each; Found resources use read-only lookups.' : native ? 'Boxes and branches come from the native chart. Numbers and colours follow its live recorder.' : flow.basis === 'recorded' ? 'Read the numbered steps from left to right. Click any step to see what it contains.' : 'Arrows show prerequisites. Actual start order appears when FootPrint records the run.'}</p></div>
      <span className={`flow-source flow-source-${flow.basis}`}><i/>{children ? 'Native child recordings' : preview ? 'Planned native schedule' : native ? 'Native chart + events' : flow.basis === 'recorded' ? 'Recorded execution' : state.run?.status === 'idle' ? 'Before execution' : 'Order not recorded'}</span></div>
    <div className="deployment-flow-toolbar"><span><Icon name="arrow" size={14}/>{reasonsRecorded ? 'Solid: prerequisite · dashed: scheduling wait' : native ? 'Next: scheduled · then: observed · needs: prerequisite' : flow.basis === 'recorded' ? prerequisites ? 'Solid: ran next · dashed: prerequisite' : 'Solid arrows: finished, then started' : 'Dashed arrows: must be ready first'}</span>{!reasonsRecorded && (native || flow.basis === 'recorded') && <button aria-pressed={prerequisites} onClick={() => setPrerequisites(!prerequisites)}>{prerequisites ? 'Hide prerequisites' : 'Show prerequisites'}</button>}<small>Drag to pan · use + / − to zoom</small></div>
    <div className="deployment-flow-canvas" style={fitWindow ? undefined : { height: flow.columns.some(column => column.resourceIds.length > 1) ? 470 : 315 }}>
      <FootprintTheme tokens={theme.tokens}><TracedFlow key={`${state.graph?.digest}:${flow.layoutSource}:${flow.basis}`} graph={graph} layout="passthrough" unstyled
        style={{minHeight:0}} nodeTypes={nodeTypes} currentSubflowId={null} breadcrumb={false}
        autoFit={{padding:.12,maxZoom:1}} minZoom={fitWindow ? .15 : .35} maxZoom={1.6} onNodeClick={onSelect}
        background={{variant:BackgroundVariant.Dots,gap:21,size:1,color:'var(--fp-border, #dce3ed)'}}>
        <Controls showInteractive={false} position="bottom-left"/>
      </TracedFlow></FootprintTheme>
    </div>
    {stepDetails}
    <div className="deployment-flow-explainer">{overlap ? <span><strong>Work overlapped.</strong> Some steps were active at the same time. Numbers follow their individual recorded starts.</span> : <span>{children ? 'Numbers belong to each child recording. Found resources have no deployment start or step number.' : native ? 'Scheduled together is the native fork; overlap is confirmed only when live execution records it.' : flow.basis === 'recorded' ? 'Numbers follow recorded starts, including checks of existing resources.' : 'Branches describe dependencies; they do not promise parallel execution.'}</span>}<span>Compute, Storage and Network are labels, not a fixed sequence.</span></div>
    {flow.existingPrerequisites.length > 0 && <p className="deployment-existing"><Icon name="check" size={13}/><strong>Already available:</strong> {flow.existingPrerequisites.map(item => item.label).join(', ')}. These are not deployment steps.</p>}
    {(flow.warnings.length > 0 || adapter.warnings.length > 0) && <p className="deployment-flow-warning" role="status">{[...new Set([...flow.warnings,...adapter.warnings])].join(' ')}</p>}
  </section>;
}
