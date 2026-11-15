import type { AgentComponentBoundaryView, AgentComponentGraphView, AgentComponentNodeView, AgentComponentProgress, AgentComponentRelationView, AgentComponentStatus } from './agent-components.ts';
import { fail, row, text, id, hex, list, unique, flag, status } from './agent-read-data.ts';
import { readAgentRecordingRef, readAgentStageView } from './agent-evidence-read.ts';

function componentStatus(input: unknown): AgentComponentStatus { return input === 'skipped' ? 'skipped' : status(input); }
function progress(input: unknown): AgentComponentProgress {
  const value = row(input, ['completed', 'total', 'indeterminate', 'unit']);
  if (!['stages', 'components'].includes(value.unit) || !Number.isSafeInteger(value.completed) || value.completed < 0 || value.completed > 65536) fail();
  const indeterminate = flag(value.indeterminate);
  if (value.total === undefined ? !indeterminate : !Number.isSafeInteger(value.total) || value.total < value.completed || value.total > 65536) fail();
  return { completed: value.completed, ...(value.total === undefined ? {} : { total: value.total }), indeterminate, unit: value.unit };
}
function node(input: unknown, budget: { stages: number }): AgentComponentNodeView {
  const value = row(input, ['id', 'label', 'kind', 'roles', 'status', 'required', 'selected', 'boundaryId', 'storage', 'sharing', 'physicalBindingId', 'progress', 'stages', 'recording']);
  if (!['execution', 'store', 'context', 'connection'].includes(value.kind) || value.storage !== undefined && !['memory', 'persistent'].includes(value.storage)
    || value.sharing !== undefined && !['shared', 'dedicated'].includes(value.sharing)) fail();
  if (value.stages !== undefined && (!Array.isArray(value.stages) || (budget.stages += value.stages.length) > 8192)) fail();
  const roles = list(value.roles, 16, id); if (!roles.length || new Set(roles).size !== roles.length) fail();
  const result: AgentComponentNodeView = { id: id(value.id), label: text(value.label, 160), kind: value.kind, roles,
    status: componentStatus(value.status), required: flag(value.required), selected: flag(value.selected), progress: progress(value.progress),
    ...(value.boundaryId === undefined ? {} : { boundaryId: id(value.boundaryId) }), ...(value.storage === undefined ? {} : { storage: value.storage }),
    ...(value.sharing === undefined ? {} : { sharing: value.sharing }), ...(value.physicalBindingId === undefined ? {} : { physicalBindingId: id(value.physicalBindingId) }),
    ...(value.stages === undefined ? {} : { stages: unique(list(value.stages, 1024, readAgentStageView)) }),
    ...(value.recording === undefined ? {} : { recording: readAgentRecordingRef(value.recording, 'readiness') }) };
  if (!result.selected && !['skipped', 'pending', 'unknown'].includes(result.status)) fail();
  if (result.progress.unit === 'stages' && result.stages && (result.progress.total !== undefined && result.progress.total !== result.stages.length || result.progress.completed !== result.stages.filter(stage => stage.status === 'ready').length)) fail();
  if (result.progress.unit === 'stages' && !result.stages && (result.progress.completed !== 0 || !['pending', 'running', 'unknown', 'skipped', 'incomplete'].includes(result.status))) fail();
  if (result.progress.unit === 'components' && (result.progress.total !== 1 || result.progress.completed !== Number(result.status === 'ready'))) fail();
  if (result.status === 'ready' && (!result.selected || !result.recording?.complete || result.progress.indeterminate || !result.progress.total || result.progress.completed !== result.progress.total)) fail();
  if (result.status === 'pending' && result.progress.completed !== 0) fail();
  return result;
}
function boundary(input: unknown): AgentComponentBoundaryView {
  const value = row(input, ['id', 'label', 'kind', 'parentId', 'identityComponentId', 'strategy', 'status', 'observed', 'progress', 'recording']);
  if (!['platform', 'host', 'namespace', 'pod', 'container', 'service', 'shared', 'isolation'].includes(value.kind)) fail();
  const strategy = value.strategy === undefined ? undefined : row(value.strategy, ['id', 'label']);
  const result: AgentComponentBoundaryView = { id: id(value.id), label: text(value.label, 160), kind: value.kind, status: componentStatus(value.status),
    observed: flag(value.observed), progress: progress(value.progress), ...(value.identityComponentId === undefined ? {} : { identityComponentId: id(value.identityComponentId) }), ...(value.parentId === undefined ? {} : { parentId: id(value.parentId) }),
    ...(strategy ? { strategy: { id: id(strategy.id), label: text(strategy.label, 120) } } : {}),
    ...(value.recording === undefined ? {} : { recording: readAgentRecordingRef(value.recording, 'readiness') }) };
  if (result.observed && !result.recording?.complete || result.status === 'ready' && !result.observed) fail();
  return result;
}
function relation(input: unknown): AgentComponentRelationView {
  const value = row(input, ['id', 'from', 'to', 'kind', 'required', 'checkComponentId', 'status']);
  if (!['order', 'communicatesWith', 'supports', 'contains'].includes(value.kind) || value.status !== undefined && !['untested', 'checking', 'connected', 'failed'].includes(value.status)) fail();
  return { id: id(value.id), from: id(value.from), to: id(value.to), kind: value.kind,
    ...(value.required === undefined ? {} : { required: flag(value.required) }), ...(value.checkComponentId === undefined ? {} : { checkComponentId: id(value.checkComponentId) }),
    ...(value.status === undefined ? {} : { status: value.status }) };
}
function validateHierarchy(view: AgentComponentGraphView): void {
  const nodes = new Map(view.nodes.map(node => [node.id, node])), boundaries = new Map(view.boundaries.map(boundary => [boundary.id, boundary]));
  if ([...nodes.keys()].some(id => boundaries.has(id))) fail();
  for (const item of view.boundaries) {
    const seen = new Set([item.id]); let parent = item.parentId;
    while (parent) { if (!boundaries.has(parent) || seen.has(parent) || seen.size > 16) fail(); seen.add(parent); parent = boundaries.get(parent)!.parentId; }
  }
  for (const item of view.nodes) if (item.boundaryId && !boundaries.has(item.boundaryId)) fail();
  const inBoundary = (node: AgentComponentNodeView, boundaryId: string) => {
    let at = node.boundaryId; while (at) { if (at === boundaryId) return true; at = boundaries.get(at)!.parentId; } return false;
  };
  for (const item of view.boundaries) {
    if (item.observed) {
      const proof = item.identityComponentId ? nodes.get(item.identityComponentId)?.recording : undefined;
      if (!proof?.complete || !item.recording?.complete || proof.id !== item.recording.id || proof.runId !== item.recording.runId
        || proof.kind !== item.recording.kind || proof.source !== item.recording.source) fail();
    }
    const descendants = new Set(view.nodes.filter(node => inBoundary(node, item.id)).map(node => node.id));
    const boundaryIds = new Set(view.boundaries.filter(boundary => { let at: string | undefined = boundary.id; while (at) { if (at === item.id) return true; at = boundaries.get(at)?.parentId; } return false; }).map(boundary => boundary.id));
    const work = new Set(descendants);
    for (const relation of view.relations) if (relation.kind === 'communicatesWith' && relation.required && relation.checkComponentId && (descendants.has(relation.from) || descendants.has(relation.to) || boundaryIds.has(relation.from) || boundaryIds.has(relation.to))) work.add(relation.checkComponentId);
    if (item.identityComponentId) { if (!nodes.has(item.identityComponentId)) fail(); work.add(item.identityComponentId); }
    const members = view.nodes.filter(node => node.selected && node.required && work.has(node.id));
    const completed = item.progress.unit === 'components' ? members.filter(node => node.status === 'ready').length : members.reduce((sum, node) => sum + node.progress.completed, 0);
    const unknown = item.progress.unit === 'stages' && (!members.length || members.some(node => node.progress.indeterminate || node.progress.unit !== 'stages'));
    const total = item.progress.unit === 'components' ? members.length : members.reduce((sum, node) => sum + (node.progress.total ?? 0), 0);
    if (item.progress.completed !== completed || item.progress.indeterminate !== unknown || !unknown && item.progress.total !== total) fail();
    if (item.status === 'ready' && (members.some(node => node.status !== 'ready') || unknown || completed !== total)) fail();
  }
  const orders = new Map<string, string[]>();
  for (const edge of view.relations) {
    if (!nodes.has(edge.from) && !boundaries.has(edge.from) || !nodes.has(edge.to) && !boundaries.has(edge.to)) fail();
    if (edge.kind === 'contains') {
      if (!boundaries.has(edge.from) || (nodes.get(edge.to)?.boundaryId ?? boundaries.get(edge.to)?.parentId) !== edge.from) fail();
    }
    if (edge.kind === 'order') {
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) fail();
      orders.set(edge.from, [...orders.get(edge.from) ?? [], edge.to]);
    }
    if (edge.checkComponentId) {
      const check = nodes.get(edge.checkComponentId); if (!check || check.kind !== 'connection') fail();
      if (edge.status === 'connected' && (!check.recording?.complete || check.status !== 'ready')) fail();
    }
    if (edge.kind === 'communicatesWith' && (edge.required || edge.status === 'connected') && !edge.checkComponentId) fail();
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (key: string) => { if (visiting.has(key)) fail(); if (visited.has(key)) return; visiting.add(key); for (const next of orders.get(key) ?? []) visit(next); visiting.delete(key); visited.add(key); };
  for (const key of orders.keys()) visit(key);
}
export function readAgentComponentGraphView(input: unknown): AgentComponentGraphView {
  const value = row(input, ['version', 'id', 'label', 'digest', 'binding', 'nodes', 'boundaries', 'relations', 'recording', 'limitations']);
  if (value.version !== 1) fail(); const binding = row(value.binding, ['graphDigest', 'deploymentDigest', 'revisionDigest', 'targetId']), budget = { stages: 0 };
  const result: AgentComponentGraphView = { version: 1, id: id(value.id), label: text(value.label, 160), digest: hex(value.digest),
    binding: { graphDigest: hex(binding.graphDigest), deploymentDigest: hex(binding.deploymentDigest), revisionDigest: hex(binding.revisionDigest), targetId: id(binding.targetId) },
    nodes: unique(list(value.nodes, 128, input => node(input, budget))), boundaries: unique(list(value.boundaries, 64, boundary)), relations: unique(list(value.relations, 512, relation)),
    limitations: list(value.limitations, 32, input => text(input, 1000)), ...(value.recording === undefined ? {} : { recording: readAgentRecordingRef(value.recording, 'readiness') }) };
  validateHierarchy(result); return result;
}
