import assert from 'node:assert/strict';
import test from 'node:test';
import { compileGraph } from 'footprintjs-iac/graph';
import { projectBuildScene } from '../src/core/build-scene.ts';
import { projectRevisionReview, readRevisionReview, type RevisionIdentity, type RevisionReviewState } from '../src/core/revision-review.ts';
import type { DashboardState } from '../src/core/types.ts';

const current: RevisionIdentity = { id: 'neo-v1', label: 'Neo 1', digest: 'a'.repeat(64), graphDigest: 'b'.repeat(64) };
const candidate: RevisionIdentity = { id: 'neo-v2', label: 'Neo 2', digest: 'c'.repeat(64), graphDigest: 'd'.repeat(64) };
function fixture(): DashboardState {
  const ids = ['identity-directory', 'identity-provider', 'neo-namespace', 'neo-access-policy', 'neo-app', 'neo-service'];
  const graph = compileGraph({ name: 'neo-version-test', resources: [
    { id: ids[0]!, provider: 'fixture', spec: { role: 'directory' } },
    { id: ids[1]!, provider: 'fixture', spec: { role: 'provider' }, dependsOn: [ids[0]!] },
    { id: ids[2]!, provider: 'fixture', spec: { kind: 'Namespace' } },
    { id: ids[3]!, provider: 'fixture', spec: { kind: 'RoleBinding' } },
    { id: ids[4]!, provider: 'fixture', spec: { kind: 'Deployment', image: 'neo:v1' } },
    { id: ids[5]!, provider: 'fixture', spec: { kind: 'Service' } },
  ], boundaries: [], memberships: [], relations: [] });
  return { revision: 1, graph, busy: false, mode: 'managed', run: { id: 'applied-v1', status: 'passed',
    resources: ids.map(id => ({ id, status: 'ready' })), events: ids.flatMap((resourceId, index) => [
      { resourceId, sequence: index * 2 + 1, status: 'deploying' as const, action: 'create' },
      { resourceId, sequence: index * 2 + 2, status: 'ready' as const, action: 'create' },
    ]) } };
}
function ready(state: DashboardState): RevisionReviewState {
  return { status: 'ready', current, candidate, reviewId: 'review-2', canApply: true,
    resources: state.graph!.resources.map(resource => ({ resourceId: resource.id,
      action: resource.id === 'neo-app' ? 'update' : 'noop', change: resource.id === 'neo-app' ? 'changed' : 'unchanged',
      ...(resource.id === 'neo-app' ? { changes: [{ path: '/spec/image', before: 'neo:v1', after: 'neo:v2' }] } : {}) })),
  };
}

test('an image-only review names Program while retaining every native readiness outcome and object position', () => {
  const state = fixture(), before = structuredClone(state), sceneBefore = projectBuildScene(state);
  state.revisionReview = ready(state);
  const view = projectRevisionReview(state)!;
  assert.equal(view.headline, 'Update Program');
  assert.equal(view.currentLabel, 'Neo 1'); assert.equal(view.candidateLabel, 'Neo 2');
  assert.equal(view.resources.length, 6); assert.equal(view.unchanged.length, 5);
  assert.deepEqual(view.affected.map(row => [row.resourceId, row.action, row.label]), [['neo-app', 'update', 'Update']]);
  assert.deepEqual(view.affected[0]!.changes, [{ path: '/spec/image', before: 'neo:v1', after: 'neo:v2' }]);
  assert.equal(view.canApply, true); assert.equal(view.canReview, true);
  const sceneAfter = projectBuildScene(state);
  assert.deepEqual(sceneAfter.nodes.map(node => [node.id, node.status, node.column, node.row]),
    sceneBefore.nodes.map(node => [node.id, node.status, node.column, node.row]));
  assert.ok(sceneAfter.nodes.every(node => node.status === 'ready'));
  assert.deepEqual({ ...state, revisionReview: undefined }, { ...before, revisionReview: undefined });
});

test('only an actionable completed review can apply; missing/stale review inputs never activate the button', () => {
  for (const patch of [
    { status: 'available' as const }, { status: 'reviewing' as const }, { status: 'applying' as const },
    { status: 'failed' as const }, { status: 'blocked' as const }, { status: 'applied' as const },
    { reviewId: undefined }, { canApply: false }, { candidate: undefined }, { resources: undefined },
  ]) {
    const state = fixture(); state.revisionReview = { ...ready(state), ...patch };
    assert.equal(projectRevisionReview(state)!.canApply, false, JSON.stringify(patch));
  }
  const state = fixture(); state.revisionReview = ready(state); state.busy = true;
  assert.equal(projectRevisionReview(state)!.canApply, false);
  assert.equal(projectRevisionReview(state)!.canReview, false);
  assert.equal(projectRevisionReview(fixture()), undefined, 'ordinary one-build hosts do not acquire revision controls');
});

