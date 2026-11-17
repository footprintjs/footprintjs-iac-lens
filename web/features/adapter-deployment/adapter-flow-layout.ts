import {MarkerType, Position, type Edge, type Node} from '@xyflow/react';
import type {AdapterDeploymentEdge,AdapterDeploymentResource, AdapterDeploymentStage} from '../../../src/core/adapter-deployment.ts';

export const ADAPTER_CARD_WIDTH=220, ADAPTER_CARD_HEIGHT=128;
export interface AdapterCardData extends Record<string,unknown> {
  stage:AdapterDeploymentStage; branches:AdapterDeploymentStage[]; direction:'forward'|'reverse';
  onInspect(stage:AdapterDeploymentStage):void; onScope(id:string):void;
}
export type AdapterCardNode=Node<AdapterCardData,'adapter-step'>;
export interface AdapterFlowEdgeData extends Record<string,unknown> {
  kind:'next'|'decision-branch'|'loop'; nativeKind:AdapterDeploymentEdge['kind']; selected?:boolean;
}
export type AdapterFlowEdge=Edge<AdapterFlowEdgeData>;

/** Compact decisions retain both real branches inside the same native gate. */
export function adapterFlowLayout(resource:AdapterDeploymentResource,scope:string,fullChart:boolean,onInspect:AdapterCardData['onInspect'],onScope:AdapterCardData['onScope'],options:{width?:number;height?:number;columns?:number;gapX?:number;gapY?:number}={}) {
  const width=options.width??ADAPTER_CARD_WIDTH,height=options.height??ADAPTER_CARD_HEIGHT,columnsPerBand=options.columns??4,gapX=options.gapX??40,gapY=options.gapY??42;
  const stages=resource.stages.filter(stage=>stage.scope===scope), byId=new Map(stages.map(stage=>[stage.id,stage]));
  const groups=new Map<string,AdapterDeploymentStage[]>(), owner=new Map<string,string>();
  if(!fullChart) for(const gate of stages.filter(stage=>stage.kind==='decision')) {
    const branches=resource.edges.filter(edge=>edge.source===gate.id&&edge.kind==='branch').map(edge=>byId.get(edge.target)).filter((stage):stage is AdapterDeploymentStage=>!!stage);
    if(!branches.length||branches.length>2||branches.some(stage=>resource.edges.some(edge=>edge.source===stage.id&&edge.kind==='branch')))continue;
    groups.set(gate.id,branches);for(const branch of branches)owner.set(branch.id,gate.id);
  }
  const cards=stages.filter(stage=>!owner.has(stage.id));
  const columns=[...new Set(cards.map(stage=>stage.column))].sort((a,b)=>a-b);
  const rows=[...new Set(cards.map(stage=>stage.row))].sort((a,b)=>a-b), lanes=rows.length;
  const nodes:AdapterCardNode[]=cards.map(stage=>{
    const column=columns.indexOf(stage.column), band=Math.floor(column/columnsPerBand), reverse=band%2===1;
    const x=(reverse?columnsPerBand-1-column%columnsPerBand:column%columnsPerBand)*(width+gapX);
    const y=(band*lanes+rows.indexOf(stage.row))*(height+gapY), direction=reverse?'reverse' as const:'forward' as const;
    const sourcePosition=reverse?Position.Left:Position.Right,targetPosition=reverse?Position.Right:Position.Left;
    return{id:stage.id,type:'adapter-step',position:{x,y},width,height,
      style:{width,height},data:{stage,branches:groups.get(stage.id)??[],direction,onInspect,onScope},sourcePosition,targetPosition,
      handles:[{type:'source',position:sourcePosition,x:reverse?-4:width-4,y:height/2-4,width:8,height:8},{type:'target',position:targetPosition,x:reverse?width-4:-4,y:height/2-4,width:8,height:8}],
      ariaLabel:`${stage.label}: ${stage.status}`};
  });
  const rendered=new Map(nodes.map(node=>[node.id,node])), seen=new Set<string>(), edges:AdapterFlowEdge[]=[];
  for(const edge of resource.edges){
    const source=owner.get(edge.source)??edge.source,target=owner.get(edge.target)??edge.target;
    if(source===target||!rendered.has(source)||!rendered.has(target))continue;
    const key=`${source}:${target}:${edge.kind}`;if(seen.has(key))continue;seen.add(key);
    const actual=byId.get(edge.source)!, color=actual.status==='failed'?'var(--fp-color-error,#c75c6d)':actual.status==='running'?'var(--fp-color-primary,#5287ce)':edge.selected===false?'var(--fp-border,#bac2ce)':'var(--fp-text-muted,#7f91ac)';
    edges.push({id:edge.id,source,target,type:'smoothstep',label:fullChart&&edge.kind==='branch'?(edge.selected===undefined?'branch':edge.selected?'selected':'not selected'):edge.kind==='loop'?'retry':undefined,
      data:{kind:edge.kind==='loop'?'loop':edge.kind==='branch'?'decision-branch':'next',nativeKind:edge.kind,...edge.selected===undefined?{}:{selected:edge.selected}},
      animated:actual.status==='running',style:{stroke:color,strokeWidth:1.6,...(edge.selected===false||edge.kind==='loop'?{strokeDasharray:'4 5'}:{})},markerEnd:{type:MarkerType.ArrowClosed,color,width:10,height:10},labelStyle:{fontSize:9,fill:'var(--fp-text-secondary,#73859a)'},labelBgStyle:{fill:'var(--fp-bg-elevated,#f8fafc)'},labelBgPadding:[3,2]});
  }
  return{nodes,edges};
}
