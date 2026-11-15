import type { Recording } from './types.ts';

export interface HostActionMetadata { id: string; label: string; description?: string }
export interface HostActionInput { actionId: string }
export interface HostActionReceipt {
  ok: boolean; runId?: string; evidencePath?: string; tracePath?: string; resourceId?: string;
  recording?: Recording; captureError?: string;
}
/** Trusted host composition only. Browser input selects an ID and never supplies arguments. */
export interface HostActionControl extends HostActionMetadata { execute(): Promise<HostActionReceipt> }
export interface HostActionRun {
  invocationId: string; actionId: string; label: string; status: 'running' | 'passed' | 'failed';
  startedAt: number; finishedAt?: number; receipt?: HostActionReceipt; error?: string;
}
export interface HostActionsView { controls: HostActionMetadata[]; busy: boolean; history: HostActionRun[] }

function object(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.getOwnPropertySymbols(input).length) throw Error('Invalid configured action data');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.keys(descriptors).some(key => !allowed.includes(key) || !descriptors[key]!.enumerable || !('value' in descriptors[key]!))) throw Error('Invalid configured action data');
  return input as Record<string, unknown>;
}
function text(value: unknown, maximum = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) throw Error('Invalid configured action text');
  return value;
}
export function hostActionId(value: unknown): string {
  const id = text(value, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id) || ['__proto__', 'prototype', 'constructor'].includes(id)) throw Error('Invalid configured action ID');
  return id;
}
export function readHostActionInput(input: unknown): HostActionInput {
  const value = object(input, ['actionId']); return { actionId: hostActionId(value.actionId) };
}
export function readHostActionMetadata(input: unknown): HostActionMetadata {
  const value = object(input, ['id', 'label', 'description']);
  return { id: hostActionId(value.id), label: text(value.label, 160),
    ...(value.description !== undefined ? { description: text(value.description, 2000) } : {}) };
}
export function readHostActionReceipt(input: unknown): HostActionReceipt {
  const value = object(input, ['ok', 'runId', 'evidencePath', 'tracePath', 'resourceId', 'recording', 'captureError']);
  if (typeof value.ok !== 'boolean') throw Error('Invalid configured action result');
  const result: HostActionReceipt = { ok: value.ok };
  for (const field of ['runId', 'evidencePath', 'tracePath', 'resourceId', 'captureError'] as const) {
    if (value[field] !== undefined) result[field] = text(value[field]);
  }
  if (value.recording !== undefined) {
    const recording = object(value.recording, ['snapshot', 'structure', 'narrativeEntries', 'provenance', 'controlDeps']);
    if (!recording.snapshot || typeof recording.snapshot !== 'object' || recording.structure === undefined) throw Error('Invalid configured action recording');
    if (recording.narrativeEntries !== undefined && !Array.isArray(recording.narrativeEntries)) throw Error('Invalid configured action narrative');
    if (recording.controlDeps !== undefined && (!recording.controlDeps || typeof recording.controlDeps !== 'object' || Array.isArray(recording.controlDeps))) throw Error('Invalid configured action dependencies');
    result.recording = structuredClone(recording) as unknown as Recording;
  }
  return result;
}
export function readHostActionsView(input: unknown): HostActionsView {
  const value = object(input, ['controls', 'busy', 'history']);
  if (!Array.isArray(value.controls) || value.controls.length > 32 || typeof value.busy !== 'boolean'
    || !Array.isArray(value.history) || value.history.length > 256) throw Error('Invalid configured action history');
  const controls = value.controls.map(readHostActionMetadata);
  if (new Set(controls.map(control => control.id)).size !== controls.length) throw Error('Duplicate configured action');
  const history = value.history.map(input => {
    const run = object(input, ['invocationId', 'actionId', 'label', 'status', 'startedAt', 'finishedAt', 'receipt', 'error']);
    const actionId = hostActionId(run.actionId);
    if (!controls.some(control => control.id === actionId) || !['running', 'passed', 'failed'].includes(String(run.status))
      || !Number.isSafeInteger(run.startedAt) || (run.startedAt as number) < 0
      || (run.finishedAt !== undefined && (!Number.isSafeInteger(run.finishedAt) || (run.finishedAt as number) < (run.startedAt as number)))) throw Error('Invalid configured action run');
    if ((run.status === 'running') !== (run.finishedAt === undefined)) throw Error('Invalid configured action completion');
    return { invocationId: hostActionId(run.invocationId), actionId, label: text(run.label, 160), status: run.status as HostActionRun['status'], startedAt: run.startedAt as number,
      ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt as number } : {}),
      ...(run.receipt !== undefined ? { receipt: readHostActionReceipt(run.receipt) } : {}),
      ...(run.error !== undefined ? { error: text(run.error) } : {}) };
  });
  if (new Set(history.map(run => run.invocationId)).size !== history.length
    || history.filter(run => run.status === 'running').length > 1
    || value.busy !== history.some(run => run.status === 'running')) throw Error('Invalid configured action activity');
  return { controls, busy: value.busy, history };
}
