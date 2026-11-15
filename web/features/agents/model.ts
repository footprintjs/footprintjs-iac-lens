import type { AgentPlatformView, AgentRecordingRef, AgentStatus, AgentTurnView, AgentView } from '../../../src/core/agent-platform.ts';
import type { DashboardState, Recording } from '../../../src/core/types.ts';

export const statusLabels: Readonly<Record<AgentStatus, string>> = {
  pending: 'Waiting', running: 'Working', ready: 'Ready', failed: 'Needs attention', paused: 'Waiting for you',
  incomplete: 'Not confirmed', unknown: 'Not confirmed', unsupported: 'Not supported',
};

export function agentHeadline(status: AgentStatus): string {
  return { pending: 'Ready to check', running: 'Preparing agent', ready: 'Ready for conversations', failed: 'Needs attention',
    paused: 'Waiting for you', incomplete: 'Result not confirmed', unknown: 'Readiness not confirmed', unsupported: 'Not available here' }[status];
}

/** Selection is a catalog identity; an absent or retired selection cannot create an agent. */
export function selectedAgent(view: AgentPlatformView, id?: string): AgentView | undefined {
  return view.agents.find(agent => agent.id === id) ?? view.agents[0];
}

export interface RecordedTurnRow { conversationId: string; conversationLabel: string; revisionId?: string; turn: AgentTurnView }
/** The host supplies the admitted order. No timestamps or synthetic sessions are generated here. */
export function recordedTurnRows(agent: AgentView): RecordedTurnRow[] {
  return agent.conversations.flatMap(conversation => conversation.turns.map(turn => ({
    conversationId: conversation.id, conversationLabel: conversation.label ?? 'Recorded conversation',
    ...(conversation.revisionId ? { revisionId: conversation.revisionId } : {}), turn,
  })));
}

/** Reuse only the exact deployment record already admitted by this dashboard. Other kinds stay safe summaries. */
export function deploymentRecording(state: DashboardState, reference?: AgentRecordingRef): Recording | undefined {
  if (reference?.source !== 'native' || reference.kind !== 'deployment' || state.run?.id !== reference.runId) return;
  const recording = state.run.recording;
  if (!recording || !state.graph) return;
  const snapshotRun = recording.snapshot && typeof recording.snapshot === 'object'
    ? Object.getOwnPropertyDescriptor(recording.snapshot, 'runId')?.value : undefined;
  const proof = recording.provenance;
  if (proof?.runId !== reference.runId || proof.graphDigest !== state.graph.digest || proof.stack !== state.graph.name
    || typeof snapshotRun !== 'string' || !snapshotRun.length) return;
  return recording;
}
