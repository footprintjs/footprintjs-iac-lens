import assert from 'node:assert/strict';
import test from 'node:test';
import { readHostActionInput, readHostActionReceipt, readHostActionsView, type HostActionControl, type HostActionsView } from '../src/core/host-actions.ts';
import { HostActionRequestError, HostActionReview } from '../src/server/host-actions.ts';

test('configured action runner preserves method receivers, publishes native receipts and refuses caller parameters', async () => {
  class Control implements HostActionControl {
    id = 'pause-owned-service'; label = 'Pause owned service'; runId = 'owned-native-run';
    async execute() { return { ok: true, runId: this.runId, resourceId: 'owned-service',
      recording: { snapshot: { runId: this.runId, commitLog: [] }, structure: { stages: [] } } }; }
  }
  const views: HostActionsView[] = [], review = new HostActionReview([new Control()], view => views.push(view));
  assert.deepEqual(review.snapshot(), { controls: [{ id: 'pause-owned-service', label: 'Pause owned service' }], busy: false, history: [] });
  assert.throws(() => review.action({ actionId: 'unknown' }), error => error instanceof HostActionRequestError && error.status === 400);
  assert.throws(() => review.action({ actionId: 'pause-owned-service', endpoint: 'http://unapproved.example' } as never), /configured action/);
  review.action({ actionId: 'pause-owned-service' });
  assert.equal(review.isBusy, true); await review.whenIdle(); assert.equal(review.isBusy, false);
  assert.equal(views[0]?.history[0]?.status, 'running');
  const final = review.snapshot(), action = final.history[0]!;
  assert.equal(action.status, 'passed'); assert.equal(action.receipt?.runId, 'owned-native-run');
  assert.equal((action.receipt?.recording?.snapshot as { runId: string }).runId, 'owned-native-run');
  assert.ok(action.finishedAt! >= action.startedAt);
  final.history[0]!.label = 'viewer mutation'; assert.equal(review.snapshot().history[0]?.label, 'Pause owned service');
});

test('one configured operation runs at a time and failed callbacks never expose private exceptions', async () => {
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const privateValue = 'private-host-credential-must-not-leak';
  const review = new HostActionReview([
    { id: 'wait', label: 'Wait for owned action', async execute() { calls++; await gate; return { ok: true, runId: 'wait-run' }; } },
    { id: 'fail', label: 'Fail configured action', async execute() { throw Error(privateValue); } },
  ], () => {});
  review.action({ actionId: 'wait' });
  assert.throws(() => review.action({ actionId: 'fail' }), error => error instanceof HostActionRequestError && error.status === 409);
  assert.equal(calls, 1); release(); await review.whenIdle();
  review.action({ actionId: 'fail' }); await review.whenIdle();
  assert.equal(review.snapshot().history[1]?.status, 'failed');
  assert.equal(JSON.stringify(review.snapshot()).includes(privateValue), false);
  assert.equal(review.snapshot().history[0]?.receipt?.runId, 'wait-run');
});

test('action evidence capture uncertainty retains the confirmed operation receipt without inventing a recording', async () => {
  const review = new HostActionReview([{ id: 'owned-action', label: 'Owned action', async execute() {
    return { ok: true, runId: 'confirmed-native-run', evidencePath: '/private/owned-native-run.json', captureError: 'Native recording unavailable' };
  } }], () => {});
  review.action({ actionId: 'owned-action' }); await review.whenIdle();
  const run = review.snapshot().history[0]!;
  assert.equal(run.status, 'passed'); assert.equal(run.receipt?.runId, 'confirmed-native-run');
  assert.equal(run.receipt?.recording, undefined); assert.equal(run.receipt?.captureError, 'Native recording unavailable');
});

test('action protocol rejects extra fields and impossible histories', () => {
  assert.throws(() => readHostActionInput({ actionId: '../command' }));
  assert.throws(() => readHostActionInput({ actionId: 'owned', arguments: ['delete'] }));
  assert.throws(() => readHostActionReceipt({ ok: true, password: 'unexpected' }));
  assert.throws(() => readHostActionsView({ controls: [{ id: 'owned', label: 'Owned' }], busy: true, history: [] }));
  assert.throws(() => readHostActionsView({ controls: [{ id: 'owned', label: 'Owned' }], busy: false,
    history: [{ invocationId: 'one', actionId: 'owned', label: 'Owned', status: 'passed', startedAt: 2, finishedAt: 1 }] }));
});
