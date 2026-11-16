import type { OnboardingAction, OnboardingSnapshot } from '../core/onboarding.ts';
import type { OnboardingVersionAction, OnboardingVersionSnapshot } from '../core/onboarding-versions.ts';
import type { ApplicationPublication, PublishApplication } from './application-host.ts';

/** The base library owns stage ordering, admission, native recording and every deployment effect. */
export interface OnboardingWorkflowPort {
  snapshot(): Promise<OnboardingSnapshot>;
  dispatch(action: OnboardingAction): Promise<OnboardingSnapshot>;
  subscribe(listener: (snapshot: OnboardingSnapshot) => void): () => void;
  /** Runtime admission bounds the native capture before it enters the public dashboard. */
  recording?(): Promise<unknown>;
}
/** The base registry owns version review, activation, fencing and its active-workflow facade. */
export interface OnboardingVersionRegistryPort {
  readonly activeWorkflow: OnboardingWorkflowPort;
  snapshot(): Promise<OnboardingVersionSnapshot>;
  dispatch(action: OnboardingVersionAction): Promise<OnboardingVersionSnapshot>;
  subscribe(listener: (snapshot: OnboardingVersionSnapshot) => void): () => void;
  recording?(): Promise<unknown>;
}
export interface OnboardingVersionPublication { head: number; versionId: string; publication?: ApplicationPublication }
export interface OnboardingVersionPublicationPort {
  /** Read retained evidence for the captured active head. Never discover, mutate or reconnect. */
  snapshot(): Promise<OnboardingVersionPublication>;
  subscribe(listener: (publication: OnboardingVersionPublication) => void): () => void;
}
/** Registered trusted composition. Browser requests never choose a module, target, executable or secret. */
export interface OnboardingHost {
  version: 1;
  workflow: OnboardingWorkflowPort;
  registry?: OnboardingVersionRegistryPort;
  /** Versioned hosts use this scoped port; late publications from a retired head are ignored. */
  registryPublication?: OnboardingVersionPublicationPort;
  /** Retained application graph and native deployment evidence; no discovery or provider effects. */
  publication?(): Promise<ApplicationPublication | undefined>;
  /** Optional native deployment/check progress from the same registered controller. */
  subscribePublication?(listener: PublishApplication): () => void;
}
export interface OnboardingHostContext { directory: string }
export type CreateOnboardingHost = (context: OnboardingHostContext) => OnboardingHost | Promise<OnboardingHost>;
