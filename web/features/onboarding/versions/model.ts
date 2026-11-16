import type { OnboardingVersionSnapshot } from '../../../../src/core/onboarding-versions.ts';

export const setupChangeLabels = { release: 'App release', checks: 'Readiness checks', profile: 'Connection settings or policy', configuration: 'Setup definition' };
export const setupOwnerLabels = { onboarding: 'Recorded setup', host: 'Application owner', native: 'Deployment controller', registry: 'Setup registry' };
export const setupBlockerLabels = { pending: 'An earlier operation is still pending.', unknown: 'The earlier outcome could not be confirmed.', changed: 'The retained owner or registered setup changed.' };
export function currentSetupLabel(view: OnboardingVersionSnapshot): string { return view.versions.find(version => version.id === view.activeVersionId)!.label; }
export function currentSetupReview(view: OnboardingVersionSnapshot, selected: string) {
  const review = view.review;
  return review && review.toVersionId === selected && review.fromVersionId === view.activeVersionId && review.head === view.head ? review : undefined;
}
