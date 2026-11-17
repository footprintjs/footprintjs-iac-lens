import {asStageId,type TraceGraph} from 'footprint-explainable-ui/flowchart';
import type {buildDeploymentFlowView} from './deployment-flow-view.ts';

/** Presentation only: the admitted projection still owns scheduling and observed order. */
export function createDeploymentTraceGraph(view:ReturnType<typeof buildDeploymentFlowView>) {
  return {
    nodes:view.nodes.map(node=>({...node,data:{...node.data,label:node.data.title,
      isDecider:false,isFork:false,isSubflow:false,isStreaming:false,
      prevIds:view.edges.filter(edge=>edge.target===node.id).map(edge=>asStageId(edge.source)),
      nextIds:view.edges.filter(edge=>edge.source===node.id).map(edge=>asStageId(edge.target)),
    }})),
    edges:view.edges.map(edge=>({...edge,type:undefined,data:{...edge.data,kind:'next' as const,
      // Labels and dash patterns retain needs/scheduled/observed semantics.
      relationship:edge.label,domain:'deployment',
    }})),
  } satisfies TraceGraph;
}
