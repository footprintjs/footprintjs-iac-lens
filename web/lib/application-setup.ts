import type { ApplicationAction, ApplicationSelection, ApplicationTarget, ApplicationView } from '../../src/core/application.ts';
import type { ConnectionProfilesView } from '../../src/core/connection-profiles.ts';

export type SetupStepStatus = 'pending' | 'selected' | 'running' | 'passed' | 'failed' | 'unknown';
export interface SetupStep { id: 'choose' | 'inspect' | 'review' | 'deploy' | 'verify'; label: string; status: SetupStepStatus }

export function applicationTarget(view: ApplicationView, strategyId?: string, targetId?: string): ApplicationTarget | undefined {
  return view.strategies.find(strategy => strategy.id === strategyId)?.targets.find(target => target.id === targetId);
}

/** UI choices contain catalog identifiers only. The host independently admits their current bindings. */
export function applicationSelectionAction(view: ApplicationView, strategyId: string, targetId: string, profileId?: string): ApplicationAction | undefined {
  if (!applicationTarget(view, strategyId, targetId) || (profileId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(profileId))) return;
  return { action: 'select', strategyId, targetId, ...(profileId ? { profileId } : {}) };
}

export function sameApplicationSelection(a?: ApplicationSelection, b?: ApplicationSelection): boolean {
  return !!a && !!b && a.strategyId === b.strategyId && a.targetId === b.targetId && a.profileId === b.profileId;
}

export function applicationProfiles(view: ConnectionProfilesView | undefined, target?: ApplicationTarget): ConnectionProfilesView | undefined {
  if (!view || !target) return;
  const allowed = target.profileAdapterIds;
  return { ...view, requiredAtStart: target.requiresProfile,
    schemas: view.schemas.filter(schema => !allowed || allowed.includes(schema.id)),
    profiles: view.profiles.filter(profile => !allowed || allowed.includes(profile.adapterId)) };
}

export function applicationSetupSteps(view: ApplicationView): SetupStep[] {
  const running = (phase: string) => view.busy && view.phase === phase;
  const deployment = view.deployment;
  const uncertain = view.phase === 'incomplete';
  return [
    { id: 'choose', label: 'Choose setup', status: view.selection ? 'selected' : 'pending' },
    { id: 'inspect', label: 'Check', status: running('inspect') ? 'running' : view.inspection ? view.inspection.ok ? 'passed' : 'failed' : 'pending' },
    { id: 'review', label: 'Review', status: running('review') ? 'running' : view.review ? view.review.ok ? 'passed' : 'failed' : 'pending' },
    { id: 'deploy', label: 'Deploy', status: uncertain ? 'unknown' : running('deploy') ? 'running' : deployment?.promoted ? 'passed' : deployment?.status === 'incomplete' || deployment?.status === 'verification-failed' ? 'unknown' : deployment ? 'failed' : 'pending' },
    { id: 'verify', label: 'Verify', status: uncertain ? 'unknown' : running('verify') ? 'running' : deployment?.promoted ? 'passed' : deployment?.status === 'verification-failed' ? 'failed' : 'pending' },
  ];
}

export function applicationNextAction(view: ApplicationView): { label: string; action?: ApplicationAction; enabled: boolean } {
  if (view.busy) return { label: view.phase === 'inspect' ? 'Checking…' : view.phase === 'review' ? 'Reviewing…' : view.phase === 'verify' ? 'Verifying…' : view.phase === 'deploy' ? 'Deploying…' : 'Refreshing status…', enabled: false };
  if (view.phase === 'incomplete') return { label: 'Refresh status', action: { action: 'refresh' }, enabled: true };
  if (view.deployment) return { label: 'Check setup', action: { action: 'inspect' }, enabled: view.canInspect };
  if (view.canDeploy && view.review?.reviewId) return { label: 'Deploy', action: { action: 'deploy', reviewId: view.review.reviewId }, enabled: true };
  if (view.canReview) return { label: 'Review changes', action: { action: 'review' }, enabled: true };
  return { label: 'Check setup', action: { action: 'inspect' }, enabled: view.canInspect };
}

export function applicationHeadline(view: ApplicationView): string {
  if (view.busy) return view.phase === 'inspect' ? 'Checking your setup' : view.phase === 'review' ? 'Reviewing changes' : view.phase === 'verify' ? 'Verifying the app' : view.phase === 'deploy' ? 'Deploying your app' : 'Reading recorded status';
  if (view.phase === 'incomplete') return 'Result not confirmed';
  if (view.phase === 'ready' && view.deployment?.promoted) return 'Ready to use';
  if (view.phase === 'failed' || view.error || view.inspection?.ok === false || view.review?.ok === false || view.deployment) return 'Needs attention';
  if (view.canDeploy) return 'Review the changes, then deploy';
  if (view.canReview) return 'Your setup passed its checks';
  return 'Choose where your app will run';
}

export function applicationAppUrl(view: ApplicationView): string | undefined {
  const value = view.phase === 'ready' && !view.busy && view.deployment?.promoted ? view.deployment.appUrl : undefined;
  if (!value) return;
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) return value;
  } catch { /* The host did not provide an admissible app URL. */ }
}
