import type { AgentLayerView, AgentPlatformView, AgentStatus, AgentView } from './agent-platform.ts';
import type { DashboardState } from './types.ts';

export type AgentProjectionContext = Pick<DashboardState, 'graph' | 'run' | 'target' | 'application'>;
export function agentContextKey(context: AgentProjectionContext): string {
  return JSON.stringify([context.graph?.digest, context.run?.id, context.run?.status, context.application?.selection ?? context.target?.id,
    context.application?.phase, context.application?.deployment?.promoted]);
}
function bindingMatches(agent: AgentView, context: AgentProjectionContext): boolean {
  const targetId = context.application?.selection?.targetId ?? context.target?.id;
  const graph = context.graph;
  return !!graph && !!targetId && agent.binding?.targetId === targetId && agent.binding.graphDigest === graph.digest
    && agent.resourceIds.length > 0 && agent.resourceIds.every(id => graph.resources.some(resource => resource.id === id));
}
function infrastructure(agent: AgentView, context: AgentProjectionContext): AgentLayerView {
  const base: AgentLayerView = { id: 'infrastructure', label: 'Infrastructure', status: 'pending', resourceIds: [...agent.resourceIds] };
  if (!context.graph || !agent.binding) return base;
  if (!bindingMatches(agent, context)) return { ...base, status: 'unknown', detail: 'Check the selected deployment.' };
  const run = context.run;
  if (!run || run.status === 'idle') return base;
  const selected = run.resources.filter(resource => agent.resourceIds.includes(resource.resourceId ?? resource.id));
  if (new Set(selected.map(resource => resource.resourceId ?? resource.id)).size !== agent.resourceIds.length) return { ...base, status: 'unknown' };
  const snapshot = run.recording?.snapshot as { runId?: string; commitLog?: unknown[] } | undefined;
  const proof = run.recording?.provenance;
  const recorded = proof?.runId === run.id && proof.graphDigest === context.graph.digest && proof.stack === context.graph.name
    && typeof snapshot?.runId === 'string' && snapshot.runId.length > 0 && !!snapshot.commitLog?.length;
  const chart = run.chart?.runId === run.id && run.chart.graphDigest === context.graph.digest;
  const recording = recorded ? { id: 'deployment-' + run.id, kind: 'deployment' as const, runId: run.id, source: 'native' as const, complete: run.status !== 'running' } : undefined;
  if (selected.some(resource => resource.status === 'failed') || run.status === 'failed') return { ...base, status: 'failed', ...(recording && { recording }) };
  if (run.status === 'passed' && selected.every(resource => resource.status === 'ready')) return recorded
    ? { ...base, status: 'ready', recording } : { ...base, status: 'incomplete', detail: 'Native deployment recording is unavailable.' };
  if (run.status === 'running' && (recorded || chart)) return { ...base, status: 'running', ...(recording && { recording }) };
  return { ...base, status: 'unknown', ...(recording && { recording }) };
}
function combined(layers: readonly AgentLayerView[]): AgentStatus {
  for (const status of ['incomplete', 'failed', 'running', 'paused', 'unsupported', 'unknown', 'pending'] as const) if (layers.some(layer => layer.status === status)) return status;
  return layers.every(layer => layer.status === 'ready') ? 'ready' : 'unknown';
}
/** Infrastructure progress is projected from the current native run, never from an agent's display claim. */
export function projectAgentPlatformView(view: AgentPlatformView, context: AgentProjectionContext): AgentPlatformView {
  return { ...view, agents: view.agents.map(agent => {
    const deployment = infrastructure(agent, context), matched = bindingMatches(agent, context);
    const layers = [deployment, ...agent.layers.slice(1).map(layer => !matched && layer.status !== 'pending'
      ? { ...layer, status: 'unknown' as const, detail: 'Check the selected deployment.', recording: undefined, stages: undefined } : layer)];
    const canCheck = matched && deployment.status === 'ready' && context.application?.phase === 'ready'
      && context.application.deployment?.promoted === true && !context.application.busy && agent.canCheck;
    return { ...agent, layers, status: combined(layers), canCheck,
      capabilities: matched ? agent.capabilities : agent.capabilities.map(capability => ({ ...capability, status: 'unknown' as const, proofRef: undefined })),
      conversations: matched ? agent.conversations : [],
    };
  }) };
}
