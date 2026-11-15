import type { Recording } from './types.ts';

/** Values are declarative. Host adapters own commands, targets, credentials and provider handles. */
export type PipelineOptionValue = string | number | boolean;
export type PipelineOption = { id: string; label: string; required?: boolean; default?: PipelineOptionValue } & (
  { type: 'choice'; values: { value: string; label: string }[] } |
  { type: 'integer'; min: number; max: number } |
  { type: 'boolean' });
export interface PipelineStrategyChoice { id: string; label: string; description: string; rollback: boolean; options: PipelineOption[] }
export interface PipelineChoice { id: string; label: string }
export interface PipelineReleaseChoice extends PipelineChoice { kind: 'source' | 'prepared'; version?: string; commit?: string; digest?: string }
export interface PipelineStageSelection { id: string; strategyId: string; options: Record<string, PipelineOptionValue>; checkIds: string[]; rollback: 'disabled' | 'manual' | 'automatic'; scheduleId?: string }
export interface PipelineSelection { releaseId: string; stages: PipelineStageSelection[] }
export interface PipelineStageChoice extends PipelineChoice { promotion: 'automatic' | 'manual'; strategyIds: string[]; checkIds: string[]; scheduleIds: string[]; defaults: Omit<PipelineStageSelection, 'id'> }
export interface PipelineCatalog { id: string; label: string; simulation: boolean; releases: PipelineReleaseChoice[]; strategies: PipelineStrategyChoice[]; checks: PipelineChoice[]; schedules: PipelineChoice[]; stages: PipelineStageChoice[] }
export interface PipelinePreviewStep { id: string; label: string; stageId?: string; kind: string }
export interface PipelinePreview { id: string; selection: PipelineSelection; steps: PipelinePreviewStep[]; edges: { from: string; to: string }[]; warnings: string[] }
export interface PipelineStageView {
  id: string; label: string; strategyId: string; status: 'pending' | 'running' | 'awaiting-promotion' | 'passed' | 'failed' | 'recovered' | 'incomplete';
  steps: { id: string; label: string; status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'incomplete' }[];
  checks: { id: string; passed: boolean; status:'passed'|'failed'|'inconclusive'|'error'|'skipped' }[];
  recording?: Recording;
  changes: {resourceId:string;action:'create'|'update'|'verify'|'delete'|'noop'|'replace'}[];
  recovery: 'disabled' | 'unavailable' | 'not-needed' | 'available' | 'running' | 'passed' | 'failed' | 'incomplete';
  canPromote: boolean; canRecover: boolean;
}
export interface PipelineExecutionView {
  id: string; status: 'idle' | 'running' | 'awaiting-promotion' | 'awaiting-recovery' | 'passed' | 'failed' | 'recovered' | 'incomplete';
  releaseId: string; releaseDigest: string; stages: PipelineStageView[];
  recordings: { runId: string; stageId:string; kind:'rollout'|'recovery'; status: 'passed' | 'failed' | 'incomplete' }[];
  recording?: Recording;
  events: { sequence: number; stageId: string; label: string; phase: string; status: string; timestamp: number }[];
}
export interface PipelineView { catalog: PipelineCatalog; preview?: PipelinePreview; execution?: PipelineExecutionView; busy: boolean; error?: string }
export type PipelineAction = { action: 'preview'; pipelineId: string; selection: PipelineSelection } |
  { action: 'start'; pipelineId: string; previewId: string } |
  { action: 'promote' | 'recover'; pipelineId: string; executionId: string; stageId: string };
