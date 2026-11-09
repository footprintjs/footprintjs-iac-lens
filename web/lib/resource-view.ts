import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { layoutResources, type ResourceEdgeView, type ResourceNodeView } from '../../src/core/layout.ts';
import type { DashboardState } from '../../src/core/types.ts';

export interface ResourceNodeData extends Record<string, unknown> {
  resource: ResourceNodeView['resource']; description: ResourceNodeView['description']; progress: ResourceNodeView['progress'];
  size: ResourceNodeView['size'];
  communicationSource: boolean; communicationTarget: boolean;
}
export type ResourceFlowNode = Node<ResourceNodeData, 'resource'>;
export interface ResourceEdgeData extends Record<string, unknown> { kind: ResourceEdgeView['kind']; route: ResourceEdgeView['route']; label?: string; connectionStatus?: ResourceEdgeView['connectionStatus'] }
export type ResourceFlowEdge = Edge<ResourceEdgeData, 'resource'>;
export function buildResourceView(state: DashboardState, selected?: string): { nodes: ResourceFlowNode[]; edges: ResourceFlowEdge[] } {
  const view = layoutResources(state);
  return {
    nodes: view.nodes.map(node => ({ id: node.id, type: 'resource', position: node.position, selected: selected === node.id,
      data: { resource: node.resource, description: node.description, progress: node.progress, size: node.size,
        communicationSource: view.edges.some(edge => edge.kind === 'communication' && edge.source === node.id),
        communicationTarget: view.edges.some(edge => edge.kind === 'communication' && edge.target === node.id) }, style: node.size,
      ariaLabel: `${node.description.name}, ${node.progress.status}, ${node.id}` })),
    edges: view.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, type: 'resource',
      sourceHandle: edge.route.sourceHandle, targetHandle: edge.route.targetHandle, data: { kind: edge.kind, route: edge.route, label: edge.label, connectionStatus: edge.connectionStatus },
      ariaLabel: `${edge.source} ${edge.kind === 'order' ? 'must precede' : 'communicates with'} ${edge.target}${edge.connectionStatus ? `, ${edge.connectionStatus}` : ''}`,
      animated: edge.active, style: { stroke: edge.color, strokeWidth: edge.kind === 'order' ? 1.7 : 1.1, ...(edge.kind === 'communication' ? { strokeDasharray: '4 5' } : {}) },
      ...(edge.kind === 'order' ? { markerEnd: { type: MarkerType.ArrowClosed, color: edge.color, width: 17, height: 17 } } : {}) })),
  };
}
