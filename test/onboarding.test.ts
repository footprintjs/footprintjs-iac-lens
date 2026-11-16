import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createOnboardingPreset, type OnboardingAction, type OnboardingSnapshot } from 'footprintjs-iac/onboarding';
import { OnboardingWorkflow } from 'footprintjs-iac/onboarding/node';
import { createDashboardClient, readDashboardState } from '../src/core/client.ts';
import { startDashboard } from '../src/server/server.ts';
import { DashboardController } from '../src/server/controller.ts';
import type { OnboardingHost } from '../src/server/onboarding-host.ts';

const secret = 'PRIVATE_PROVIDER_CREDENTIAL_NEVER_PUBLIC';
async function fixture(t: test.TestContext, options: { holdRediscovery?: Promise<void> } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lens-onboarding-'));
  let running: Awaited<ReturnType<typeof startDashboard>> | undefined;
  t.after(async () => { await running?.close(); await rm(directory, { recursive: true, force: true }); });
  const staticDirectory = join(directory, 'web'); await mkdir(staticDirectory); await writeFile(join(staticDirectory, 'index.html'), 'Onboarding Lens');
  const calls = { discover: 0, configure: 0, verify: 0, plan: 0, apply: 0, reconcile: 0, snapshot: 0 };
  let connected = true, uncertain = false, accessReady = true;
  let native: unknown = {};
  const checkAdapter = (name: 'discover' | 'configure' | 'verify') => ({ id: name, configurationDigest: 'b'.repeat(64), requiredCheckIds: [name], async run() {
    calls[name]++; if (name === 'discover' && calls.discover > 1 && options.holdRediscovery) await options.holdRediscovery;
    return [{ id: name, label: name === 'verify' ? 'Required connection' : name, status: name === 'verify' && !connected ? 'failed' as const : 'passed' as const }];
  } });
  const preset = createOnboardingPreset({ definition: { version: 1, id: 'existing-app', label: 'Existing application', strategyId: 'systemd', targetId: 'office-server', configurationDigest: 'a'.repeat(64) },
    deployment: { id: 'systemd', kind: 'systemd',
      async plan() { calls.plan++; return { ok: true, reviewId: 'native-review-' + calls.plan }; },
      async apply() { calls.apply++; if (uncertain) throw Error(secret); return { ok: accessReady, promoted: accessReady, status: accessReady ? 'promoted' : 'verification-failed',
        checks: ['health', 'login', 'allowed', 'denied'].map(id => ({ id, label: id, status: id === 'login' && !accessReady ? 'failed' as const : 'passed' as const })) }; },
      async reconcile(input) { calls.reconcile++; return { ok: false, promoted: false, status: 'reconciled-failed', reviewId: input }; },
      async snapshot() { calls.snapshot++; return native; },
    },
    adapters: { discover: checkAdapter('discover'), configure: checkAdapter('configure'), verify: checkAdapter('verify') },
    projectReview: () => [{ resourceId: 'app-service', label: 'Application service', action: 'noop' }],
    projectDeployment: result => (result as { checks: OnboardingSnapshot['checks'] }).checks,
  });
  const workflow = new OnboardingWorkflow({ preset, directory: join(directory, 'native') });
  const host: OnboardingHost = { version: 1, workflow, async publication() {
    const view = await workflow.snapshot();
    return view.status === 'ready' ? { neoUrl: 'http://127.0.0.1:55330', appAccess: { status: 'ready' } } : { neoUrl: undefined, appAccess: undefined };
  } };
  const app = await startDashboard({ directory: join(directory, 'lens'), staticDirectory, onboarding: host });
  running = app;
  const client = createDashboardClient({ baseUrl: app.url });
  const post = (body: unknown, headers: Record<string, string> = {}, path = '/api/onboarding') => fetch(app.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url, ...headers }, body: JSON.stringify(body) });
  const action = async (input: OnboardingAction) => { await client.onboarding(input); await app.controller.whenIdle(); return (await client.getState()).onboarding!; };
  return { app, client, post, workflow, host, calls, action, setConnected(value: boolean) { connected = value; }, setUncertain(value: boolean) { uncertain = value; }, setAccessReady(value: boolean) { accessReady = value; }, setNative(value: unknown) { native = value; } };
}

