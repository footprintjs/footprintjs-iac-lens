import type { OnboardingVersionSnapshot } from 'footprintjs-iac/onboarding/versions';
import type { OnboardingSnapshot } from './onboarding.ts';
export { readOnboardingVersionAction, readOnboardingVersionOwner, readOnboardingVersionSnapshot } from 'footprintjs-iac/onboarding/versions';
export type { OnboardingVersionAction, OnboardingVersionOwner, OnboardingVersionSnapshot, OnboardingVersionDescriptor, OnboardingVersionReview } from 'footprintjs-iac/onboarding/versions';

/** Retained successful checks remain inspectable while an update's current ownership is unresolved. */
export function onboardingVersionAllowsReadiness(view?: OnboardingVersionSnapshot): boolean {
  return !view || !view.busy && !['blocked', 'activating', 'incomplete'].includes(view.status);
}
/** Inputs have already passed bounded native readers. Property order cannot splice two different active snapshots. */
export function onboardingVersionMatchesActive(registry: OnboardingVersionSnapshot, view: OnboardingSnapshot): boolean {
  function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, ordered(item)]));
    return value;
  }
  return JSON.stringify(ordered(registry.active)) === JSON.stringify(ordered(view));
}
