import type { AgentCapabilityView, AgentConversationView, AgentLayerView, AgentPlatformAction, AgentPlatformView, AgentRecordingRef, AgentStageView, AgentStatus, AgentTurnView, AgentView } from './agent-platform.ts';

const statuses = new Set<AgentStatus>(['pending', 'running', 'ready', 'failed', 'paused', 'incomplete', 'unknown', 'unsupported']);
function fail(): never { throw Error('Invalid agent platform observation'); }
function row(input: unknown, keys: readonly string[]): Record<string, any> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.getOwnPropertySymbols(input).length) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.entries(descriptors).some(([key, value]) => !keys.includes(key) || !value.enumerable || !('value' in value))) fail();
  return input as Record<string, any>;
}
function text(input: unknown, max = 256): string {
  if (typeof input !== 'string' || !input.trim() || input.length > max || /[\x00-\x1f\x7f]/.test(input)) fail(); return input;
}
function id(input: unknown): string { const value = text(input); if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) fail(); return value; }
function hex(input: unknown): string { const value = text(input, 64); if (!/^[a-f0-9]{64}$/.test(value)) fail(); return value; }
function list<T>(input: unknown, max: number, read: (input: unknown) => T): T[] { if (!Array.isArray(input) || input.length > max) fail(); return input.map(read); }
function unique<T extends { id: string }>(values: T[]): T[] { if (new Set(values.map(value => value.id)).size !== values.length) fail(); return values; }
function ids(input: unknown): string[] { const values = list(input, 4096, id); if (new Set(values).size !== values.length) fail(); return values; }
function status(input: unknown): AgentStatus { if (!statuses.has(input as AgentStatus)) fail(); return input as AgentStatus; }
function flag(input: unknown): boolean { if (typeof input !== 'boolean') fail(); return input; }
const optionalText = (value: unknown, key: string, max = 256) => value === undefined ? {} : { [key]: text(value, max) };
function recording(input: unknown, kind?: AgentRecordingRef['kind']): AgentRecordingRef {
  const value = row(input, ['id', 'kind', 'runId', 'complete', 'source']);
  if (!['deployment', 'readiness', 'turn'].includes(value.kind) || kind && value.kind !== kind || value.source !== 'native') fail();
  return { id: id(value.id), kind: value.kind, runId: text(value.runId, 512), complete: flag(value.complete), source: 'native' };
}
interface ReadBudget { stages: number; turns: number; conversations: number }
function stageList(input: unknown, budget: ReadBudget): AgentStageView[] {
  if (!Array.isArray(input) || (budget.stages += input.length) > 16384) fail();
  return unique(list(input, 4096, stage));
}
function layer(input: unknown, budget: ReadBudget): AgentLayerView {
  const value = row(input, ['id', 'label', 'status', 'detail', 'resourceIds', 'recording', 'stages']);
  if (!['infrastructure', 'environment', 'agent'].includes(value.id)) fail();
  const result: AgentLayerView = { id: value.id, label: text(value.label, 120), status: status(value.status), ...optionalText(value.detail, 'detail', 1000),
    ...(value.resourceIds === undefined ? {} : { resourceIds: ids(value.resourceIds) }), ...(value.recording === undefined ? {} : { recording: recording(value.recording) }),
    ...(value.stages === undefined ? {} : { stages: stageList(value.stages, budget) }) };
  if (result.id === 'agent' && result.status === 'ready' && (!result.recording?.complete || result.recording.kind !== 'readiness')) fail();
  return result;
}
function capability(input: unknown): AgentCapabilityView {
  const value = row(input, ['id', 'label', 'status', 'proofRef']);
  if (!['supported', 'unsupported', 'unknown'].includes(value.status)) fail();
  const result: AgentCapabilityView = { id: id(value.id), label: text(value.label, 160), status: value.status,
    ...(value.proofRef === undefined ? {} : { proofRef: recording(value.proofRef) }) };
  if (result.status === 'supported' && !result.proofRef?.complete) fail(); return result;
}
function stage(input: unknown): AgentStageView {
  const value = row(input, ['id', 'label', 'status', 'runtimeStageId', 'kind', 'sequence']);
  if (value.kind !== undefined && !['stage', 'decision', 'tool', 'model'].includes(value.kind)) fail();
  if (value.sequence !== undefined && (!Number.isSafeInteger(value.sequence) || value.sequence < 1)) fail();
  return { id: id(value.id), label: text(value.label, 160), status: status(value.status), ...optionalText(value.runtimeStageId, 'runtimeStageId', 512),
    ...(value.kind === undefined ? {} : { kind: value.kind }), ...(value.sequence === undefined ? {} : { sequence: value.sequence }) };
}
function turn(input: unknown, budget: ReadBudget): AgentTurnView {
  const value = row(input, ['id', 'label', 'status', 'recording', 'stages']);
  const result: AgentTurnView = { id: id(value.id), ...optionalText(value.label, 'label', 160), status: status(value.status),
    stages: stageList(value.stages, budget), ...(value.recording === undefined ? {} : { recording: recording(value.recording, 'turn') }) };
  if (result.status === 'ready' && !result.recording?.complete) fail(); return result;
}
function conversation(input: unknown, budget: ReadBudget): AgentConversationView {
  const value = row(input, ['id', 'label', 'revisionId', 'status', 'turns']);
  if (!Array.isArray(value.turns) || (budget.turns += value.turns.length) > 1024) fail();
  return { id: id(value.id), ...optionalText(value.label, 'label', 160), ...(value.revisionId === undefined ? {} : { revisionId: hex(value.revisionId) }),
    status: status(value.status), turns: unique(list(value.turns, 256, input => turn(input, budget))) };
}
function agent(input: unknown, budget: ReadBudget): AgentView {
  const value = row(input, ['id', 'label', 'description', 'revisionId', 'revisionLabel', 'binding', 'status', 'resourceIds', 'layers', 'capabilities', 'conversations', 'limitations', 'canCheck']);
  if (!Array.isArray(value.conversations) || (budget.conversations += value.conversations.length) > 1024) fail();
  const layers = list(value.layers, 3, input => layer(input, budget));
  if (layers.length !== 3 || layers.some((layer, index) => layer.id !== ['infrastructure', 'environment', 'agent'][index])) fail();
  const resources = ids(value.resourceIds);
  if (layers.some(layer => layer.resourceIds?.some(resource => !resources.includes(resource)))) fail();
  const binding = value.binding === undefined ? undefined : row(value.binding, ['graphDigest', 'targetId']);
  const result: AgentView = { id: id(value.id), label: text(value.label, 160), ...optionalText(value.description, 'description', 1000),
    ...(value.revisionId === undefined ? {} : { revisionId: hex(value.revisionId) }), ...optionalText(value.revisionLabel, 'revisionLabel', 160),
    ...(binding ? { binding: { graphDigest: hex(binding.graphDigest), targetId: id(binding.targetId) } } : {}),
    status: status(value.status), resourceIds: resources, layers, capabilities: unique(list(value.capabilities, 64, capability)),
    conversations: unique(list(value.conversations, 256, input => conversation(input, budget))), limitations: list(value.limitations, 32, input => text(input, 1000)), canCheck: flag(value.canCheck) };
  if (layers[2]!.status === 'ready' && (!result.binding || !result.revisionId || resources.length === 0)) fail();
  return result;
}
export function readAgentPlatformView(input: unknown): AgentPlatformView {
  const value = row(input, ['version', 'id', 'label', 'busy', 'agents', 'limitations', 'error']);
  if (value.version !== 1) fail();
  const budget: ReadBudget = { stages: 0, turns: 0, conversations: 0 };
  const agents = unique(list(value.agents, 128, input => agent(input, budget)));
  return { version: 1, id: id(value.id), label: text(value.label, 160), busy: flag(value.busy), agents,
    limitations: list(value.limitations, 32, input => text(input, 1000)), ...optionalText(value.error, 'error', 1000) };
}
export function readAgentPlatformAction(input: unknown): AgentPlatformAction {
  const value = row(input, ['action', 'agentId']);
  if (value.action === 'open' || value.action === 'refresh') { if (value.agentId !== undefined) fail(); return { action: value.action }; }
  if (value.action !== 'check') fail(); return { action: 'check', agentId: id(value.agentId) };
}