async function review(f: Awaited<ReturnType<typeof fixture>>) {
  for (const action of ['discover', 'configure', 'verify', 'review'] as const) await f.action({ action });
  return (await f.client.getState()).onboarding!.review!.reviewId!;
}
test('native onboarding reuses one controller, records each stage and restores retained status without effects', async t => {
  const f = await fixture(t), initial = await f.client.getState();
  assert.equal(initial.mode, 'managed'); assert.equal(initial.graph, null); assert.equal(initial.run, undefined); assert.equal(initial.onboarding!.status, 'idle');
  assert.deepEqual(Object.values(f.calls), [0, 0, 0, 0, 0, 0, 0]);
  await f.action({ action: 'refresh' }); assert.deepEqual(Object.values(f.calls), [0, 0, 0, 0, 0, 0, 0]);
  const reviewId = await review(f); assert.equal(f.calls.apply, 0); assert.equal((await f.client.getState()).onboarding!.canDeploy, true);
  await f.action({ action: 'deploy', reviewId }); const state = await f.client.getState();
  assert.equal(state.onboarding!.status, 'ready'); assert.equal(state.onboarding!.deployment!.promoted, true); assert.equal(state.neoUrl, 'http://127.0.0.1:55330');
  assert.deepEqual(state.onboarding!.deployment!.checks!.map(check => check.id), ['health', 'login', 'allowed', 'denied']);
  assert.deepEqual(state.onboarding!.checks, state.onboarding!.deployment!.checks);
  assert.equal((state.onboardingRecording!.snapshot as { runId: string }).runId, state.onboarding!.recording!.runId);
  assert.ok((state.onboardingRecording!.snapshot as { commitLog: unknown[] }).commitLog.length > 0);
  assert.equal(f.calls.apply, 1); await f.action({ action: 'refresh' }); assert.equal(f.calls.apply, 1);
  await assert.rejects(f.client.onboarding({ action: 'deploy', reviewId }), /recorded onboarding/i);
  assert.equal(JSON.stringify(state).includes(secret), false);
});
test('post-deployment login failure is recorded without promotion and a reviewed recovery has new native checks', async t => {
  const f = await fixture(t), reviewId = await review(f); f.setAccessReady(false);
  const failed = await f.action({ action: 'deploy', reviewId });
  assert.equal(failed.status, 'failed'); assert.equal(failed.deployment!.status, 'verification-failed'); assert.equal(failed.deployment!.promoted, false);
  assert.equal(failed.deployment!.checks!.find(check => check.id === 'login')!.status, 'failed'); assert.equal((await f.client.getState()).neoUrl, undefined);
  const failedRun = failed.recording!.runId;
  f.setAccessReady(true); const next = await f.action({ action: 'review' }); assert.notEqual(next.review!.reviewId, reviewId);
  const recovered = await f.action({ action: 'deploy', reviewId: next.review!.reviewId! });
  assert.equal(recovered.status, 'ready'); assert.equal(recovered.deployment!.checks!.every(check => check.status === 'passed'), true); assert.notEqual(recovered.recording!.runId, failedRun);
  assert.equal(f.calls.apply, 2);
});
test('rediscovery immediately clears a previous ready access badge even without a new native publication', async t => {
  let release!: () => void; const held = new Promise<void>(accept => { release = accept; });
  const f = await fixture(t, { holdRediscovery: held });
  const reviewId = await review(f); await f.action({ action: 'deploy', reviewId });
  assert.equal((await f.client.getState()).appAccess?.status, 'ready');
  try {
    f.app.controller.onboardingAction({ action: 'discover' });
    const immediate = f.app.controller.getSnapshot(); assert.equal(immediate.busy, true); assert.equal(immediate.appAccess, undefined); assert.equal(immediate.neoUrl, undefined);
    const running = await f.client.getState(); assert.equal(running.busy, true); assert.notEqual(running.appAccess?.status, 'ready'); assert.equal(running.neoUrl, undefined);
  } finally { release(); await f.app.controller.whenIdle(); }
  const discovered = await f.client.getState(); assert.equal(discovered.onboarding!.status, 'discovered'); assert.notEqual(discovered.appAccess?.status, 'ready');
});
test('connection failure blocks planning and deployment, then same native setup verifies and recovers', async t => {
  const f = await fixture(t); await f.action({ action: 'discover' }); await f.action({ action: 'configure' });
  f.setConnected(false); const failed = await f.action({ action: 'verify' });
  assert.equal(failed.status, 'failed'); assert.equal(failed.checks[0]!.status, 'failed'); assert.equal(failed.canReview, false);
  const failure = (await f.client.getState()).recordedDiagnostics!.runs.find(run => run.runId === failed.recording!.runId)!;
  assert.equal(failure.outcome, 'failed'); assert.equal(failure.targets[0]!.trace?.status, 'available');
  const originalFailure = JSON.stringify(failure);
  assert.equal((await f.post({ action: 'review' })).status, 409); assert.equal(f.calls.plan, 0); assert.equal(f.calls.apply, 0);
  f.setConnected(true); await f.action({ action: 'verify' }); const ready = await f.action({ action: 'review' });
  await f.action({ action: 'deploy', reviewId: ready.review!.reviewId! }); assert.equal((await f.client.getState()).onboarding!.status, 'ready');
  const history = (await f.client.getState()).recordedDiagnostics!;
  assert.equal(JSON.stringify(history.runs.find(run => run.runId === failed.recording!.runId)), originalFailure);
  assert.ok(history.runs.some(run => run.outcome === 'passed' && run.runId !== failed.recording!.runId));
  assert.equal(f.calls.discover, 1); assert.equal(f.calls.configure, 1); assert.equal(f.calls.verify, 2); assert.equal(f.calls.apply, 1);
});
test('uncertain deployment has no ready link, native inspection closes failure and a new review recovers', async t => {
  const f = await fixture(t), reviewId = await review(f); f.setUncertain(true);
  const result = await f.action({ action: 'deploy', reviewId }); assert.equal(result.status, 'incomplete'); assert.equal(result.canDeploy, false); assert.equal(result.canReconcile, true);
  assert.equal((await f.client.getState()).neoUrl, undefined); assert.equal(JSON.stringify(await f.client.getState()).includes(secret), false);
  await assert.rejects(f.client.onboarding({ action: 'deploy', reviewId }), /recorded onboarding/i);
  await f.action({ action: 'reconcile', reviewId }); assert.equal(f.calls.reconcile, 1); assert.equal(f.calls.apply, 1);
  f.setUncertain(false); const next = await review(f); assert.notEqual(next, reviewId);
  await f.action({ action: 'deploy', reviewId: next }); assert.equal((await f.client.getState()).onboarding!.status, 'ready'); assert.equal(f.calls.apply, 2);
});
test('onboarding transport rejects foreign origins, executable input, stale reviews and competing deployment doors', async t => {
  const f = await fixture(t);
  assert.equal((await f.post({ action: 'discover' }, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await f.post({ action: 'discover' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.post({ action: 'discover', padding: 'x'.repeat(2050) })).status, 413);
  for (const body of [{ action: 'discover', command: 'restart' }, { action: 'configure', secret }, { action: 'verify', targetId: 'other' }, { action: 'deploy', reviewId: '../other' }]) assert.equal((await f.post(body)).status, 400);
  assert.equal((await f.post({ scenario: 'demo' }, {}, '/api/run')).status, 409);
  const reviewId = await review(f); assert.equal((await f.post({ action: 'deploy', reviewId: 'different' })).status, 409); assert.equal(f.calls.apply, 0);
  assert.equal((await f.post({ action: 'configure', reviewId })).status, 400);
  assert.throws(() => new DashboardController({ directory: '/private/unused', onboarding: f.host, initialScenario: 'neo' }), /one registered onboarding/);
});
test('dashboard admission keeps onboarding source identity and native run evidence bound to one owner', async t => {
  const f = await fixture(t); await f.action({ action: 'discover' }); const state = await f.client.getState();
  assert.throws(() => readDashboardState({ ...state, onboardingRecording: { ...state.onboardingRecording, snapshot: { runId: 'other-run' } } }), /another run/);
  assert.throws(() => readDashboardState({ ...state, target: { id: 'other-target' } }), /another target/);
  const view = state.onboarding as OnboardingSnapshot;
  assert.equal(view.strategyId, 'systemd'); assert.equal(view.targetId, 'office-server');
  assert.throws(() => readDashboardState({ ...state, onboarding: { ...view, canDeploy: true } }));
});
