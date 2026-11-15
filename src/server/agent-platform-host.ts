import type { AgentPlatformView } from '../core/agent-platform.ts';
import type { ApplicationView } from '../core/application.ts';
import type { DashboardState } from '../core/types.ts';

export interface AgentPlatformContext {
  operationId?: string;
  application?: ApplicationView;
  graph: DashboardState['graph'];
  run?: DashboardState['run'];
  target?: DashboardState['target'];
}
export type PublishAgentPlatform = (view: AgentPlatformView) => void;
/** A trusted app-owned observation/check port; it is not an agent execution engine. */
export interface AgentPlatformHost {
  version: 1; id: string; label: string;
  /** Retained native observations only. Do not discover providers, enumerate conversations or invoke an agent. */
  snapshot(context: AgentPlatformContext): Promise<AgentPlatformView>;
  /** Explicitly requested native readiness workflow and app-owned fixed probe. */
  check?(agentId: string, context: AgentPlatformContext, publish: PublishAgentPlatform): Promise<AgentPlatformView>;
  subscribe?(listener: PublishAgentPlatform): () => void;
}
/** A factory keeps the feature's code and private adapters unloaded until the viewer selects Agents. */
export type AgentPlatformHostProvider = AgentPlatformHost | (() => AgentPlatformHost | Promise<AgentPlatformHost>);
