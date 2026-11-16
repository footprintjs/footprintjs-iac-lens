import type { OnboardingAction, OnboardingSnapshot } from 'footprintjs-iac/onboarding';
export { readOnboardingAction, readOnboardingSnapshot } from 'footprintjs-iac/onboarding';
export type { OnboardingAction, OnboardingSnapshot } from 'footprintjs-iac/onboarding';

/** A display choice only; stage admission and execution stay in the base workflow. */
export function onboardingNextAction(view: OnboardingSnapshot): { label: string; action?: OnboardingAction } {
  if (view.busy) return { label: 'Working…' };
  if (view.status === 'ready') return view.canDiscover ? { label: 'Check setup again', action: { action: 'discover' } } : { label: 'Read recorded status', action: { action: 'refresh' } };
  if (view.canReconcile && view.review?.reviewId) return { label: 'Inspect outcome', action: { action: 'reconcile', reviewId: view.review.reviewId } };
  if (view.canDeploy && view.review?.reviewId) return { label: 'Deploy reviewed changes', action: { action: 'deploy', reviewId: view.review.reviewId } };
  if (view.canReview) return { label: 'Review changes', action: { action: 'review' } };
  if (view.canVerify) return { label: 'Verify setup', action: { action: 'verify' } };
  if (view.canConfigure) return { label: 'Configure connection', action: { action: 'configure' } };
  if (view.canDiscover) return { label: view.status === 'idle' ? 'Discover setup' : 'Check setup again', action: { action: 'discover' } };
  return { label: 'Read recorded status', action: { action: 'refresh' } };
}
