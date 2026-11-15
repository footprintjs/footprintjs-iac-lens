import type { AgentRecordingRef, AgentStageView, AgentStatus } from './agent-platform.ts';
export type AgentComponentStatus = AgentStatus | 'skipped';
export interface AgentComponentProgress {
  completed: number; total?: number; indeterminate: boolean; unit: 'stages' | 'components';
}
export interface AgentComponentNodeView {
  id: string; label: string; kind: 'execution' | 'store' | 'context' | 'connection'; roles: readonly string[];
  status: AgentComponentStatus; required: boolean; selected: boolean; boundaryId?: string;
  storage?: 'memory' | 'persistent'; sharing?: 'shared' | 'dedicated'; physicalBindingId?: string;
  progress: AgentComponentProgress; stages?: readonly AgentStageView[]; recording?: AgentRecordingRef;
}
export interface AgentComponentBoundaryView {
  id: string; label: string; kind: 'platform' | 'host' | 'namespace' | 'pod' | 'container' | 'service' | 'shared' | 'isolation';
  parentId?: string; identityComponentId?: string; strategy?: { id: string; label: string }; status: AgentComponentStatus;
  observed: boolean; progress: AgentComponentProgress; recording?: AgentRecordingRef;
}
export interface AgentComponentRelationView {
  id: string; from: string; to: string; kind: 'order' | 'communicatesWith' | 'supports' | 'contains';
  required?: boolean; checkComponentId?: string; status?: 'untested' | 'checking' | 'connected' | 'failed';
}
/** Safe view only: private profiles, handles, endpoints and native payloads stay with the host. */
export interface AgentComponentGraphView {
  version: 1; id: string; label: string; digest: string;
  binding: { graphDigest: string; deploymentDigest: string; revisionDigest: string; targetId: string };
  nodes: readonly AgentComponentNodeView[]; boundaries: readonly AgentComponentBoundaryView[];
  relations: readonly AgentComponentRelationView[]; recording?: AgentRecordingRef; limitations: readonly string[];
}
