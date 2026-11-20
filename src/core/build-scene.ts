import { projectSystemBlocks } from './capabilities.ts';
import { connectionProgress } from './connections.ts';
import { projectDeploymentFlow, type DeploymentFlowEdge } from './deployment-flow.ts';
import { buildSceneLabel, buildScenePurpose, capabilityKind, type BuildSceneKind } from './build-scene-labels.ts';
import type { ConnectionStatus, DashboardState, ResourceStatus } from './types.ts';

export type { BuildSceneKind } from './build-scene-labels.ts';
export type BuildScenePhase = 'idle' | 'starting' | 'building' | 'checking' | 'ready' | 'failed' | 'incomplete';
export interface BuildSceneEmbedded { id: string; title: string; kind: BuildSceneKind; status: ResourceStatus }
export interface BuildSceneNode {
  id: string; title: string; kind: BuildSceneKind; status: ResourceStatus; action?: string; step?: number;
  column: number; row: number; embedded: BuildSceneEmbedded[];
  /** A provider snapshot exists, but the corresponding native start/finish was not captured. */
  uncertain: boolean;
}
export interface BuildSceneEdge { id: string; from: string; to: string; status: ConnectionStatus }
export interface BuildSceneFlowEdge { id: string; from: string; to: string; kind: DeploymentFlowEdge['kind']; wait?: DeploymentFlowEdge['wait']; label?: string }
export interface BuildScene {
  phase: BuildScenePhase; headline: string; subline?: string; simulation: boolean;
  nodes: BuildSceneNode[]; edges: BuildSceneEdge[]; flowEdges: BuildSceneFlowEdge[]; counts: { ready: number; total: number };
  /** Only native starts can animate a construction step. */
  activeIds: string[]; warnings: string[];
}

/** A small visual vocabulary over native FootPrint evidence. No timers, scheduler or provider calls. */
export function projectBuildScene(state: DashboardState): BuildScene {
  const flow = projectDeploymentFlow(state), warnings = [...flow.warnings];
  if (state.connections?.report?.captureError) warnings.push('The connection recording is incomplete; measured outcomes are retained.');
  if (state.identity?.report?.captureError) warnings.push('The access recording is incomplete; measured outcomes are retained.');
  const nodes: BuildSceneNode[] = flow.nodes.map(node => {
    const purpose = buildScenePurpose(node), status = node.progress.status;
    const uncertain = node.progress.action !== 'find' && status !== 'pending' && status !== 'skipped'
      && (!node.observed || (status !== 'deploying' && node.observed.endSequence === undefined));
    if (status === 'deploying' && !node.observed) warnings.push(`No start event was captured for ${node.id}; its live progress is unknown.`);
    const embedded = node.capabilities.filter(item => item.mode === 'embedded').map(item => ({
      id: `${item.blockId}:${item.unitId}`, title: buildSceneLabel(item.label, capabilityKind(item)), kind: capabilityKind(item), status,
    })).filter(item => item.title !== purpose.title || item.kind !== purpose.kind);
    return { id: node.id, ...purpose, status, ...(node.progress.action && { action: node.progress.action }),
      ...(node.observed && { step: node.observed.step }), column: node.column, row: node.row, embedded, uncertain };
  });
  for (const block of projectSystemBlocks(state)) for (const unit of block.units) {
    if (unit.status === 'unmapped') warnings.push(`The ${unit.label} capability has no complete resource mapping.`);
  }
  const ids = new Set(nodes.map(node => node.id));
  const edges: BuildSceneEdge[] = (state.graph?.relations ?? []).flatMap((relation, index) => {
    if (relation.kind !== 'communicatesWith') return [];
    if (!ids.has(relation.from) || !ids.has(relation.to)) {
      warnings.push('A communication relationship refers to a resource missing from this graph.');
      return [];
    }
    const id = `communication:${index}`;
    return [{ id, from: relation.from, to: relation.to, status: connectionProgress(state, id, relation.from, relation.to).status }];
  });
  const scene: BuildScene = { phase: 'idle', headline: 'Ready to build', simulation: (state.mode ?? state.run?.mode) === 'simulator',
    nodes, edges, flowEdges: flow.edges.map(edge => ({ id: edge.id, from: edge.source, to: edge.target, kind: edge.kind,
      ...(edge.wait && { wait: edge.wait, label: edge.label }) })),
    counts: { ready: nodes.filter(node => node.status === 'ready').length, total: nodes.length },
    activeIds: nodes.filter(node => node.status === 'deploying' && !node.uncertain).map(node => node.id), warnings: [...new Set(warnings)] };
  return { ...scene, ...sceneMessage(state, scene) };
}

function sceneMessage(state: DashboardState, scene: BuildScene): Pick<BuildScene, 'phase' | 'headline' | 'subline'> {
  if (!scene.nodes.length) return { phase: 'idle', headline: state.graph ? 'Nothing to build' : 'Ready to build' };
  if (scene.nodes.some(node => node.status === 'failed') || state.run?.status === 'failed' || ['failed', 'incomplete'].includes(state.resourceFlow?.status ?? '')) return { phase: 'failed', headline: 'Build stopped' };
  if (scene.edges.some(edge => edge.status === 'failed') || state.connections?.status === 'failed') return { phase: 'failed', headline: 'Connection failed' };
  if (state.identity?.status === 'failed' || state.identity?.checks.some(check => check.status === 'failed')) return { phase: 'failed', headline: 'Access check failed' };
  if (scene.warnings.length || (state.run?.status === 'passed' && scene.counts.ready !== scene.counts.total)) {
    return { phase: 'incomplete', headline: 'Some progress is missing', subline: 'Open Details to see what is known' };
  }
  const active = scene.nodes.filter(node => scene.activeIds.includes(node.id));
  if (active.length) {
    const verifying = active.every(node => /^(?:noop|no-op|verify|check|read|observe)$/i.test(node.action ?? ''));
    const updating = active.every(node => node.action === 'update');
    return { phase: 'building', headline: active.length === 1
      ? `${verifying ? 'Checking' : updating ? 'Updating' : 'Building'} ${active[0]!.title}` : verifying ? 'Checking together' : updating ? 'Updating together' : 'Building together' };
  }
  if (scene.edges.some(edge => edge.status === 'checking') || state.connections?.status === 'checking') return { phase: 'checking', headline: 'Connecting' };
  if (state.identity?.status === 'checking' || state.identity?.checks.some(check => check.status === 'checking')) return { phase: 'checking', headline: 'Checking access' };
  if (state.resourceFlow?.status === 'paused') return { phase: 'idle', headline: 'Choose a connection', subline: 'Your existing resources are retained' };
  if (state.resourceFlow?.status === 'running') return { phase: scene.counts.ready ? 'building' : 'starting', headline: scene.counts.ready ? 'Connecting your system' : 'Running your code' };
  if (state.run?.status === 'running') return { phase: scene.counts.ready ? 'building' : 'starting',
    headline: scene.counts.ready ? 'Building your system' : 'Running your code' };
  if (state.run?.status === 'passed' && scene.counts.ready === scene.counts.total) {
    const connectionsPending = scene.edges.some(edge => edge.status === 'untested');
    const accessPending = state.identity?.checks.some(check => check.status === 'untested')
      || (state.identity !== undefined && state.identity.status === 'idle');
    return { phase: 'ready', headline: connectionsPending || accessPending ? 'System built' : 'Ready',
      ...(connectionsPending ? { subline: 'Check connections' } : accessPending ? { subline: 'Check access' } : {}) };
  }
  return { phase: 'idle', headline: 'Ready to build' };
}
