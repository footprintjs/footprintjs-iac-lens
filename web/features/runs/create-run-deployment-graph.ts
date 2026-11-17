import {asStageId,type TraceGraph,type TraceNodeData} from 'footprint-explainable-ui/flowchart';
import type {AdapterDeploymentResource,AdapterDeploymentStage,AdapterDeploymentStatus} from '../../../src/core/adapter-deployment.ts';

export interface RunDeploymentNodeData extends TraceNodeData {
 stage:AdapterDeploymentStage;
 nativeStatus:AdapterDeploymentStatus;
 nativeKind?:string;
}
const statusLabels:Record<AdapterDeploymentStatus,string>={pending:'Waiting',running:'Running',completed:'Done',skipped:'Skipped',failed:'Failed',unknown:'Unconfirmed'};
const decisionLabel=(label:string)=>Array.from(label).length>18?Array.from(label).slice(0,17).join('')+'…':label;

/** Translate one admitted moment to EUI's standard nodes, geometry and native subflow navigation. */
export function createRunDeploymentGraph(resource:AdapterDeploymentResource):TraceGraph {
 const scopes=new Set(resource.scopes.map(scope=>scope.id));
 const structural=resource.edges.filter(edge=>edge.kind!=='loop');
 return{
  nodes:resource.stages.map(stage=>{
   const isFork=stage.nativeKind==='fork';
   const isSubflow=stage.kind==='subflow'&&!!stage.childScope&&scopes.has(stage.childScope);
   const data:RunDeploymentNodeData={
    label:stage.kind==='decision'&&!isFork?decisionLabel(stage.label):stage.label,description:statusLabels[stage.status],stageId:stage.stageId,
    isDecider:stage.kind==='decision'&&!isFork,isFork,isSubflow,isStreaming:false,
    ...isSubflow?{subflowId:stage.childScope}:{},
    ...stage.scope!==resource.rootScope?{subflowOf:stage.scope}:{},
    prevIds:structural.filter(edge=>edge.target===stage.id).map(edge=>asStageId(edge.source)),
    nextIds:structural.filter(edge=>edge.source===stage.id).map(edge=>asStageId(edge.target)),
    // The recording already defines this moment. It does not define a synthetic execution order.
    active:stage.status==='running',done:stage.status==='completed',error:stage.status==='failed',
    stage,nativeStatus:stage.status,...stage.nativeKind?{nativeKind:stage.nativeKind}:{},
   };
   return{id:stage.id,type:'stageNode',position:{x:0,y:0},draggable:false,connectable:false,data,domAttributes:{title:stage.label},
    ariaLabel:`${stage.label}: ${statusLabels[stage.status]}`};
  }),
  edges:resource.edges.map(edge=>({
   id:edge.id,source:edge.source,target:edge.target,label:edge.label,
   data:{kind:edge.kind==='branch'?'decision-branch':edge.kind,nativeKind:edge.kind,...edge.selected===undefined?{}:{selected:edge.selected}},
   ...edge.selected===false?{style:{opacity:.45,strokeDasharray:'4 5'}}:{},
   ariaLabel:`${edge.label??edge.kind}${edge.selected===undefined?'':edge.selected?': recorded selected branch':': recorded unselected branch'}`,
  })),
 };
}
