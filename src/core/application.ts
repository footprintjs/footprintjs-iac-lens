import { connectionProfileId } from './connection-profiles.ts';

export interface ApplicationTarget {
  id: string; label: string; description?: string;
  requiresProfile: boolean;
  profileAdapterIds?: readonly string[];
  requiredInspectionCheckIds: readonly string[];
  requiredVerificationCheckIds: readonly string[];
}
export interface ApplicationStrategy {
  id: string; label: string; description?: string; targets: readonly ApplicationTarget[];
}
export interface ApplicationSelection { strategyId: string; targetId: string; profileId?: string }
export interface ApplicationCheck { id: string; label: string; status: 'passed' | 'failed' | 'unknown' }
export interface ApplicationInspection { ok: boolean; checks: readonly ApplicationCheck[] }
export interface ApplicationChange {
  resourceId: string; label: string; action: 'create' | 'update' | 'noop' | 'replace' | 'delete' | 'blocked';
}
export interface ApplicationReview { ok: boolean; reviewId?: string; changes: readonly ApplicationChange[] }
export interface ApplicationDeployment {
  ok: boolean; promoted: boolean;
  status: 'promoted' | 'blocked' | 'apply-failed' | 'verification-failed' | 'incomplete';
  checks?: readonly ApplicationCheck[]; appUrl?: string;
}
export type ApplicationPhase = 'choose' | 'inspect' | 'review' | 'deploy' | 'verify' | 'ready' | 'failed' | 'incomplete';
export interface ApplicationView {
  id: string; label: string; description?: string; strategies: readonly ApplicationStrategy[];
  selection?: ApplicationSelection; phase: ApplicationPhase; busy: boolean;
  canInspect: boolean; canReview: boolean; canDeploy: boolean;
  inspection?: ApplicationInspection; review?: ApplicationReview; deployment?: ApplicationDeployment; error?: string;
}
export type ApplicationAction =
  | ({ action: 'select' } & ApplicationSelection)
  | { action: 'inspect' | 'review' | 'refresh' }
  | { action: 'deploy'; reviewId: string };

