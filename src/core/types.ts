import type { InfraGraph, BindingResult, SystemDesign } from 'footprint-iac';
import type { DeploymentChart, DeploymentSchedulePreview } from 'footprint-iac/progress';
import type { SystemViewDefinition } from './capabilities.ts';
import type { RevisionReviewState } from './revision-review.ts';
import type { ResourceFlowState } from './resource-flow.ts';

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
  /** Probe scope supplied by the trusted dashboard host. */
  scopeDescription?: string;
  timestamp?: number; message?: string; runtimeStageId?: string;
  observation?: ConnectionObservation; details?: Record<string, unknown>;
}
export interface ConnectionEvent extends ConnectionProgress {
  version: 1; runId: string; sequence: number; timestamp: number; runtimeStageId: string;
  status: 'checking' | 'connected' | 'failed';
}
export interface ConnectionRun {
  id: string; status: 'idle' | 'checking' | 'passed' | 'failed';
  label?: string; scopeDescription?: string;
  checks: ConnectionProgress[]; events: ConnectionEvent[]; checkedAt?: number;
  recording?: Recording; report?: { evidencePath?: string; tracePath?: string; error?: string; captureError?: string; traceStatus?: unknown };
}
export type IdentityVerdict = 'authenticated' | 'rejected' | 'allowed' | 'denied' | 'available' | 'unavailable';
export interface IdentityObservationDetails {
  code?: string; httpStatus?: number; sourceId?: string; subjectId?: string; policyId?: string;
  matchedRuleIds?: readonly string[]; action?: string; resource?: string;
  protocol?: 'ldap' | 'ldaps' | 'oidc' | 'http' | 'https'; phase?: 'directory' | 'authentication' | 'authorization' | 'transport';
}
export interface IdentityObservation {
  verdict: IdentityVerdict; observedAt: number; latencyMs: number; details?: IdentityObservationDetails;
}
export interface IdentityProgress {
  checkId: string; label: string; kind: 'login' | 'access' | 'directory';
  /** Resource associations supplied by the trusted host, independent of the recorded verdict. */
  resourceIds?: readonly string[];
  expected: Exclude<IdentityVerdict, 'unavailable'>; status: 'untested' | 'checking' | 'passed' | 'failed';
  timestamp?: number; runtimeStageId?: string; observation?: IdentityObservation; message?: string;
}
export interface IdentityEvent extends IdentityProgress {
  version: 1; runId: string; sequence: number; timestamp: number; runtimeStageId: string;
  status: 'checking' | 'passed' | 'failed';
}
export interface IdentityRun {
  id: string; label: string; status: 'idle' | 'checking' | 'passed' | 'failed';
  checks: IdentityProgress[]; events: IdentityEvent[]; checkedAt?: number;
  recording?: Recording; report?: { evidencePath?: string; tracePath?: string; error?: string; captureError?: string; traceStatus?: unknown };
}
export interface DashboardRun {
  id: string;
  status: 'idle' | 'running' | 'passed' | 'failed';
  mode?: 'simulator' | 'kubernetes' | 'managed';
  startedAt?: string | number;
  finishedAt?: string | number;
  resources: ResourceProgress[];
  events: ProgressEvent[];
  recording?: Recording;
  /** Native apply-chart topology and explicit resource-stage bindings, published before traversal. */
  chart?: DeploymentChart;
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
  mode?: 'simulator' | 'kubernetes' | 'managed';
  systemView?: SystemViewDefinition;
  /** Pure native schedule preview. Supplies positions only; never a run or progress evidence. */
  schedulePreview?: DeploymentSchedulePreview;
  managedReviewAvailable?: boolean;
  managedReviewLabel?: string;
  connectionReviewAvailable?: boolean;
  target?: { id?: string; context?: string; namespace?: string; label?: string };
  neoAvailable?: boolean;
  deploymentReadOnly?: boolean;
  neoUrl?: string;
  appAccess?: { status: 'checking' | 'ready' | 'failed'; checkedAt?: string; message?: string };
  run?: DashboardRun;
  recording?: Recording;
  artifacts?: OutputArtifact[];
  connections?: ConnectionRun;
  identity?: IdentityRun;
  revisionReview?: RevisionReviewState;
  resourceFlow?: ResourceFlowState;
  resourceFlowError?: string;
}
export type Scenario = 'demo' | 'failure' | 'noop' | 'neo' | 'connections' | 'identity' | 'review' | 'revision-review' | 'revision-apply';
