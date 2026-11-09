import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { layoutResources, type ResourceNodeView } from '../../src/core/layout.ts';
import type { DashboardState } from '../../src/core/types.ts';

export interface ResourceNodeData extends Record<string, unknown> {
  resource: ResourceNodeView['resource']; description: ResourceNodeView['description']; progress: ResourceNodeView['progress'];
}
export type ResourceFlowNode = Node<ResourceNodeData, 'resource'>;
export function buildResourceView(state: DashboardState, selected?: string): { nodes: ResourceFlowNode[]; edges: Edge[] } {
  const view = layoutResources(state);
  return {
    nodes: view.nodes.map(node => ({ id: node.id, type: 'resource', position: node.position, selected: selected === node.id,
      data: { resource: node.resource, description: node.description, progress: node.progress },
      ariaLabel: `${node.description.name}, ${node.progress.status}, ${node.id}` })),
    edges: view.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, type: edge.kind === 'order' ? 'smoothstep' : 'bezier',
      animated: edge.active, style: { stroke: edge.color, strokeWidth: edge.kind === 'order' ? 1.7 : 1.1, ...(edge.kind === 'communication' ? { strokeDasharray: '4 5' } : {}) },
      ...(edge.kind === 'order' ? { markerEnd: { type: MarkerType.ArrowClosed, color: edge.color, width: 17, height: 17 } }
        : { label: 'communicates', labelStyle: { fill: '#738397', fontSize: 10 }, labelBgStyle: { fill: '#f7f9fc' } }) })),
  };
}
