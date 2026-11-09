import type { InfraGraph, BindingResult, SystemDesign } from 'footprint-iac';

export type ResourceStatus = 'pending' | 'deploying' | 'ready' | 'failed' | 'skipped' | 'deleted';
export interface ResourceProgress {
  id: string;
  resourceId?: string;
  status: ResourceStatus;
  action?: string;
  message?: string;
  timestamp?: number | string;
  runtimeStageId?: string;
}
export interface ProgressEvent {
  resourceId?: string;
  status?: ResourceStatus;
  action?: string;
  message?: string;
  timestamp?: number | string;
  runtimeStageId?: string;
  sequence?: number;
  seq?: number;
}
export interface Recording {
  snapshot: unknown;
  structure: unknown;
  narrativeEntries?: unknown[];
}
export interface DashboardRun {
  id: string;
  status: 'idle' | 'running' | 'passed' | 'failed';
  mode?: 'simulator' | 'kubernetes';
  startedAt?: string | number;
  finishedAt?: string | number;
  resources: ResourceProgress[];
  events: ProgressEvent[];
  recording?: Recording;
  report?: unknown;
}
export interface OutputArtifact {
  id: string;
  path: string;
  content: string;
  mediaType?: string;
  target?: string;
  sha256?: string;
}
export interface DashboardState {
  revision: number;
  graph: InfraGraph | null;
  design?: SystemDesign;
  binding?: BindingResult;
  busy: boolean;
  mode?: 'simulator' | 'kubernetes';
  target?: { id?: string; context?: string; namespace?: string; label?: string };
  neoAvailable?: boolean;
  neoUrl?: string;
  run?: DashboardRun;
  recording?: Recording;
  artifacts?: OutputArtifact[];
}
export type Scenario = 'demo' | 'failure' | 'noop' | 'neo';
