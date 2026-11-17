import type { DashboardState, Recording } from './types.ts';
import type {AdapterDeploymentView} from './adapter-deployment.ts';

export type RunKind = 'deployment' | 'workflow' | 'checks' | 'agent';
export type RunStatus = 'running' | 'ready' | 'failed' | 'incomplete';
export interface RunSummary {
  id: string; runId: string; targetId?: string; label: string; versionLabel?: string;
  kind: RunKind; status: RunStatus; sequence: number; frameCount: number;
  replayAvailable: boolean; timing: 'recorded' | 'steps'; startedAt?: number; finishedAt?: number;
  appUrl?: string; appVerified: boolean; limitations: string[];
}
export interface RunFrame {
 sequence: number; nativePosition: string; caption: string; recordedAt?: number; state: DashboardState;
 /** Native stage observations admitted at this exact publication, never the terminal recording projected backwards. */
 deployment?:AdapterDeploymentView;
}
export type RecordedRunFrame = RunFrame;
export interface RunRecord { version: 1; summary: RunSummary; frames: RunFrame[]; omittedFrames: number; limitations: string[]; recording?: Recording }
export interface RunCatalog { version: 1; runs: RunSummary[]; omitted: number; limitations: string[] }
export type RunHistoryIndex = RunCatalog;
/** A registered observation-only source; replay never receives a deployment port. */
export interface RunRepository { list(): Promise<RunCatalog>; read(id: string): Promise<RunRecord | undefined> }
export interface RunObservation {
  identity: string; nativePosition: string; runId: string; targetId?: string; label: string; versionLabel?: string;
  kind: RunKind; status: RunStatus; caption: string; recordedAt?: number; startedAt?: number; finishedAt?: number; appUrl?: string; appVerified: boolean; limitations: string[];
}
export { registeredRunAppUrl, readRunSummary, readRunCatalog, readRunRecord, RUN_CATALOG_MAX_RUNS, RUN_RECORD_MAX_FRAMES } from './run-history-data.ts';
export { deriveRunObservation } from './run-history-observation.ts';
export { createRunHistoryClient, type RunHistoryClient, type RunHistoryClientOptions } from './run-history-client.ts';
