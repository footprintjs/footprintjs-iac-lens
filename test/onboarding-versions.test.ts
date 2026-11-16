import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDashboardClient, readDashboardState } from '../src/core/client.ts';
import type { OnboardingAction } from '../src/core/onboarding.ts';
import type { OnboardingVersionAction } from '../src/core/onboarding-versions.ts';
import { startDashboard } from '../src/server/server.ts';
import { versionComposition } from './helpers/onboarding-versions.ts';
import { RecordedDiagnosticHistory } from '../src/server/recorded-diagnostics.ts';

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'lens-onboarding-versions-')); let app: Awaited<ReturnType<typeof startDashboard>> | undefined;
  t.after(async () => { await app?.close(); await rm(directory, { recursive: true, force: true }); });
  const composition = versionComposition(directory), staticDirectory = join(directory, 'web'); await mkdir(staticDirectory); await writeFile(join(staticDirectory, 'index.html'), 'Versioned setup fixture');
  app = await startDashboard({ directory: join(directory, 'viewer'), staticDirectory, onboarding: composition.host });
  const client = createDashboardClient({ baseUrl: app.url });
  const workflow = async (input: OnboardingAction) => { await client.onboarding(input); await app!.controller.whenIdle(); return client.getState(); };
  const version = async (input: OnboardingVersionAction) => { await client.onboardingVersion(input); await app!.controller.whenIdle(); return client.getState(); };
  const post = (input: unknown, headers: Record<string, string> = {}) => fetch(app!.url + '/api/onboarding/versions', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app!.url, ...headers }, body: JSON.stringify(input) });
  return { directory, app, client, workflow, version, post, ...composition };
}
async function deploy(f: Awaited<ReturnType<typeof fixture>>) {
  for (const action of ['discover', 'configure', 'verify', 'review'] as const) await f.workflow({ action });
  return f.workflow({ action: 'deploy', reviewId: (await f.client.getState()).onboarding!.review!.reviewId! });
}
test('version review is native and read-only; exact activation preserves v1 evidence and clears current resource/readiness publications', async t => {
  const f = await fixture(t); assert.deepEqual(f.calls, { guard: 0, check: 0, plan: 0, apply: 0, reconcile: 0 });
  await deploy(f); const before = await f.client.getState(), oldRun = before.onboarding!.recording!.runId;
  assert.equal(before.appAccess?.status, 'ready'); assert.ok(before.graph); const effects = { plan: f.calls.plan, apply: f.calls.apply };
  const reviewed = await f.version({ action: 'review-version', versionId: 'v2' });
  assert.deepEqual(reviewed.onboardingRegistry!.review!.changes.map(change => change.field), ['checks', 'profile', 'configuration']);
  assert.equal(reviewed.onboardingRegistry!.canActivate, true); assert.equal(reviewed.onboardingRegistry!.activeVersionId, 'v1');
  assert.equal((reviewed.onboardingRegistryRecording!.snapshot as { runId: string }).runId, reviewed.onboardingRegistry!.review!.recording!.runId);
  assert.deepEqual({ plan: f.calls.plan, apply: f.calls.apply }, effects);
  await assert.rejects(f.client.onboardingVersion({ action: 'activate-version', reviewId: 'other-review' }), /Review/i);
  f.modes.withholdPublication = true;
  const activated = await f.version({ action: 'activate-version', reviewId: reviewed.onboardingRegistry!.review!.reviewId });
  assert.equal(activated.onboardingRegistry!.head, 1); assert.equal(activated.onboardingRegistry!.activeVersionId, 'v2'); assert.equal(activated.onboarding!.status, 'idle');
  assert.equal(activated.graph, null); assert.equal(activated.neoUrl, undefined); assert.equal(activated.appAccess, undefined);
  assert.deepEqual(activated.artifacts!.filter(artifact => artifact.id !== 'recorded-diagnostics'), [], 'old application exports clear while the independent retained diagnostic history remains available');
  assert.ok(activated.onboarding!.stages.every(stage => stage.status === 'pending')); assert.equal(activated.onboardingRegistry!.history[0]!.workflow.recording!.runId, oldRun);
  f.emit({ head: 0, versionId: 'v1', publication: { graph: before.graph!, appAccess: { status: 'ready' }, neoUrl: 'http://127.0.0.1:55330' } });
  assert.equal(f.app.controller.getSnapshot().graph, null); assert.equal(f.app.controller.getSnapshot().appAccess, undefined);
  assert.deepEqual({ plan: f.calls.plan, apply: f.calls.apply }, effects);
  f.modes.withholdPublication = false; const after = await deploy(f); assert.equal(after.onboarding!.status, 'ready'); assert.equal(f.calls.apply, effects.apply + 1);
});
test('same active-version no-op keeps its head, native readiness and current graph', async t => {
  const f = await fixture(t); const before = await deploy(f), effects = { ...f.calls };
  const reviewed = await f.version({ action: 'review-version', versionId: 'v1' }); assert.equal(reviewed.onboardingRegistry!.review!.noop, true);
  const after = await f.version({ action: 'activate-version', reviewId: reviewed.onboardingRegistry!.review!.reviewId });
  assert.equal(after.onboardingRegistry!.head, 0); assert.equal(after.onboarding!.recording!.runId, before.onboarding!.recording!.runId); assert.equal(after.appAccess?.status, 'ready'); assert.deepEqual(after.graph, before.graph);
  assert.equal(f.calls.plan, effects.plan); assert.equal(f.calls.apply, effects.apply);
});
test('old host uncertainty and outstanding resource reviews block configuration activation without hiding their native IDs', async t => {
  const f = await fixture(t); await deploy(f); f.modes.host = 'unknown';
  const blocked = await f.version({ action: 'review-version', versionId: 'v2' }); assert.equal(blocked.onboardingRegistry!.canActivate, false);
  assert.ok(blocked.onboardingRegistry!.review!.blockers.some(blocker => blocker.kind === 'host' && blocker.runId === 'host-observation-v1'));
  assert.equal(blocked.appAccess, undefined); assert.equal(f.calls.apply, 1);
  f.modes.host = 'closed'; await f.workflow({ action: 'review' });
  const queued = await f.version({ action: 'review-version', versionId: 'v2' }); assert.ok(queued.onboardingRegistry!.review!.blockers.some(blocker => blocker.kind === 'onboarding' && blocker.status === 'pending'));
  assert.equal(queued.onboarding!.canDeploy, true, 'the original admitted resource review may finish before updating configuration');
  await f.workflow({ action: 'deploy', reviewId: queued.onboarding!.review!.reviewId! });
  assert.equal((await f.version({ action: 'review-version', versionId: 'v2' })).onboardingRegistry!.canActivate, true);
});
test('dual incomplete outcomes can inspect the original active owner before reconciling the registry', async t => {
  const f = await fixture(t); for (const action of ['discover', 'configure', 'verify', 'review'] as const) await f.workflow({ action });
  const resourceReview = (await f.client.getState()).onboarding!.review!.reviewId!; f.modes.uncertainApply = true;
  await f.workflow({ action: 'deploy', reviewId: resourceReview }); f.modes.captureLoss = true;
  const uncertain = await f.version({ action: 'review-version', versionId: 'v2' });
  assert.equal(uncertain.onboardingRegistry!.status, 'incomplete'); assert.equal(uncertain.onboarding!.status, 'incomplete'); assert.equal(uncertain.onboarding!.canReconcile, true);
  assert.equal(uncertain.onboarding!.canDeploy, false); assert.equal(uncertain.onboarding!.canDiscover, false);
  const updateReview = uncertain.onboardingRegistry!.review!.reviewId;
  f.modes.captureLoss = false;
  await f.workflow({ action: 'reconcile', reviewId: resourceReview }); assert.equal(f.calls.reconcile, 1); assert.equal(f.calls.apply, 1);
  const closed = await f.version({ action: 'reconcile-activation', reviewId: updateReview });
  assert.equal(closed.onboardingRegistry!.status, 'idle'); assert.equal(closed.onboardingRegistry!.head, 0); assert.equal(closed.onboardingRegistry!.activeVersionId, 'v1'); assert.equal(closed.onboardingRegistry!.canReview, true);
});
test('version endpoint rejects browser executable/configuration input, bad origins, oversized bodies and stale reviews', async t => {
  const f = await fixture(t);
  assert.equal((await f.post({ action: 'review-version', versionId: 'v2' }, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await f.post({ action: 'review-version', versionId: 'v2' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.post({ action: 'review-version', versionId: 'v2', padding: 'x'.repeat(2050) })).status, 413);
  for (const input of [{ action: 'review-version', versionId: 'v2', command: 'restart' }, { action: 'activate-version', reviewId: 'x', config: {} }, { action: 'review-version', versionId: 'missing' }]) assert.equal((await f.post(input)).status, 400);
  const first = await f.version({ action: 'review-version', versionId: 'v2' }); await f.version({ action: 'review-version', versionId: 'v1' });
  assert.equal((await f.post({ action: 'activate-version', reviewId: first.onboardingRegistry!.review!.reviewId })).status, 409);
  assert.equal(f.calls.plan, 0); assert.equal(f.calls.apply, 0);
});
test('read-only reopening keeps old failure/version lineage and native captures after activation', async t => {
  const f = await fixture(t); await f.workflow({ action: 'discover' }); await f.workflow({ action: 'configure' }); f.modes.connection = false;
  const failed = await f.workflow({ action: 'verify' }), failureRun = failed.onboarding!.recording!.runId;
  f.modes.connection = true; await f.workflow({ action: 'verify' }); await f.workflow({ action: 'review' }); await f.workflow({ action: 'deploy', reviewId: (await f.client.getState()).onboarding!.review!.reviewId! });
  const original = (await f.client.getState()).recordedDiagnostics!.runs.find(run => run.runId === failureRun)!;
  const reviewed = await f.version({ action: 'review-version', versionId: 'v2' }); await f.version({ action: 'activate-version', reviewId: reviewed.onboardingRegistry!.review!.reviewId });
  const state = await f.client.getState(); assert.equal(JSON.stringify(state.recordedDiagnostics!.runs.find(run => run.runId === failureRun)), JSON.stringify(original));
  assert.equal(original.configurationVersion!.versionId, 'v1'); assert.equal(original.configurationVersion!.head, 0);
  const effects = { ...f.calls }; await f.version({ action: 'refresh' }); assert.deepEqual(f.calls, effects);
  const { DashboardController } = await import('../src/server/controller.ts'); const restored = new DashboardController({ directory: join(f.directory, 'viewer'), onboarding: f.host }); t.after(() => restored.dispose()); await restored.initialize();
  assert.deepEqual(f.calls, effects); assert.equal(restored.getSnapshot().onboardingRegistry!.activeVersionId, 'v2'); assert.equal(restored.getSnapshot().recordedDiagnostics!.runs.find(run => run.runId === failureRun)!.configurationVersion!.versionId, 'v1');
  const forged = { ...state, onboarding: failed.onboarding }; assert.throws(() => readDashboardState(forged), /differs/);
  assert.ok((await readdir(join(f.directory, 'registry'))).some(name => name.endsWith('.jsonl'))); assert.equal((await readFile(join(f.directory, 'registry', 'onboarding-versions.json'), 'utf8')).includes('PRIVATE_ADAPTER_EXCEPTION'), false);
});
test('an exact retained legacy viewer history is archived unchanged and gains explicitly inferred version association', async t => {
  const f = await fixture(t); await f.workflow({ action: 'discover' }); await f.workflow({ action: 'configure' }); f.modes.connection = false;
  const state = await f.workflow({ action: 'verify' }), directory = join(f.directory, 'legacy-viewer'); await mkdir(directory);
  const legacy = { ...state, onboardingRegistry: undefined, onboardingRegistryRecording: undefined, recordedDiagnostics: undefined };
  const oldHistory = new RecordedDiagnosticHistory(directory, () => assert.fail('legacy persistence failed')); await oldHistory.initialize(legacy);
  const path = join(directory, 'recorded-diagnostics.json'), original = await readFile(path, 'utf8'), prior = oldHistory.snapshot()!;
  const adopted = new RecordedDiagnosticHistory(directory, () => assert.fail('adoption persistence failed')); await adopted.initialize(state);
  const retained = adopted.snapshot()!.runs.find(run => run.runId === state.onboarding!.recording!.runId)!;
  assert.equal(retained.configurationVersion!.versionId, 'v1'); assert.equal(retained.configurationVersion!.association, 'matched-legacy-binding');
  assert.equal(await readFile(join(directory, 'recorded-diagnostics-legacy-' + prior.binding + '.json'), 'utf8'), original);
  const { configurationVersion: _version, ...unchanged } = retained; assert.deepEqual(unchanged, prior.runs.find(run => run.runId === retained.runId));
  assert.notEqual(JSON.parse(await readFile(path, 'utf8')).binding, prior.binding);
});
test('a different legacy configuration remains quarantined without rewriting its original report', async t => {
  const f = await fixture(t), state = await f.workflow({ action: 'discover' }), directory = join(f.directory, 'unmatched-viewer'); await mkdir(directory);
  const old = new RecordedDiagnosticHistory(directory, () => assert.fail('old persistence failed')); await old.initialize({ ...state, onboardingRegistry: undefined, onboardingRegistryRecording: undefined, onboarding: { ...state.onboarding!, configurationDigest: '9'.repeat(64) } });
  const path = join(directory, 'recorded-diagnostics.json'), content = await readFile(path, 'utf8');
  const current = new RecordedDiagnosticHistory(directory, () => assert.fail('unmatched history must not be replaced')); await current.initialize(state);
  assert.equal(await readFile(path, 'utf8'), content); assert.ok(current.snapshot()!.limitations!.some(text => text.includes('another system')));
  assert.equal((await readdir(directory)).some(name => name.startsWith('recorded-diagnostics-legacy-')), false);
});
