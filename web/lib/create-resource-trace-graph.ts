import type {TraceGraph,TraceNodeData} from 'footprint-explainable-ui/flowchart';
import type {Node,Rect} from '@xyflow/react';
import type {buildResourceView,ResourceNodeData} from './resource-view.ts';

export interface ResourceTraceNodeData extends TraceNodeData {resourceView:ResourceNodeData}
export type ResourceTraceNode=Node<ResourceTraceNodeData,'resource'>;

/** Adapt the legacy resource projection without declaring physical links to be workflow transitions. */
export function createResourceTraceGraph(view:ReturnType<typeof buildResourceView>) {
  return {
    // Namespace domain facts: EUI's description and size fields have different meanings.
    nodes:view.nodes.map((node):ResourceTraceNode=>({...node,draggable:false,connectable:false,data:{resourceView:node.data,
      label:node.data.description.name,isDecider:false,isFork:false,isSubflow:false,isStreaming:false,prevIds:[],nextIds:[],
    }})),
    // Custom resource edges read their routed domain facts from the canvas context.
    // EUI's edge data.kind is reserved for recorded workflow semantics, so omit it here.
    edges:view.edges.map(({data:_resourceData,...edge})=>edge),
  } satisfies TraceGraph;
}

/** Connection lanes can extend beyond cards; camera bounds include both without adding graph objects. */
export function resourceTraceBounds(view:ReturnType<typeof buildResourceView>):Rect {
  if(!view.nodes.length)return{x:0,y:0,width:0,height:0};
  const points=view.nodes.flatMap(node=>[node.position,{x:node.position.x+node.data.size.width,y:node.position.y+node.data.size.height}])
    .concat(view.edges.flatMap(edge=>edge.data?.route.points??[]));
  const x=Math.min(...points.map(point=>point.x)),y=Math.min(...points.map(point=>point.y));
  return{x,y,width:Math.max(...points.map(point=>point.x))-x,height:Math.max(...points.map(point=>point.y))-y};
}
