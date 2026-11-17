import { MarkerType, Position, type Edge, type Node, type NodeHandle } from '@xyflow/react';
import { layoutResources, type ResourceEdgeView, type ResourceNodeView, type ResourceLayoutMode } from '../../src/core/layout.ts';
import { COMMUNICATION_SOURCE_OFFSET, COMMUNICATION_TARGET_OFFSET } from '../../src/core/resource-geometry.ts';
import type { DashboardState } from '../../src/core/types.ts';

export interface ResourceNodeData extends Record<string, unknown> {
  resource: ResourceNodeView['resource']; description: ResourceNodeView['description']; progress: ResourceNodeView['progress'];
  size: ResourceNodeView['size'];
  deploymentHandles: boolean;
  communicationSource: boolean; communicationTarget: boolean;
}
export type ResourceFlowNode = Node<ResourceNodeData, 'resource'>;
export interface ResourceEdgeData extends Record<string, unknown> { kind: ResourceEdgeView['kind']; route: ResourceEdgeView['route']; label?: string; connectionStatus?: ResourceEdgeView['connectionStatus'] }
export type ResourceFlowEdge = Edge<ResourceEdgeData, 'resource'>;

/** Fixed ports keep initial and streamed snapshots connected before DOM measurement. */
function resourceHandles(node: ResourceNodeView, edges: ResourceEdgeView[], mode?: ResourceLayoutMode): NodeHandle[] {
  const { width, height } = node.size;
  const handles: NodeHandle[] = mode === 'running-system' ? [] : [
    { id: 'order-in', type: 'target', position: Position.Left, x: -3, y: height / 2 - 3, width: 6, height: 6 },
    { id: 'order-out', type: 'source', position: Position.Right, x: width - 3, y: height / 2 - 3, width: 6, height: 6 },
  ];
  if (edges.some(edge => edge.kind === 'communication' && edge.source === node.id)) {
    handles.push({ id: 'communication-out', type: 'source', position: Position.Bottom,
      x: width * COMMUNICATION_SOURCE_OFFSET - 3, y: height - 3, width: 6, height: 6 });
  }
  if (edges.some(edge => edge.kind === 'communication' && edge.target === node.id)) {
    handles.push({ id: 'communication-in', type: 'target', position: Position.Bottom,
      x: width * COMMUNICATION_TARGET_OFFSET - 3, y: height - 3, width: 6, height: 6 });
  }
  return handles;
}

export function buildResourceView(state: DashboardState, selected?: string, mode?: ResourceLayoutMode): { nodes: ResourceFlowNode[]; edges: ResourceFlowEdge[] } {
  const view = layoutResources(state, mode);
  const paint = (edge: ResourceEdgeView) => {
    const status = edge.connectionStatus ?? view.nodes.find(node => node.id === edge.target)?.progress.status;
    return status === 'failed' ? 'var(--fp-color-error,#c74b4b)' : status === 'ready' || status === 'connected' ? 'var(--fp-color-success,#31866a)'
      : status === 'deploying' || status === 'checking' ? 'var(--fp-color-primary,#3478db)' : 'var(--fp-text-muted,#8e9eb3)';
  };
  return {
    nodes: view.nodes.map(node => ({ id: node.id, type: 'resource', position: node.position, selected: selected === node.id,
      data: { resource: node.resource, description: node.description, progress: node.progress, size: node.size,
        deploymentHandles: mode !== 'running-system',
        communicationSource: view.edges.some(edge => edge.kind === 'communication' && edge.source === node.id),
        communicationTarget: view.edges.some(edge => edge.kind === 'communication' && edge.target === node.id) }, style: node.size,
      width: node.size.width, height: node.size.height,
      handles: resourceHandles(node, view.edges, mode),
      ariaLabel: `${node.description.name}, ${node.progress.status}, ${node.id}` })),
    edges: view.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, type: 'resource',
      sourceHandle: edge.route.sourceHandle, targetHandle: edge.route.targetHandle, data: { kind: edge.kind, route: edge.route, label: edge.label, connectionStatus: edge.connectionStatus },
      ariaLabel: `${edge.source} ${edge.kind === 'order' ? 'must precede' : 'communicates with'} ${edge.target}${edge.connectionStatus ? `, ${edge.connectionStatus}` : ''}`,
      animated: edge.active, style: { stroke: paint(edge), strokeWidth: edge.kind === 'order' ? 1.7 : 1.1, ...(edge.kind === 'communication' ? { strokeDasharray: '4 5' } : {}) },
      markerEnd: { type: MarkerType.ArrowClosed, color: paint(edge), width: 17, height: 17 } })),
  };
}
