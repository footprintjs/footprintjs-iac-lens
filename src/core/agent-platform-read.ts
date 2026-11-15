import type { AgentCapabilityView, AgentConversationView, AgentLayerView, AgentPlatformAction, AgentPlatformView, AgentRecordingRef, AgentStageView, AgentStatus, AgentTurnView, AgentView } from './agent-platform.ts';

import { fail, row, text, id, hex, list, unique, flag, status, optionalText } from './agent-read-data.ts';
import { readAgentRecordingRef as recording, readAgentStageView as stage } from './agent-evidence-read.ts';
import { readAgentComponentGraphView } from './agent-components-read.ts';
function ids(input: unknown): string[] { const values = list(input, 4096, id); if (new Set(values).size !== values.length) fail(); return values; }
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
  const value = row(input, ['id', 'label', 'description', 'revisionId', 'revisionLabel', 'binding', 'status', 'resourceIds', 'layers', 'capabilities', 'conversations', 'limitations', 'canCheck', 'components']);
  if (!Array.isArray(value.conversations) || (budget.conversations += value.conversations.length) > 1024) fail();
  const layers = list(value.layers, 3, input => layer(input, budget));
  if (layers.length !== 3 || layers.some((layer, index) => layer.id !== ['infrastructure', 'environment', 'agent'][index])) fail();
  const resources = ids(value.resourceIds);
  if (layers.some(layer => layer.resourceIds?.some(resource => !resources.includes(resource)))) fail();
  const binding = value.binding === undefined ? undefined : row(value.binding, ['graphDigest', 'targetId', 'sourceDigest']);
  const result: AgentView = { id: id(value.id), label: text(value.label, 160), ...optionalText(value.description, 'description', 1000),
    ...(value.revisionId === undefined ? {} : { revisionId: hex(value.revisionId) }), ...optionalText(value.revisionLabel, 'revisionLabel', 160),
    ...(binding ? { binding: { graphDigest: hex(binding.graphDigest), targetId: id(binding.targetId), ...(binding.sourceDigest !== undefined ? { sourceDigest: hex(binding.sourceDigest) } : {}) } } : {}),
    status: status(value.status), resourceIds: resources, layers, capabilities: unique(list(value.capabilities, 64, capability)),
    conversations: unique(list(value.conversations, 256, input => conversation(input, budget))), limitations: list(value.limitations, 32, input => text(input, 1000)), canCheck: flag(value.canCheck),
    ...(value.components === undefined ? {} : { components: readAgentComponentGraphView(value.components) }) };
  if (layers[2]!.status === 'ready' && (!result.binding || !result.revisionId || resources.length === 0)) fail();
  if (result.components) { budget.stages += result.components.nodes.reduce((sum, node) => sum + (node.stages?.length ?? 0), 0); if (budget.stages > 16384) fail(); }
  if (result.components && (result.components.binding.graphDigest !== result.binding?.graphDigest || result.components.binding.targetId !== result.binding?.targetId || result.components.binding.revisionDigest !== result.revisionId)) fail();
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
