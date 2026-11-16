import { onboardingVersionAllowsReadiness } from '../core/onboarding-versions.ts';
import type { DashboardState } from '../core/types.ts';
import { readDashboardState } from '../core/client.ts';
import { readApplicationPublication } from './application-publication.ts';
import { sameOnboardingDefinition } from './onboarding-version-admission.ts';
import type { OnboardingPublication } from './onboarding.ts';

/** Current evidence is scoped to one immutable configuration. Retired records remain in native/history storage. */
function resetCurrentPublication(state: DashboardState): DashboardState {
  return { ...state, graph: null, design: undefined, binding: undefined, systemView: undefined, schedulePreview: undefined,
    run: undefined, recording: undefined, connections: undefined, identity: undefined, source: undefined, artifacts: [],
    changeAssessment: undefined, neoUrl: undefined, appAccess: undefined, connectionReviewAvailable: false, identityReviewAvailable: false };
}
export function readOnboardingPublicationState(current: DashboardState, value: OnboardingPublication): DashboardState {
  const changed = value.registry && current.onboardingRegistry && (value.registry.activeVersionId !== current.onboardingRegistry.activeVersionId
    || !sameOnboardingDefinition(value.view, current.onboardingRegistry.active));
  const base = changed ? resetCurrentPublication(current) : current;
  const { phase: _phase, ...publication } = value.publication ?? {};
  const ready = onboardingVersionAllowsReadiness(value.registry) && !value.view.busy && value.view.status === 'ready' && value.view.deployment?.promoted === true;
  const context = { ...base, target: { id: value.view.targetId, label: value.view.label }, onboarding: value.view,
    onboardingRegistry: value.registry, onboardingRegistryRecording: value.registryRecording, onboardingRecording: value.recording };
  const patch = readApplicationPublication(publication, context);
  return readDashboardState({ ...context, ...patch, onboardingError: value.error, busy: value.view.busy,
    target: patch.target ?? (base.target?.id === value.view.targetId ? base.target : context.target),
    ...(!ready ? { neoUrl: undefined, appAccess: patch.appAccess?.status === 'ready' ? undefined : patch.appAccess } : {}) });
}