function object(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.getOwnPropertySymbols(input).length) throw Error('Invalid application data');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.keys(descriptors).some(key => !allowed.includes(key) || !descriptors[key]!.enumerable || !('value' in descriptors[key]!))) throw Error('Invalid application data');
  return input as Record<string, unknown>;
}
export function applicationText(input: unknown, maximum = 256): string {
  if (typeof input !== 'string' || !input.trim() || input.length > maximum || /[\x00-\x1f\x7f]/.test(input)) throw Error('Invalid application text');
  return input;
}
export function applicationId(input: unknown): string {
  const id = applicationText(input, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(id) || ['__proto__', 'prototype', 'constructor'].includes(id)) throw Error('Invalid application ID');
  return id;
}
export function applicationUrl(input: unknown): string {
  const value = applicationText(input, 2048), parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw Error('Invalid application URL');
  return value;
}
function identifiers(input: unknown, required: boolean): string[] {
  if (!Array.isArray(input) || input.length > 64 || (required && input.length === 0)) throw Error('Invalid application check policy');
  const values = input.map(applicationId);
  if (new Set(values).size !== values.length) throw Error('Duplicate application ID');
  return values;
}
export function readApplicationSelection(input: unknown): ApplicationSelection {
  const value = object(input, ['strategyId', 'targetId', 'profileId']);
  return { strategyId: applicationId(value.strategyId), targetId: applicationId(value.targetId),
    ...(value.profileId !== undefined ? { profileId: connectionProfileId(value.profileId) } : {}) };
}
export function readApplicationStrategies(input: unknown): ApplicationStrategy[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 16) throw Error('Configure a bounded application strategy catalog');
  const result = input.map(input => {
    const value = object(input, ['id', 'label', 'description', 'targets']);
    if (!Array.isArray(value.targets) || value.targets.length === 0 || value.targets.length > 32) throw Error('Configure registered application targets');
    const targets = value.targets.map(input => {
      const target = object(input, ['id', 'label', 'description', 'requiresProfile', 'profileAdapterIds', 'requiredInspectionCheckIds', 'requiredVerificationCheckIds']);
      if (typeof target.requiresProfile !== 'boolean') throw Error('Declare the target connection policy');
      return { id: applicationId(target.id), label: applicationText(target.label, 160),
        ...(target.description !== undefined ? { description: applicationText(target.description, 2000) } : {}),
        requiresProfile: target.requiresProfile,
        ...(target.profileAdapterIds !== undefined ? { profileAdapterIds: identifiers(target.profileAdapterIds, true) } : {}),
        requiredInspectionCheckIds: identifiers(target.requiredInspectionCheckIds, true),
        requiredVerificationCheckIds: identifiers(target.requiredVerificationCheckIds, true) };
    });
    if (new Set(targets.map(target => target.id)).size !== targets.length) throw Error('Duplicate application target');
    return { id: applicationId(value.id), label: applicationText(value.label, 160),
      ...(value.description !== undefined ? { description: applicationText(value.description, 2000) } : {}), targets };
  });
  if (new Set(result.map(strategy => strategy.id)).size !== result.length) throw Error('Duplicate application strategy');
  return result;
}
export function readApplicationChecks(input: unknown): ApplicationCheck[] {
  if (!Array.isArray(input) || input.length > 64) throw Error('Invalid application checks');
  const result = input.map(input => {
    const value = object(input, ['id', 'label', 'status']);
    if (!['passed', 'failed', 'unknown'].includes(String(value.status))) throw Error('Invalid application check status');
    return { id: applicationId(value.id), label: applicationText(value.label, 160), status: value.status as ApplicationCheck['status'] };
  });
  if (new Set(result.map(check => check.id)).size !== result.length) throw Error('Duplicate application check');
  return result;
}
export function readApplicationInspection(input: unknown): ApplicationInspection {
  const value = object(input, ['ok', 'checks']);
  if (typeof value.ok !== 'boolean') throw Error('Invalid application inspection');
  return { ok: value.ok, checks: readApplicationChecks(value.checks) };
}
export function readApplicationReview(input: unknown): ApplicationReview {
  const value = object(input, ['ok', 'reviewId', 'changes']);
  if (typeof value.ok !== 'boolean' || !Array.isArray(value.changes) || value.changes.length > 512) throw Error('Invalid application review');
  const changes = value.changes.map(input => {
    const change = object(input, ['resourceId', 'label', 'action']);
    if (!['create', 'update', 'noop', 'replace', 'delete', 'blocked'].includes(String(change.action))) throw Error('Invalid application change');
    return { resourceId: applicationText(change.resourceId), label: applicationText(change.label, 160), action: change.action as ApplicationChange['action'] };
  });
  if (new Set(changes.map(change => change.resourceId)).size !== changes.length
    || (value.ok && (value.reviewId === undefined || changes.some(change => change.action === 'blocked')))
    || (!value.ok && value.reviewId !== undefined)) throw Error('Invalid application review admission');
  return { ok: value.ok, ...(value.reviewId !== undefined ? { reviewId: applicationId(value.reviewId) } : {}), changes };
}
export function readApplicationDeployment(input: unknown): ApplicationDeployment {
  const value = object(input, ['ok', 'promoted', 'status', 'checks', 'appUrl']);
  if (typeof value.ok !== 'boolean' || typeof value.promoted !== 'boolean'
    || !['promoted', 'blocked', 'apply-failed', 'verification-failed', 'incomplete'].includes(String(value.status))
    || (value.status === 'promoted') !== value.promoted || value.ok !== value.promoted) throw Error('Invalid application deployment');
  let appUrl: string | undefined;
  if (value.appUrl !== undefined) {
    appUrl = applicationUrl(value.appUrl);
    if (!value.promoted) throw Error('Invalid application URL');
  }
  return { ok: value.ok, promoted: value.promoted, status: value.status as ApplicationDeployment['status'],
    ...(value.checks !== undefined ? { checks: readApplicationChecks(value.checks) } : {}), ...(appUrl ? { appUrl } : {}) };
}
export function readApplicationAction(input: unknown): ApplicationAction {
  const value = object(input, ['action', 'strategyId', 'targetId', 'profileId', 'reviewId']);
  if (value.action === 'select') {
    if (value.reviewId !== undefined) throw Error('Selection cannot contain a review');
    const { action: _action, ...selection } = value;
    return { action: 'select', ...readApplicationSelection(selection) };
  }
  if (Object.keys(value).some(key => key !== 'action' && !(value.action === 'deploy' && key === 'reviewId'))) throw Error('Choose registered application IDs only');
  if (value.action === 'deploy') return { action: 'deploy', reviewId: applicationId(value.reviewId) };
  if (['inspect', 'review', 'refresh'].includes(String(value.action))) return { action: value.action as 'inspect' | 'review' | 'refresh' };
  throw Error('Unknown application action');
}
export function readApplicationView(input: unknown): ApplicationView {
  const value = object(input, ['id', 'label', 'description', 'strategies', 'selection', 'phase', 'busy', 'canInspect', 'canReview', 'canDeploy', 'inspection', 'review', 'deployment', 'error']);
  if (!['choose', 'inspect', 'review', 'deploy', 'verify', 'ready', 'failed', 'incomplete'].includes(String(value.phase))
    || ['busy', 'canInspect', 'canReview', 'canDeploy'].some(key => typeof value[key] !== 'boolean')) throw Error('Invalid application view');
  const strategies = readApplicationStrategies(value.strategies);
  const selection = value.selection === undefined ? undefined : readApplicationSelection(value.selection);
  if (selection && !strategies.find(strategy => strategy.id === selection.strategyId)?.targets.some(target => target.id === selection.targetId)) throw Error('Application selection is not registered');
  const inspection = value.inspection === undefined ? undefined : readApplicationInspection(value.inspection);
  const review = value.review === undefined ? undefined : readApplicationReview(value.review);
  const deployment = value.deployment === undefined ? undefined : readApplicationDeployment(value.deployment);
  const target = selection && strategies.find(strategy => strategy.id === selection.strategyId)?.targets.find(target => target.id === selection.targetId);
  const requiredPassed = (checks: readonly ApplicationCheck[] | undefined, ids: readonly string[]) => ids.every(id => checks?.some(check => check.id === id && check.status === 'passed'));
  if ((value.busy && (value.canInspect || value.canReview || value.canDeploy))
    || ((value.canInspect || value.canReview || value.canDeploy) && (!selection || !target || (target.requiresProfile && !selection.profileId)))
    || ((value.canReview || value.canDeploy) && target && !requiredPassed(inspection?.checks, target.requiredInspectionCheckIds))
    || (value.canReview && !inspection?.ok) || (value.canDeploy && (!review?.ok || !review.reviewId || deployment))
    || (deployment?.promoted && (!target || !requiredPassed(deployment.checks, target.requiredVerificationCheckIds)))
    || (deployment?.promoted && !['deploy', 'verify', 'ready'].includes(String(value.phase)))
    || (value.phase === 'ready' && !deployment?.promoted)) throw Error('Invalid application activity admission');
  return { id: applicationId(value.id), label: applicationText(value.label, 160),
    ...(value.description !== undefined ? { description: applicationText(value.description, 2000) } : {}), strategies,
    ...(selection ? { selection } : {}), phase: value.phase as ApplicationPhase, busy: value.busy as boolean,
    canInspect: value.canInspect as boolean, canReview: value.canReview as boolean, canDeploy: value.canDeploy as boolean,
    ...(inspection ? { inspection } : {}), ...(review ? { review } : {}), ...(deployment ? { deployment } : {}),
    ...(value.error !== undefined ? { error: applicationText(value.error, 4000) } : {}) };
}
