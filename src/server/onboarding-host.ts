import type { OnboardingAction, OnboardingSnapshot } from '../core/onboarding.ts';
import type { ApplicationPublication, PublishApplication } from './application-host.ts';

/** The base library owns stage ordering, admission, native recording and every deployment effect. */
export interface OnboardingWorkflowPort {
  snapshot(): Promise<OnboardingSnapshot>;
  dispatch(action: OnboardingAction): Promise<OnboardingSnapshot>;
  subscribe(listener: (snapshot: OnboardingSnapshot) => void): () => void;
  /** Runtime admission bounds the native capture before it enters the public dashboard. */
  recording?(): Promise<unknown>;
}
/** Registered trusted composition. Browser requests never choose a module, target, executable or secret. */
export interface OnboardingHost {
  version: 1;
  workflow: OnboardingWorkflowPort;
  /** Retained application graph and native deployment evidence; no discovery or provider effects. */
  publication?(): Promise<ApplicationPublication | undefined>;
  /** Optional native deployment/check progress from the same registered controller. */
  subscribePublication?(listener: PublishApplication): () => void;
}
export interface OnboardingHostContext { directory: string }
export type CreateOnboardingHost = (context: OnboardingHostContext) => OnboardingHost | Promise<OnboardingHost>;
