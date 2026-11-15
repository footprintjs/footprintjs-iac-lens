/** Framework-neutral presentation of explicitly admitted agent observations. */
export type AgentStatus = 'pending' | 'running' | 'ready' | 'failed' | 'paused' | 'incomplete' | 'unknown' | 'unsupported';
export interface AgentRecordingRef {
  id: string; kind: 'deployment' | 'readiness' | 'turn'; runId: string; complete: boolean;
  /** A native recording reference, never a browser-selected path or artifact credential. */
  source: 'native';
}
export interface AgentStageView {
  id: string; label: string; status: AgentStatus; runtimeStageId?: string;
  kind?: 'stage' | 'decision' | 'tool' | 'model'; sequence?: number;
}
export interface AgentLayerView {
  id: 'infrastructure' | 'environment' | 'agent'; label: string; status: AgentStatus;
  detail?: string; resourceIds?: readonly string[]; recording?: AgentRecordingRef;
  stages?: readonly AgentStageView[];
}
export interface AgentCapabilityView {
  id: string; label: string; status: 'supported' | 'unsupported' | 'unknown'; proofRef?: AgentRecordingRef;
}
export interface AgentTurnView {
  id: string; label?: string; status: AgentStatus; recording?: AgentRecordingRef;
  stages: readonly AgentStageView[];
}
export interface AgentConversationView {
  id: string; label?: string; revisionId?: string; status: AgentStatus;
  turns: readonly AgentTurnView[];
}
export interface AgentView {
  id: string; label: string; description?: string; revisionId?: string; revisionLabel?: string;
  binding?: { graphDigest: string; targetId: string };
  status: AgentStatus; resourceIds: readonly string[];
  layers: readonly AgentLayerView[]; capabilities: readonly AgentCapabilityView[];
  conversations: readonly AgentConversationView[]; limitations: readonly string[];
  canCheck: boolean;
}
export interface AgentPlatformView {
  version: 1; id: string; label: string; busy: boolean; agents: readonly AgentView[];
  limitations: readonly string[]; error?: string;
}
export type AgentPlatformAction = { action: 'open' } | { action: 'refresh' } | { action: 'check'; agentId: string };
