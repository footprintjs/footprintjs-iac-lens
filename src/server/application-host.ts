import type { ConnectionProfileCatalog } from 'footprintjs-iac/connection-profiles';
import type { ApplicationDeployment, ApplicationInspection, ApplicationReview, ApplicationSelection, ApplicationStrategy } from '../core/application.ts';
import type { DashboardState } from '../core/types.ts';
import type { AgentPlatformHostProvider } from './agent-platform-host.ts';

export type ApplicationPublication = Partial<Pick<DashboardState,
  'graph' | 'design' | 'binding' | 'schedulePreview' | 'run' | 'recording' | 'connections' | 'identity' | 'artifacts' | 'target' | 'systemView' | 'changeAssessment' | 'neoUrl' | 'appAccess' | 'source'>>
  & { phase?: 'verify' };
export type PublishApplication = (publication: ApplicationPublication) => void;
export interface ApplicationHostSnapshot {
  selection?: ApplicationSelection; inspection?: ApplicationInspection; review?: ApplicationReview;
  deployment?: ApplicationDeployment; publication?: ApplicationPublication;
  /** Explicit false may clear an earlier uncertain effect after native reconciliation. */
  incomplete?: boolean;
}
/** Registered by trusted operator code. Browser inputs never select executable code or provider arguments. */
export interface ApplicationHost {
  version: 1; id: string; label: string; description?: string; strategies: readonly ApplicationStrategy[];
  connectionProfiles?: ConnectionProfileCatalog;
  agentPlatform?: AgentPlatformHostProvider;
  inspect(selection: ApplicationSelection, publish: PublishApplication): Promise<ApplicationInspection & { publication?: ApplicationPublication }>;
  plan(selection: ApplicationSelection, publish: PublishApplication): Promise<ApplicationReview & { publication?: ApplicationPublication }>;
  apply(selection: ApplicationSelection & { reviewId: string }, publish: PublishApplication): Promise<ApplicationDeployment & { publication?: ApplicationPublication }>;
  /** Read retained native receipts only; never discover, create, reconnect or retry provider effects. */
  snapshot(selection?: ApplicationSelection): Promise<ApplicationHostSnapshot>;
}
export interface ApplicationHostContext { directory: string }
export type CreateApplicationHost = (context: ApplicationHostContext) => ApplicationHost | Promise<ApplicationHost>;
