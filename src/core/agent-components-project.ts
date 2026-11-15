import type { AgentComponentGraphView, AgentComponentStatus } from './agent-components.ts';
import type { AgentStatus } from './agent-platform.ts';
const unfinished: readonly AgentComponentStatus[] = ['incomplete', 'running', 'paused', 'unknown'];
/** Selected unfinished invocations block another effect even when their feature is optional. */
export function agentComponentInvocationUnsettled(view: AgentComponentGraphView): boolean {
  return view.nodes.some(node => node.selected && unfinished.includes(node.status)) || agentComponentParentUnconfirmed(view);
}
/** Initial pending declarations have no parent capture yet; retained work needs its coordinator proof. */
export function agentComponentParentUnconfirmed(view: AgentComponentGraphView): boolean {
  if (view.recording?.complete) return false;
  return !!view.recording || view.nodes.some(node => node.selected && (!!node.recording || node.progress.completed > 0
    || ['ready', 'failed', 'running', 'paused', 'incomplete', 'unknown'].includes(node.status) || node.stages?.some(stage => stage.status !== 'pending')));
}
const priority: readonly AgentComponentStatus[] = ['incomplete', 'failed', 'running', 'paused', 'unsupported', 'unknown', 'pending'];
/** Required selected work and measured boundaries determine readiness, never a display clock. */
export function agentComponentGraphStatus(view: AgentComponentGraphView): AgentStatus {
  const nodes = view.nodes.filter(node => node.required && node.selected);
  if (!nodes.length) return 'unknown';
  for (const candidate of unfinished) if (view.nodes.some(node => node.selected && node.status === candidate)) return candidate as AgentStatus;
  if (agentComponentParentUnconfirmed(view)) return 'incomplete';
  const boundaries = new Map(view.boundaries.map(boundary => [boundary.id, boundary]));
  const requiredBoundaries = new Set<string>();
  for (const node of nodes) { let at = node.boundaryId; const seen = new Set<string>();
    while (at && !seen.has(at)) { seen.add(at); requiredBoundaries.add(at); at = boundaries.get(at)?.parentId; }
  }
  const values: AgentComponentStatus[] = [...nodes.map(node => node.status), ...view.boundaries.filter(item => requiredBoundaries.has(item.id)).map(item => item.status),
    ...view.relations.filter(edge => edge.required && edge.kind === 'communicatesWith').map(edge => edge.status === 'connected' ? 'ready' as const : edge.status === 'checking' ? 'running' as const : edge.status === 'failed' ? 'failed' as const : 'pending' as const)];
  for (const candidate of priority) if (values.includes(candidate)) return candidate as AgentStatus;
  return values.every(value => value === 'ready') && view.recording?.complete ? 'ready' : 'incomplete';
}
