import {useMemo,useState} from 'react';
import {Controls} from '@xyflow/react';
import {FootprintTheme,TracedFlow} from 'footprint-explainable-ui/flowchart';
import type {AdapterDeploymentView} from '../../../src/core/adapter-deployment.ts';
import type {DashboardState} from '../../../src/core/types.ts';
import {DetailsPanel} from '../../components/DetailsPanel.tsx';
import {DeploymentFlow} from '../../components/DeploymentFlow.tsx';
import {useLensTheme} from '../../theme/LensThemeContext.tsx';
import {createRunDeploymentGraph} from './create-run-deployment-graph.ts';
import {StandardChartMeasurements} from './StandardChartMeasurements.tsx';
import {StandardChartFocus,type StepFocus} from './StandardChartFocus.tsx';

export default function RunDeploymentScene({state,deployment}:{state:DashboardState;deployment?:AdapterDeploymentView}) {
 const theme=useLensTheme();
 const [chosenResource,setResource]=useState<string>(),[scope,setScope]=useState<string|null>(null),[selected,setSelected]=useState<string>();
 const [focus,setFocus]=useState<StepFocus>();
 const resource=deployment?.resources.find(row=>row.resourceId===chosenResource)??deployment?.resources[0];
 const graph=useMemo(()=>resource?createRunDeploymentGraph(resource):undefined,[resource]);
 const currentScope=scope&&resource?.stages.some(stage=>stage.childScope===scope)?scope:null;
 const inspected=resource?.stages.find(stage=>stage.id===selected);
 const focused=resource?.stages.find(stage=>stage.id===focus?.id);
 if(!deployment?.available||!resource||!graph)return <div className="run-deployment-fallback"><DeploymentFlow state={state} fitWindow onSelect={()=>{}}/><p>Detailed adapter steps were not captured for this moment.</p></div>;
 return <div className="run-deployment-scene" data-deployment-renderer="standard-explainable-ui">
  <div className="run-scope-controls">
   {deployment.resources.length>1?<select aria-label="Replay deployment resource" value={resource.resourceId} onChange={event=>{setResource(event.target.value);setScope(null);setSelected(undefined);setFocus(undefined);}}>{deployment.resources.map(row=><option key={row.resourceId} value={row.resourceId}>{row.label}</option>)}</select>:<span className="run-resource-label">{resource.label}</span>}
   <span>{resource.action==='noop'?'Check existing setup':resource.action==='update'?'Update existing setup':'Recorded deployment'}</span>
   {focused&&<button className="run-step-details" onClick={()=>setSelected(focused.id)}>Step details</button>}
  </div>
  <div className="run-deployment-canvas"><FootprintTheme tokens={theme.tokens}>
   {/* A new scope owns fresh measurements/camera; progress in that scope keeps both. */}
   <TracedFlow key={`${resource.rootScope}:${currentScope??'root'}`} graph={graph} renderer="flat" background={false} style={{minHeight:0}}
    currentSubflowId={currentScope} onSubflowChange={id=>{setScope(id);setSelected(undefined);setFocus(undefined);}}
    onNodeClick={id=>{const stage=resource.stages.find(stage=>stage.id===id);if(stage&&!stage.childScope)setFocus(previous=>({id,sequence:(previous?.sequence??0)+1}));}}
    autoFit={{padding:.12,maxZoom:1}} minZoom={.01} maxZoom={1.5}>
    <StandardChartMeasurements/>
    <StandardChartFocus request={focus}/>
    <Controls position="bottom-left" showInteractive={false}/>
   </TracedFlow>
  </FootprintTheme></div>
  {deployment.warnings.length>0&&<p className="run-projection-warning" role="status">{deployment.warnings.join(' ')}</p>}
  {inspected&&<DetailsPanel title={inspected.label} onClose={()=>setSelected(undefined)}><p>{inspected.status==='unknown'?'Unconfirmed':inspected.status==='pending'?'Waiting':inspected.status}</p>{inspected.reason&&<p>{inspected.reason}</p>}<p>Recorded at the selected replay moment.</p><dl><dt>Stage</dt><dd><code>{inspected.id}</code></dd><dt>Run</dt><dd>{deployment.runId}</dd></dl>{inspected.runtimeStageIds.map(id=><p key={id}><code>{id}</code></p>)}</DetailsPanel>}
 </div>;
}
