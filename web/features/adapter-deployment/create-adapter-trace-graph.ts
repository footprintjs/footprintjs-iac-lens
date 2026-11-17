import {asStageId,type TraceGraph} from 'footprint-explainable-ui/flowchart';
import type {adapterFlowLayout} from './adapter-flow-layout.ts';

/** The scoped native adapter graph is rendered by EUI; no runtime facts are invented here. */
export function createAdapterTraceGraph(layout:ReturnType<typeof adapterFlowLayout>) {
  return {
    nodes:layout.nodes.map(node=>({...node,data:{...node.data,label:node.data.stage.label,
      isDecider:node.data.stage.kind==='decision',isFork:false,isStreaming:false,
      // This graph is already scoped. Exact native subflow navigation belongs to the selector/card callbacks.
      isSubflow:false,
      prevIds:layout.edges.filter(edge=>edge.target===node.id).map(edge=>asStageId(edge.source)),
      nextIds:layout.edges.filter(edge=>edge.source===node.id).map(edge=>asStageId(edge.target)),
    }})),
    edges:layout.edges.map(edge=>({...edge,type:undefined,data:{...edge.data,
      kind:edge.data?.kind==='loop'?'loop' as const:edge.data?.kind==='decision-branch'?'decision-branch' as const:'next' as const,
      domain:'deployment-adapter',
    }})),
  } satisfies TraceGraph;
}
