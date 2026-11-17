import {currentRecordedDeploymentStep,type RecordedDeploymentStep} from '../../../src/core/topology-deployment-step.ts';
import {useMemo,useState} from 'react';
import {BackgroundVariant,Controls} from '@xyflow/react';
import {FootprintTheme,TracedFlow} from 'footprint-explainable-ui/flowchart';
import type {DashboardState} from '../../../src/core/types.ts';
import type {AdapterDeploymentView,AdapterDeploymentStage,AdapterDeploymentResource} from '../../../src/core/adapter-deployment.ts';
import {DetailsPanel} from '../../components/DetailsPanel.tsx';
import {AdapterStepCard,AdapterStatus} from './AdapterStepCard.tsx';
import {adapterFlowLayout} from './adapter-flow-layout.ts';
import {createAdapterTraceGraph} from './create-adapter-trace-graph.ts';
import {useLensTheme} from '../../theme/LensThemeContext.tsx';
import './adapter-deployment.css';
const nodeTypes={'adapter-step':AdapterStepCard};
function initialScope(resource:AdapterDeploymentResource):string {
  if(resource.adapterScope)return resource.adapterScope;
  // A camera choice only: every status still requires native observations.
  return [...resource.scopes].sort((a,b)=>resource.stages.filter(stage=>stage.scope===b.id&&stage.kind==='decision').length-resource.stages.filter(stage=>stage.scope===a.id&&stage.kind==='decision').length||b.id.length-a.id.length)[0]?.id??resource.rootScope;
}
export default function AdapterDeploymentFlow({state,view,fitWindow,recordedStep,onClearRecordedStep}:{recordedStep?:RecordedDeploymentStep;onClearRecordedStep?():void;state:DashboardState;view:AdapterDeploymentView;fitWindow:boolean}) {
  const theme=useLensTheme();
  const [selectedResource,setResource]=useState<string>(),[selectedScope,setScope]=useState<string>(),[fullChart,setFullChart]=useState(false),[selectedStage,setSelectedStage]=useState<AdapterDeploymentStage>();
  const focus=currentRecordedDeploymentStep(view,recordedStep);
  const resource=view.resources.find(row=>row.resourceId===(focus?.resourceId??selectedResource))??view.resources[0]!;
  const scopeId=focus?.scope??(resource.scopes.some(scope=>scope.id===selectedScope)?selectedScope!:initialScope(resource));
  const scope=resource.scopes.find(row=>row.id===scopeId)!;
  const inspectedStage=resource.stages.find(stage=>stage.id===(focus?.stageId??selectedStage?.id));
  const unchanged=resource.action==='noop'&&resource.stages.filter(stage=>stage.scope===scopeId).every(stage=>stage.status==='skipped');
  const layout=useMemo(()=>adapterFlowLayout(resource,scopeId,fullChart,setSelectedStage,setScope),[resource,scopeId,fullChart]);
  const graph=useMemo(()=>createAdapterTraceGraph(layout),[layout]);
  const existing=state.systemTopology?.nodes.filter(node=>node.origin==='existing').map(node=>node.label)??[];
  return <section className="adapter-deployment" aria-label="Recorded adapter deployment steps">
    <header className="adapter-flow-heading"><div><h2>Inside the deployment</h2><p>{resource.resourceId} · {resource.action==='noop'?'Checking existing setup':resource.action==='update'?'Updating existing setup':'Recorded resource operation'}</p></div><span className="adapter-recorded">{state.run?.status==='running'?'Live FootPrint progress':'FootPrint recording'}</span></header>
    <div className="adapter-flow-toolbar">
      {view.resources.length>1&&<label>Resource<select aria-label="Deployment resource" value={resource.resourceId} onChange={event=>{onClearRecordedStep?.();setSelectedStage(undefined);setResource(event.target.value);setScope(undefined);}}>{view.resources.map(row=><option key={row.resourceId} value={row.resourceId}>{row.resourceId}</option>)}</select></label>}
      {scope.parentScope&&<button type="button" className="adapter-scope-back" onClick={()=>{onClearRecordedStep?.();setSelectedStage(undefined);setScope(scope.parentScope);}}>← Parent flow</button>}
      <label>Subflow<select aria-label="Deployment subflow" value={scopeId} onChange={event=>{onClearRecordedStep?.();setSelectedStage(undefined);setScope(event.target.value);}}>{resource.scopes.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
      <button type="button" className="adapter-chart-toggle" aria-pressed={fullChart} onClick={()=>setFullChart(!fullChart)}>{fullChart?'Group decisions':'Show full chart'}</button>
    </div>
    {unchanged&&<p className="adapter-unchanged" role="status">No provider change was needed. These steps were skipped; the parent flow records the checks.</p>}
    <div className="adapter-flow-canvas" style={fitWindow?undefined:{height:390}}>
      <FootprintTheme tokens={theme.tokens}><TracedFlow graph={graph} layout="passthrough" unstyled style={{minHeight:0}} nodeTypes={nodeTypes}
        currentSubflowId={null} breadcrumb={false} autoFit={{padding:.04,maxZoom:1}} minZoom={.2} maxZoom={1.7}
        background={{variant:BackgroundVariant.Dots,gap:20,size:1,color:'var(--fp-border, #dce3ed)'}}>
        <Controls showInteractive={false} position="bottom-left"/>
      </TracedFlow></FootprintTheme>
    </div>
    {existing.length>0&&<div className="adapter-existing"><strong>Existing</strong><span title={existing.join(' · ')}>{existing.join(' · ')}</span></div>}
    <footer className="adapter-flow-footer">{(['pending','running','completed','skipped','failed'] as const).map(status=><AdapterStatus key={status} status={status}/>)}<small>Arrows follow the native chart · click a step for evidence.</small></footer>
    {view.warnings.length>0&&<p className="adapter-flow-warning" role="status">{view.warnings.join(' ')}</p>}
    {inspectedStage&&<DetailsPanel title={inspectedStage.label} onClose={()=>{setSelectedStage(undefined);onClearRecordedStep?.();}}><div className="adapter-stage-detail"><AdapterStatus status={inspectedStage.status}/>{inspectedStage.reason&&<p>{inspectedStage.reason}</p>}<dl><dt>Resource</dt><dd>{inspectedStage.resourceId}</dd><dt>Deployment run</dt><dd><code>{view.runId}</code></dd><dt>Native run</dt><dd><code>{view.nativeRunId??'Unavailable'}</code></dd>{focus&&<><dt>Linked execution</dt><dd><code>{focus.runtimeStageId}</code></dd></>}<dt>Chart scope</dt><dd><code>{inspectedStage.scope}</code></dd><dt>Stage</dt><dd><code>{inspectedStage.stageId}</code></dd><dt>Recorded executions</dt><dd>{inspectedStage.executions}</dd></dl>{inspectedStage.runtimeStageIds.map(id=><code key={id}>{id}<br/></code>)}<p>Execution evidence retains the complete native recording, including branch decisions.</p></div></DetailsPanel>}
  </section>;
}
