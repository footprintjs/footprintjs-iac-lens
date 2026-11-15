import assert from 'node:assert/strict';
import test from 'node:test';
import { readApplicationAction, readApplicationView, type ApplicationView } from '../src/core/application.ts';
import { ApplicationReview, ApplicationRequestError } from '../src/server/application.ts';
import type { ApplicationHost, ApplicationHostSnapshot } from '../src/server/application-host.ts';

const selection = { strategyId: 'server', targetId: 'local' };
function fixture() {
  const calls: string[] = [], views: ApplicationView[] = [];
  let state: ApplicationHostSnapshot = { incomplete: false };
  const host: ApplicationHost = {
    version: 1, id: 'test-app', label: 'Test application',
    strategies: [{ id: 'server', label: 'Existing server', targets: [{ id: 'local', label: 'Registered server', requiresProfile: false,
      requiredInspectionCheckIds: ['target'], requiredVerificationCheckIds: ['health', 'login', 'allowed', 'denied'] }] }],
    async inspect() { calls.push('inspect'); return { ok: true, checks: [{ id: 'target', label: 'Target identity', status: 'passed' }] }; },
    async plan() { calls.push('plan'); return { ok: true, reviewId: 'sealed-one', changes: [{ resourceId: 'compute', label: 'Compute', action: 'update' }] }; },
    async apply(_input, publish) { calls.push('apply'); publish({ phase: 'verify' }); return { ok: true, promoted: true, status: 'promoted', appUrl: 'http://127.0.0.1:55230',
      checks: ['health', 'login', 'allowed', 'denied'].map(id => ({ id, label: id, status: 'passed' })) }; },
    async snapshot() { calls.push('snapshot'); return state; },
  };
  const review = new ApplicationReview(host, view => views.push(view));
  return { host, review, calls, views, setState(value: ApplicationHostSnapshot) { state = value; } };
}
async function reviewed(f: ReturnType<typeof fixture>) {
  await f.review.initialize(); f.review.action({ action: 'select', ...selection });
  f.review.action({ action: 'inspect' }); await f.review.whenIdle();
  f.review.action({ action: 'review' }); await f.review.whenIdle();
}
test('registered application controls inspect and review before one explicit verified apply', async () => {
  const f = fixture(); await f.review.initialize();
  assert.deepEqual(f.calls, ['snapshot']);
  assert.equal(f.review.snapshot().phase, 'choose');
  assert.throws(() => f.review.action({ action: 'deploy', reviewId: 'sealed-one' }), error => error instanceof ApplicationRequestError && error.status === 409);
  f.review.action({ action: 'select', ...selection });
  assert.deepEqual(f.calls, ['snapshot']);
  assert.equal(f.review.snapshot().canInspect, true);
  assert.throws(() => f.review.action({ action: 'review' }), /setup/i);
  f.review.action({ action: 'inspect' }); await f.review.whenIdle();
  assert.equal(f.review.snapshot().canReview, true);
  f.review.action({ action: 'review' }); await f.review.whenIdle();
  assert.equal(f.review.snapshot().canDeploy, true);
  assert.throws(() => f.review.action({ action: 'deploy', reviewId: 'foreign' }), /review/i);
  f.review.action({ action: 'deploy', reviewId: 'sealed-one' }); await f.review.whenIdle();
  assert.equal(f.review.snapshot().phase, 'ready'); assert.equal(f.review.snapshot().canDeploy, false);
  assert.ok(f.views.some(view => view.phase === 'verify' && view.busy));
  assert.deepEqual(f.calls, ['snapshot', 'inspect', 'plan', 'apply']);
  assert.throws(() => f.review.action({ action: 'deploy', reviewId: 'sealed-one' }), /review/i);
});
test('changing registered target or connection invalidates inspection and the sealed review', async () => {
  const f = fixture(); f.host.strategies[0]!.targets = [...f.host.strategies[0]!.targets, { ...f.host.strategies[0]!.targets[0]!, id: 'other', label: 'Other' }];
  // The constructor captures the catalog; later host mutations do not add a target.
  await reviewed(f);
  assert.throws(() => f.review.action({ action: 'select', strategyId: 'server', targetId: 'other' }), /registered/i);
  f.review.action({ action: 'inspect' }); await f.review.whenIdle();
  assert.equal(f.review.snapshot().review, undefined); assert.equal(f.review.snapshot().canDeploy, false);
});
test('a different admitted target clears every result before any provider inspection', async () => {
  const f = fixture(); f.host.strategies[0]!.targets = [...f.host.strategies[0]!.targets, { ...f.host.strategies[0]!.targets[0]!, id: 'other', label: 'Other server' }];
  const review = new ApplicationReview(f.host, () => {});
  await review.initialize(); review.action({ action: 'select', ...selection }); review.action({ action: 'inspect' }); await review.whenIdle();
  review.action({ action: 'review' }); await review.whenIdle(); assert.equal(review.snapshot().canDeploy, true);
  const before = [...f.calls]; review.action({ action: 'select', strategyId: 'server', targetId: 'other' });
  const next = review.snapshot(); assert.equal(next.inspection, undefined); assert.equal(next.review, undefined); assert.equal(next.deployment, undefined);
  assert.equal(next.phase, 'choose'); assert.equal(next.canDeploy, false); assert.deepEqual(f.calls, before);
});
test('a retained native review can reopen but cannot be resurrected after its local apply is consumed', async () => {
  const f = fixture(); f.setState({ selection, incomplete: false,
    inspection: { ok: true, checks: [{ id: 'target', label: 'Target', status: 'passed' }] }, review: { ok: true, reviewId: 'retained-review', changes: [] } });
  await f.review.initialize(); assert.equal(f.review.snapshot().canDeploy, true);
  f.review.action({ action: 'deploy', reviewId: 'retained-review' }); await f.review.whenIdle();
  f.review.action({ action: 'refresh' }); await f.review.whenIdle();
  assert.equal(f.review.snapshot().canDeploy, false);
  assert.throws(() => f.review.action({ action: 'deploy', reviewId: 'retained-review' }), /review/i);
  assert.equal(f.calls.filter(call => call === 'apply').length, 1);
});
test('missing required checks never become deployment readiness', async () => {
  const f = fixture(); const views: ApplicationView[] = [], publications: unknown[] = [];
  f.host.apply = async () => ({ ok: true, promoted: true, status: 'promoted', checks: [{ id: 'health', label: 'Health', status: 'passed' }],
    publication: { appAccess: { status: 'ready' }, neoUrl: 'http://127.0.0.1:55330' } });
  // Bind the method replacement before registration, as a trusted host would.
  const review = new ApplicationReview(f.host, (view, publication) => { views.push(view); if (publication) publications.push(publication); });
  await review.initialize(); review.action({ action: 'select', ...selection });
  review.action({ action: 'inspect' }); await review.whenIdle(); review.action({ action: 'review' }); await review.whenIdle();
  review.action({ action: 'deploy', reviewId: 'sealed-one' }); await review.whenIdle();
  assert.notEqual(review.snapshot().phase, 'ready'); assert.equal(review.snapshot().canDeploy, false);
  assert.equal(views.some(view => view.deployment?.promoted), false, 'subscribers must never observe an unqualified promoted candidate');
  assert.equal(JSON.stringify(publications).includes('55330'), false, 'candidate success publication must not escape before its verification checks are admitted');
});
test('a failed native refresh does not retain a current ready receipt or app link', async () => {
  const f = fixture(); let unavailable = false;
  f.host.snapshot = async () => { if (unavailable) throw Error('private-unreadable-state'); return { incomplete: false }; };
  const review = new ApplicationReview(f.host, () => {});
  await review.initialize(); review.action({ action: 'select', ...selection }); review.action({ action: 'inspect' }); await review.whenIdle();
  review.action({ action: 'review' }); await review.whenIdle(); review.action({ action: 'deploy', reviewId: 'sealed-one' }); await review.whenIdle();
  assert.equal(review.snapshot().deployment?.promoted, true); unavailable = true;
  review.action({ action: 'refresh' }); await review.whenIdle();
  assert.equal(review.snapshot().phase, 'incomplete'); assert.equal(review.snapshot().deployment?.promoted, false);
  assert.equal(review.snapshot().deployment?.appUrl, undefined); assert.equal(review.snapshot().canDeploy, false);
});
test('a failed fresh inspection cannot reuse an older successful measurement', async () => {
  const f = fixture(); let count = 0;
  f.host.inspect = async () => { if (++count > 1) throw Error('private-probe-failure'); return { ok: true, checks: [{ id: 'target', label: 'Target', status: 'passed' }] }; };
  const review = new ApplicationReview(f.host, () => {});
  await review.initialize(); review.action({ action: 'select', ...selection }); review.action({ action: 'inspect' }); await review.whenIdle();
  assert.equal(review.snapshot().canReview, true); review.action({ action: 'inspect' }); await review.whenIdle();
  assert.equal(review.snapshot().inspection, undefined); assert.equal(review.snapshot().canReview, false);
  assert.throws(() => review.action({ action: 'review' }), /setup/i);
});
test('ambiguous apply is retained as incomplete and cannot be retried or hidden by selecting a target', async () => {
  const f = fixture(); const secret = 'private-credential-that-must-not-leak';
  f.host.apply = async () => { throw Error(secret); };
  const review = new ApplicationReview(f.host, () => {});
  await review.initialize(); review.action({ action: 'select', ...selection }); review.action({ action: 'inspect' }); await review.whenIdle();
  review.action({ action: 'review' }); await review.whenIdle(); review.action({ action: 'deploy', reviewId: 'sealed-one' }); await review.whenIdle();
  assert.equal(review.snapshot().phase, 'incomplete'); assert.equal(review.snapshot().canReview, false);
  assert.equal(JSON.stringify(review.snapshot()).includes(secret), false);
  assert.throws(() => review.action({ action: 'deploy', reviewId: 'sealed-one' }), /review|recorded/i);
  f.setState({}); review.action({ action: 'refresh' }); await review.whenIdle();
  assert.equal(review.snapshot().phase, 'incomplete');
  f.setState({ selection, incomplete: false, deployment: { ok: false, promoted: false, status: 'verification-failed', checks: [] } });
  review.action({ action: 'refresh' }); await review.whenIdle();
  assert.equal(review.snapshot().phase, 'failed'); assert.equal(review.snapshot().canDeploy, false);
  review.action({ action: 'inspect' }); await review.whenIdle(); assert.equal(review.snapshot().canReview, true);
});
test('one operation runs at a time and completed callbacks cannot mutate another operation', async () => {
  const f = fixture(); let finish!: () => void, late!: Parameters<ApplicationHost['inspect']>[1];
  f.host.inspect = async (_input, publish) => { late = publish; await new Promise<void>(resolve => { finish = resolve; }); return { ok: true, checks: [{ id: 'target', label: 'Target', status: 'passed' }] }; };
  const review = new ApplicationReview(f.host, () => {});
  await review.initialize(); review.action({ action: 'select', ...selection }); review.action({ action: 'inspect' });
  assert.throws(() => review.action({ action: 'select', ...selection }), /finish/i);
  finish(); await review.whenIdle(); const before = review.snapshot(); late({ phase: 'verify' }); assert.deepEqual(review.snapshot(), before);
});
test('viewer progress admission cannot abort the host effect or disclose a malformed publication', async () => {
  const f = fixture(); const privateValue = 'private-progress-must-not-leak'; let returned = false; const published: unknown[] = [];
  const native = f.host.apply;
  f.host.apply = async (input, publish) => {
    publish({ password: privateValue } as never);
    publish({ neoUrl: 'javascript:unexpected()' });
    publish({ neoUrl: 'https://operator:' + privateValue + '@example.test' });
    publish({ appAccess: { status: 'ready', token: privateValue } } as never);
    const result = await native(input, publish); returned = true; return result;
  };
  const review = new ApplicationReview(f.host, (_view, patch) => { if (patch) published.push(patch); });
  await review.initialize(); review.action({ action: 'select', ...selection }); review.action({ action: 'inspect' }); await review.whenIdle();
  review.action({ action: 'review' }); await review.whenIdle(); review.action({ action: 'deploy', reviewId: 'sealed-one' }); await review.whenIdle();
  assert.equal(returned, true); assert.equal(review.snapshot().phase, 'ready'); assert.match(review.snapshot().error!, /native progress/i);
  assert.equal(JSON.stringify(review.snapshot()).includes(privateValue), false);
  assert.equal(JSON.stringify(published).includes(privateValue), false); assert.equal(JSON.stringify(published).includes('javascript:'), false);
});
test('unreadable startup history exposes only an incomplete state and fixed safe error', async () => {
  const f = fixture(); const privateValue = 'private-native-store-key'; f.host.snapshot = async () => { throw Error(privateValue); };
  const review = new ApplicationReview(f.host, () => {}); await review.initialize();
  assert.equal(review.snapshot().phase, 'incomplete'); assert.equal(review.snapshot().canDeploy, false);
  assert.equal(JSON.stringify(review.snapshot()).includes(privateValue), false);
});
test('application request and snapshot readers reject arbitrary executable parameters and contradictory readiness', () => {
  for (const input of [{ action: 'inspect', command: 'deploy' }, { action: 'select', ...selection, module: '/tmp/a.mjs' }, { action: 'deploy', reviewId: '../fake' }]) assert.throws(() => readApplicationAction(input));
  const f = fixture(), view = f.review.snapshot();
  assert.throws(() => readApplicationView({ ...view, phase: 'ready' }));
  assert.throws(() => readApplicationView({ ...view, canDeploy: true }));
  assert.throws(() => readApplicationView({ ...view, arbitrary: 'private' }));
  assert.throws(() => readApplicationView({ ...view, selection, phase: 'ready', deployment: { ok: true, promoted: true, status: 'promoted', checks: [{ id: 'health', label: 'Health', status: 'passed' }] } }));
  assert.throws(() => readApplicationView({ ...view, selection, phase: 'verify', busy: true, deployment: { ok: true, promoted: true, status: 'promoted', checks: [{ id: 'health', label: 'Health', status: 'passed' }] } }));
});
