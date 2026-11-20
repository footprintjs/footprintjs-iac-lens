import {useEffect,useMemo,useState} from 'react';
import {Controls} from '@xyflow/react';
import {FootprintTheme,TracedFlow} from 'footprint-explainable-ui/flowchart';
import type {AdapterDeploymentView} from '../../../src/core/adapter-deployment.ts';
import type {DashboardState} from '../../../src/core/types.ts';
import type {ExecutionFollowPlan} from '../../../src/core/execution-follow.ts';
import {DetailsPanel} from '../../components/DetailsPanel.tsx';
import {DeploymentFlow} from '../../components/DeploymentFlow.tsx';
import {useLensTheme} from '../../theme/LensThemeContext.tsx';
import {createRunDeploymentGraph} from './create-run-deployment-graph.ts';
import {StandardChartMeasurements} from './StandardChartMeasurements.tsx';
import {StandardChartFocus,type StepFocus} from './StandardChartFocus.tsx';
import type {FollowScopeContext} from './follow-scope-context.ts';
import {projectDeploymentFlow} from '../../../src/core/deployment-flow.ts';
import {DeploymentWaitDetails} from '../../components/DeploymentWaitDetails.tsx';

export default function RunDeploymentScene({state,deployment,executionPlan,cameraContext,onExplore}:{state:DashboardState;deployment?:AdapterDeploymentView;executionPlan?:ExecutionFollowPlan;cameraContext?:FollowScopeContext;onExplore?():void}) {
 const theme=useLensTheme();
 const [chosenResource,setResource]=useState<string>(),[scope,setScope]=useState<string|null>(null),[selected,setSelected]=useState<string>();
 const [focus,setFocus]=useState<StepFocus>();
 const followingExecution=!!executionPlan;
 useEffect(()=>{if(followingExecution){setFocus(undefined);setSelected(undefined);}},[followingExecution]);
 const resource=deployment?.resources.find(row=>row.resourceId===(executionPlan?.resourceId??chosenResource))??deployment?.resources[0];
 const graph=useMemo(()=>resource?createRunDeploymentGraph(resource):undefined,[resource]);
 const admittedContext=cameraContext?.runId===deployment?.runId&&cameraContext?.resourceId===resource?.resourceId?cameraContext:undefined;
 const desiredScope=executionPlan?admittedContext?.scopeId??executionPlan.scopeId:scope;
 const currentScope=desiredScope&&resource?.stages.some(stage=>stage.childScope===desiredScope)?desiredScope:null;
 // Pausing Follow from the other pane retains the last automatic navigation,
 // just as exploring this chart directly does.
 useEffect(()=>{if(executionPlan&&resource){setResource(resource.resourceId);setScope(currentScope);}},[!!executionPlan,resource?.resourceId,currentScope]);
 const inspected=resource?.stages.find(stage=>stage.id===selected);
 const focused=resource?.stages.find(stage=>stage.id===focus?.id);
 const flow=useMemo(()=>inspected?projectDeploymentFlow(state):undefined,[inspected,state]);
 const inspectedResource=flow?.nodes.find(node=>node.id===inspected?.resourceId);
 if(!deployment?.available||!resource||!graph)return <div className="run-deployment-fallback"><DeploymentFlow state={state} fitWindow inlineStepDetails selected={chosenResource} onSelect={setResource}/><p>Detailed adapter steps were not captured for this moment.</p></div>;
 const explore=()=>{if(executionPlan){setResource(resource.resourceId);setScope(currentScope);}onExplore?.();};
 return <div className="run-deployment-scene" data-deployment-renderer="standard-explainable-ui">
  <div className="run-scope-controls">
   {deployment.resources.length>1?<select aria-label="Replay deployment resource" value={resource.resourceId} onChange={event=>{explore();setResource(event.target.value);setScope(null);setSelected(undefined);setFocus(undefined);}}>{deployment.resources.map(row=><option key={row.resourceId} value={row.resourceId}>{row.label}</option>)}</select>:<span className="run-resource-label">{resource.label}</span>}
   <span>{executionPlan&&executionPlan.activeResourceIds.length>1?`${executionPlan.activeResourceIds.length} resources running · `:''}{resource.action==='noop'?'Check existing setup':resource.action==='update'?'Update existing setup':'Recorded deployment'}</span>
   {focused&&<button className="run-step-details" onClick={()=>setSelected(focused.id)}>Step details</button>}
  </div>
  <div className="run-deployment-canvas" data-follow-scope={currentScope??resource.rootScope} data-follow-scope-held={!!executionPlan&&!!admittedContext?.held} data-follow-focus-stage-ids={JSON.stringify(executionPlan?.stageIds??[])} onPointerDownCapture={explore} onWheelCapture={explore} onKeyDownCapture={event=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','+','-','Enter',' '].includes(event.key))explore();}}><FootprintTheme tokens={theme.tokens}>
   {/* A new scope owns fresh measurements/camera; progress in that scope keeps both. */}
   <TracedFlow key={`${resource.rootScope}:${currentScope??'root'}`} graph={graph} renderer="flat" background={false} style={{minHeight:0}}
    currentSubflowId={currentScope} onSubflowChange={id=>{explore();setScope(id);setSelected(undefined);setFocus(undefined);}}
    onNodeClick={id=>{const stage=resource.stages.find(stage=>stage.id===id);if(stage&&!stage.childScope){explore();setFocus(previous=>({id,sequence:(previous?.sequence??0)+1}));}}}
    autoFit={false} minZoom={.01} maxZoom={1.5}>
    <StandardChartMeasurements/>
    <StandardChartFocus request={focus} followIds={executionPlan?.stageIds}/>
    <Controls position="bottom-left" showInteractive={false}/>
   </TracedFlow>
  </FootprintTheme></div>
  {deployment.warnings.length>0&&<p className="run-projection-warning" role="status">{deployment.warnings.join(' ')}</p>}
  {inspected&&<DetailsPanel title={inspected.label} onClose={()=>setSelected(undefined)}><p>{inspected.status==='unknown'?'Unconfirmed':inspected.status==='pending'?'Waiting':inspected.status}</p>{inspected.reason&&<p>{inspected.reason}</p>}<p>Recorded at the selected replay moment.</p>{inspectedResource&&flow&&<DeploymentWaitDetails node={inspectedResource} columns={flow.columns}/>}<dl><dt>Stage</dt><dd><code>{inspected.id}</code></dd><dt>Run</dt><dd>{deployment.runId}</dd></dl>{inspected.runtimeStageIds.map(id=><p key={id}><code>{id}</code></p>)}</DetailsPanel>}
 </div>;
}
