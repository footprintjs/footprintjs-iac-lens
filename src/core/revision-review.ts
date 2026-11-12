import type { Json } from 'footprint-iac';
import { projectBuildScene, type BuildSceneKind } from './build-scene.ts';
import type { DashboardState } from './types.ts';

export interface RevisionIdentity {
  id: string; digest: string; graphDigest: string; label?: string; createdAt?: string;
}
export type RevisionChangeKind = 'added' | 'changed' | 'removed' | 'unchanged' | 'drift';
export type RevisionPlanAction = 'create' | 'update' | 'verify' | 'delete' | 'noop';
export interface RevisionFieldChange { path: string; before?: Json; after?: Json }
export interface RevisionResourceChange {
  resourceId: string; action: RevisionPlanAction; change?: RevisionChangeKind;
  changes?: readonly RevisionFieldChange[];
}
/** Host-supplied review of one immutable candidate against the current target. It is not progress. */
export interface RevisionReviewState {
  status: 'available' | 'reviewing' | 'ready' | 'applying' | 'applied' | 'failed' | 'blocked';
  current?: RevisionIdentity; candidate?: RevisionIdentity;
  resources?: readonly RevisionResourceChange[];
  /** Apply must echo the exact completed review; a stale or absent review is never actionable. */
  reviewId?: string; canApply?: boolean; error?: string; runId?: string;
}
export interface RevisionResourceView extends RevisionResourceChange {
  title: string; kind: BuildSceneKind; label: string; affected: boolean;
}
export interface RevisionReviewView {
  state: RevisionReviewState; headline: string; currentLabel?: string; candidateLabel?: string;
  resources: RevisionResourceView[]; affected: RevisionResourceView[]; unchanged: RevisionResourceView[];
  canReview: boolean; canApply: boolean; applyLabel: string;
}

/** Presentation over host-planned actions. Desired differences never manufacture resource outcomes. */
export function projectRevisionReview(state: DashboardState): RevisionReviewView | undefined {
  if (!state.revisionReview) return undefined;
  const review = readRevisionReview(state.revisionReview), scene = projectBuildScene(state);
  const nodes = new Map(scene.nodes.map(node => [node.id, node]));
  const resources = (review.resources ?? []).map(resource => {
    const node = nodes.get(resource.resourceId);
    return { ...resource, title: node?.title ?? 'Resource', kind: node?.kind ?? 'resource' as const,
      label: actionLabel(resource), affected: resource.action !== 'noop' };
  });
  const affected = resources.filter(resource => resource.affected), unchanged = resources.filter(resource => !resource.affected);
  const active = review.status === 'reviewing' || review.status === 'applying';
  const ready = review.status === 'ready' && !!review.candidate && review.resources !== undefined;
  return { state: review, resources, affected, unchanged,
    headline: headline(review, affected), currentLabel: revisionLabel(review.current),
    candidateLabel: review.status === 'applied' && review.current?.digest === review.candidate?.digest ? undefined : revisionLabel(review.candidate),
    canReview: !state.resourceFlow && !state.busy && !active,
    canApply: !state.resourceFlow && !state.busy && ready && review.canApply === true && !!review.reviewId,
    applyLabel: !review.current ? 'Build system' : affected.some(row => row.action !== 'verify') ? 'Apply update' : 'Check version',
  };
}

function revisionLabel(revision?: RevisionIdentity): string | undefined {
  if (!revision) return undefined;
  return revision.label ?? (revision.id.length > 24 ? revision.id.slice(0, 12) : revision.id);
}
function actionLabel(resource: RevisionResourceChange): string {
  if (resource.action === 'noop') return 'Unchanged';
  if (resource.change === 'drift' && resource.action === 'update') return 'Repair';
  return { create: 'Add', update: 'Update', verify: 'Check', delete: 'Remove' }[resource.action];
}
function headline(review: RevisionReviewState, affected: RevisionResourceView[]): string {
  if (review.status === 'reviewing') return 'Checking changes';
  if (review.status === 'applying') return 'Updating your system';
  if (review.status === 'applied') return review.error ? 'Version applied · Checks need attention' : 'Version applied';
  if (review.status === 'failed') return 'Update needs attention';
  if (review.status === 'blocked') return 'Review needed';
  if (review.status !== 'ready') return review.candidate ? 'New version available' : 'Your current version';
  if (!affected.length) return 'No infrastructure changes';
  return affected.length === 1 ? `${affected[0]!.label} ${affected[0]!.title}` : `${affected.length} changes ready`;
}

/** Bounded plain JSON admission shared by the client and a trusted host projection. */
export function readRevisionReview(input: unknown): RevisionReviewState {
  const row = record(copy(input), ['status', 'current', 'candidate', 'resources', 'reviewId', 'canApply', 'error', 'runId']);
  if (!['available', 'reviewing', 'ready', 'applying', 'applied', 'failed', 'blocked'].includes(String(row.status))) fail();
  const identity = (input: unknown): RevisionIdentity => {
    const value = record(input, ['id', 'digest', 'graphDigest', 'label', 'createdAt']);
    string(value.id, 256); digest(value.digest); digest(value.graphDigest);
    optionalString(value.label, 160); optionalString(value.createdAt, 100);
    return value as unknown as RevisionIdentity;
  };
  if (row.current !== undefined) identity(row.current);
  if (row.candidate !== undefined) identity(row.candidate);
  optionalString(row.reviewId, 256); optionalString(row.error, 4000); optionalString(row.runId, 256);
  if (row.canApply !== undefined && typeof row.canApply !== 'boolean') fail();
  if (row.resources !== undefined) {
    if (!Array.isArray(row.resources) || row.resources.length > 4096) fail();
    const ids = new Set<string>();
    for (const item of row.resources) {
      const value = record(item, ['resourceId', 'action', 'change', 'changes']);
      const id = string(value.resourceId, 256);
      if (ids.has(id)) fail(); ids.add(id);
      if (!['create', 'update', 'verify', 'delete', 'noop'].includes(String(value.action))) fail();
      if (value.change !== undefined && !['added', 'changed', 'removed', 'unchanged', 'drift'].includes(String(value.change))) fail();
      if (value.changes !== undefined) {
        if (!Array.isArray(value.changes) || value.changes.length > 512) fail();
        for (const change of value.changes) string(record(change, ['path', 'before', 'after']).path, 2048);
      }
    }
  }
  return row as unknown as RevisionReviewState;
}
function fail(): never { throw Error('Revision review has an unsupported shape'); }
function record(input: unknown, allowed: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail();
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some(key => !allowed.includes(key))) fail();
  return row;
}
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail();
  return value;
}
function optionalString(value: unknown, max: number): void { if (value !== undefined) string(value, max); }
function digest(value: unknown): void { if (!/^[a-f0-9]{64}$/.test(string(value, 64))) fail(); }
function copy(input: unknown): Json {
  let count = 0;
  function visit(value: unknown, depth: number): Json {
    if (++count > 100000 || depth > 40) fail();
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail(); return value; }
    if (!value || typeof value !== 'object' || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length) fail();
    const result: Record<string, Json> = {};
    for (const [key, property] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (!('value' in property) || !property.enumerable || ['__proto__', 'constructor', 'prototype'].includes(key)) fail();
      if (property.value === undefined) continue;
      result[key] = visit(property.value, depth + 1);
    }
    if (Array.isArray(value)) {
      const keys = Object.keys(result);
      if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) fail();
      return keys.map(key => result[key]!);
    }
    return result;
  }
  return visit(input, 0);
}