test('planned actions, rather than desired-only differences, decide update, drift repair and no-op wording', () => {
  const state = fixture(); state.revisionReview = ready(state);
  state.revisionReview.resources = [{ resourceId: 'neo-app', action: 'noop', change: 'changed',
    changes: [{ path: '/dependsOn', before: ['a'], after: ['b'] }] }];
  let view = projectRevisionReview(state)!;
  assert.equal(view.headline, 'No infrastructure changes');
  assert.equal(view.affected.length, 0); assert.equal(view.applyLabel, 'Check version');
  state.revisionReview.resources = [{ resourceId: 'neo-app', action: 'verify', change: 'drift' }];
  view = projectRevisionReview(state)!;
  assert.equal(view.headline, 'Check Program'); assert.equal(view.applyLabel, 'Check version');
  state.revisionReview.resources = [{ resourceId: 'neo-app', action: 'update', change: 'drift' }];
  assert.equal(projectRevisionReview(state)!.headline, 'Repair Program');
  state.revisionReview.resources = [{ resourceId: 'retired-store', action: 'delete', change: 'removed' }];
  assert.equal(projectRevisionReview(state)!.headline, 'Remove Resource');
});

test('an applied version is displayed once, and actual native update starts say Updating', () => {
  const state = fixture(); state.revisionReview = { ...ready(state), status: 'applied', current: candidate };
  const view = projectRevisionReview(state)!;
  assert.equal(view.currentLabel, 'Neo 2'); assert.equal(view.candidateLabel, undefined);
  assert.equal(view.headline, 'Version applied'); assert.equal(view.canApply, false);
  state.run!.status = 'running'; state.run!.events = [{ resourceId: 'neo-app', sequence: 1, status: 'deploying', action: 'update' }];
  state.run!.resources = state.graph!.resources.map(resource => ({ id: resource.id, status: resource.id === 'neo-app' ? 'deploying' : 'pending', action: resource.id === 'neo-app' ? 'update' : 'noop' }));
  assert.equal(projectBuildScene(state).headline, 'Updating Program');
});

test('Simple discloses failed later checks while retaining the applied version and native resource readiness', () => {
  const state = fixture(); state.revisionReview = { ...ready(state), status: 'applied', current: candidate,
    error: 'Connection verification needs attention.' };
  const before = structuredClone(state.run), view = projectRevisionReview(state)!;
  assert.equal(view.headline, 'Version applied · Checks need attention');
  assert.equal(view.currentLabel, 'Neo 2'); assert.equal(view.candidateLabel, undefined);
  assert.equal(view.canApply, false); assert.equal(view.canReview, true);
  assert.equal(view.state.error, 'Connection verification needs attention.');
  assert.deepEqual(state.run, before);
  assert.ok(projectBuildScene(state).nodes.every(node => node.status === 'ready'));
});

test('review JSON is detached and bounded, rejects executable metadata without invoking it', () => {
  const state = fixture(), review = ready(state), detached = readRevisionReview(review);
  detached.resources![0]!.changes = [{ path: '/changed', after: true }];
  assert.notDeepEqual(detached, review);
  let invoked = 0;
  const accessor = { ...review }; Object.defineProperty(accessor, 'resources', { enumerable: true, get() { invoked++; return []; } });
  assert.throws(() => readRevisionReview(accessor)); assert.equal(invoked, 0);
  assert.throws(() => readRevisionReview({ ...review, execute() {} }));
  assert.throws(() => readRevisionReview({ ...review, resources: [{ resourceId: 'x', action: 'replace' }] }));
  assert.throws(() => readRevisionReview({ ...review, resources: [{ resourceId: 'x', action: 'noop' }, { resourceId: 'x', action: 'update' }] }));
  assert.throws(() => readRevisionReview({ ...review, candidate: { ...candidate, digest: 'not-a-digest' } }));
  assert.throws(() => readRevisionReview({ ...review, resources: [{ resourceId: 'x', action: 'update', changes: [{ path: '/', after: Infinity }] }] }));
});
