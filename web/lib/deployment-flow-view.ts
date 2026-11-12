import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';
import { projectDeploymentFlow, type DeploymentFlowNode } from '../../src/core/deployment-flow.ts';
import type { DashboardState } from '../../src/core/types.ts';

export const STEP_WIDTH = 184;
export const STEP_HEIGHT = 212;
export interface DeploymentStepData extends Record<string, unknown> {
  step: DeploymentFlowNode;
  title: string;
  waiting: string;
  columnLabel?: string;
}
export type DeploymentStepNode = Node<DeploymentStepData, 'deployment-step'>;

/** Human purpose stays separate from the provider's technical resource name. */
export function deploymentStepTitle(node: DeploymentFlowNode): string {
  const role = node.resource.spec.role;
  if (role === 'directory') return 'Identity directory';
  if (role === 'provider') return 'Sign-in provider';
  const kind = node.description.kind;
  const single = node.capabilities.find(unit => unit.resourceIds.length === 1 && unit.mode !== 'embedded');
  if (kind === 'Deployment') return 'Application runtime';
  if (kind === 'Namespace') return 'Application space';
  if (kind === 'Service') return 'Application endpoint';
  if (kind === 'ConfigMap') return node.capabilities.some(unit => unit.family === 'identity') ? 'Permission policy' : 'Configuration';
  return single?.label ?? node.description.capability ?? node.description.name;
}

export function buildDeploymentFlowView(state: DashboardState, selected?: string, prerequisites = false) {
  const flow = projectDeploymentFlow(state);
  const titles = new Map(flow.nodes.map(node => [node.id, deploymentStepTitle(node)]));
  const maxRows = Math.max(1, ...flow.columns.map(column => column.resourceIds.length));
  const nodes: DeploymentStepNode[] = [...flow.nodes].sort((a, b) => a.column - b.column || a.row - b.row).map(step => ({
    id: step.id, type: 'deployment-step', selected: selected === step.id,
    position: { x: step.column * (STEP_WIDTH + 58), y: step.row * (STEP_HEIGHT + 58) + (maxRows - (flow.columns.find(column => column.index === step.column)?.resourceIds.length ?? 1)) * (STEP_HEIGHT + 58) / 2 },
    data: { step, title: titles.get(step.id)!, waiting: step.waitingFor.map(id => titles.get(id) ?? id).join(', '),
      ...(step.row === 0 && (flow.columns.find(column => column.index === step.column)?.resourceIds.length ?? 0) > 1
        ? { columnLabel: flow.columns.find(column => column.index === step.column)!.label } : {}) },
    style: { width: STEP_WIDTH, height: STEP_HEIGHT },
    width: STEP_WIDTH, height: STEP_HEIGHT,
    // Controlled snapshots must retain ports before the browser measures a node.
    handles: [
      { type: 'target', position: Position.Left, x: -4, y: STEP_HEIGHT / 2 - 4, width: 8, height: 8 },
      { type: 'source', position: Position.Right, x: STEP_WIDTH - 4, y: STEP_HEIGHT / 2 - 4, width: 8, height: 8 },
    ],
    ariaLabel: `${step.progress.action === 'find' && step.progress.status === 'ready' ? 'Found by read-only lookup' : step.observed ? `Recorded step ${step.observed.step}` : 'Not started'}: ${titles.get(step.id)}, ${step.progress.status}`,
  }));
  const nodeById = new Map(flow.nodes.map(node => [node.id, node]));
  const observedPairs = new Set(flow.edges.filter(edge => edge.kind === 'observed-order').map(edge => JSON.stringify([edge.source, edge.target])));
  const nativePairs = new Set(flow.edges.filter(edge => edge.kind === 'native-schedule').map(edge => JSON.stringify([edge.source, edge.target])));
  const dependencyPairs = new Set(flow.edges.filter(edge => edge.kind === 'dependency').map(edge => JSON.stringify([edge.source, edge.target])));
  const edges: Edge[] = flow.edges.filter(edge => edge.kind === 'observed-order'
    || (edge.kind === 'native-schedule' && !observedPairs.has(JSON.stringify([edge.source, edge.target])))
    || (edge.kind === 'dependency' && !observedPairs.has(JSON.stringify([edge.source, edge.target])) && !nativePairs.has(JSON.stringify([edge.source, edge.target]))
      && (prerequisites || flow.layoutSource === 'prerequisites'
        || (flow.layoutSource === 'native-events' && !nodeById.get(edge.target)?.observed)))).map(edge => {
    const observed = edge.kind === 'observed-order';
    const scheduled = edge.kind === 'native-schedule';
    const target = nodeById.get(edge.target)!;
    const color = target.progress.status === 'failed' ? '#be6266' : target.progress.status === 'deploying' ? '#4382d7'
      : observed && target.progress.status === 'ready' ? '#559980' : '#a6b3c5';
    return { id: edge.id, source: edge.source, target: edge.target, type: 'smoothstep',
      label: observed ? prerequisites && dependencyPairs.has(JSON.stringify([edge.source, edge.target])) ? 'then · needs' : 'then' : scheduled ? 'next' : 'needs',
      ariaLabel: `${titles.get(edge.source)} ${observed ? 'finished before' : scheduled ? 'is scheduled before' : 'is required by'} ${titles.get(edge.target)}${observed && prerequisites && dependencyPairs.has(JSON.stringify([edge.source, edge.target])) ? '; also a prerequisite' : ''}`,
      animated: target.progress.status === 'deploying',
      style: { stroke: color, strokeWidth: observed ? 2.2 : 1.5, ...(!observed ? { strokeDasharray: scheduled ? '3 4' : '7 5' } : {}) },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 15, height: 15 },
      labelStyle: { fill: '#718198', fontSize: 11 }, labelBgStyle: { fill: '#f8fafc' }, labelBgPadding: [6, 3] as [number, number],
    };
  });
  return { flow, nodes, edges };
}
