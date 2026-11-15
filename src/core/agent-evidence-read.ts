import type { AgentRecordingRef, AgentStageView } from './agent-platform.ts';
import { fail, row, text, id, flag, status, optionalText } from './agent-read-data.ts';
export function readAgentRecordingRef(input: unknown, kind?: AgentRecordingRef['kind']): AgentRecordingRef {
  const value = row(input, ['id', 'kind', 'runId', 'complete', 'source']);
  if (!['deployment', 'readiness', 'turn'].includes(value.kind) || kind && value.kind !== kind || value.source !== 'native') fail();
  return { id: id(value.id), kind: value.kind, runId: text(value.runId, 512), complete: flag(value.complete), source: 'native' };
}
export function readAgentStageView(input: unknown): AgentStageView {
  const value = row(input, ['id', 'label', 'status', 'runtimeStageId', 'kind', 'sequence']);
  if (value.kind !== undefined && !['stage', 'decision', 'tool', 'model'].includes(value.kind)) fail();
  if (value.sequence !== undefined && (!Number.isSafeInteger(value.sequence) || value.sequence < 1)) fail();
  return { id: text(value.id, 512), label: text(value.label, 160), status: status(value.status), ...optionalText(value.runtimeStageId, 'runtimeStageId', 512),
    ...(value.kind === undefined ? {} : { kind: value.kind }), ...(value.sequence === undefined ? {} : { sequence: value.sequence }) };
}
