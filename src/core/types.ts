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
export type ConnectionStatus = 'untested' | 'checking' | 'connected' | 'failed';
export interface ConnectionObservation {
  method: string; target: string; observedAt: number; latencyMs: number; details: Record<string, unknown>;
}
export interface ConnectionProgress {
  connectionId: string; from: string; to: string; status: ConnectionStatus;
  timestamp?: number; message?: string; runtimeStageId?: string;
  observation?: ConnectionObservation; details?: Record<string, unknown>;
}
export interface ConnectionEvent extends ConnectionProgress {
  version: 1; runId: string; sequence: number; timestamp: number; runtimeStageId: string;
  status: 'checking' | 'connected' | 'failed';
}
export interface ConnectionRun {
  id: string; status: 'idle' | 'checking' | 'passed' | 'failed';
  checks: ConnectionProgress[]; events: ConnectionEvent[]; checkedAt?: number;
  recording?: Recording; report?: { evidencePath?: string; tracePath?: string; error?: string; captureError?: string; traceStatus?: unknown };
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
  appAccess?: { status: 'checking' | 'ready' | 'failed'; checkedAt?: string; message?: string };
  run?: DashboardRun;
  recording?: Recording;
  artifacts?: OutputArtifact[];
  connections?: ConnectionRun;
}
export type Scenario = 'demo' | 'failure' | 'noop' | 'neo' | 'connections';
