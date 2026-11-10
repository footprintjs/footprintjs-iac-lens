import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileStateStore, InfraEngine, SimulatorAdapter, type ApplyResult } from 'footprint-iac';
import { compileGraph } from 'footprint-iac/graph';
import { createDeploymentRecorder } from 'footprint-iac/progress';
import { DashboardController, startDashboard } from '../src/server/index.ts';
import { projectSystemBlocks } from '../src/core/index.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }, options: {
  holdReady?: boolean; attachRecorder?: boolean; wrongGraph?: boolean; throws?: boolean;
  missingEvidence?: boolean; cachedResult?: boolean; wrongRun?: boolean; providerFailure?: boolean;
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'iac-managed-review-'));
  const staticDirectory = join(directory, 'public'); await mkdir(staticDirectory);
  await writeFile(join(staticDirectory, 'index.html'), '<!doctype html><title>Managed review fixture</title>');
  let release!: () => void, entered!: () => void, applies = 0, identityCalls = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  class Provider extends SimulatorAdapter {
    override async waitReady(): Promise<void> {
      if (options.holdReady) { entered(); await held; }
      await super.waitReady();
    }
  }
  const graph = compileGraph({ name: 'managed-review', boundaries: [], memberships: [], relations: [], resources: [
    { id: 'database', provider: 'simulator', spec: { version: 1 } },
    { id: 'application', provider: 'simulator', dependsOn: ['database'], spec: { version: 1 } },
  ] });
  const { digest: _digest, ...body } = graph;
  const appliedGraph = options.wrongGraph ? compileGraph({ ...body,
    resources: graph.resources.map(resource => ({ ...resource, spec: { version: 2 } })) }) : graph;
  const recorder = createDeploymentRecorder();
  const provider = new Provider({ file: join(directory, 'provider.json') });
  if (options.providerFailure) provider.faults.failBeforeApply = new Set(['application']);
  const engine = new InfraEngine({ adapters: [provider],
    store: new FileStateStore(join(directory, 'state')), traceDirectory: join(directory, 'traces'),
    recorders: options.attachRecorder === false ? [] : [recorder] });
  let cached: ApplyResult | undefined;
  const managedReview = { graph, recorder, label: 'Configured test deployment',
    apply: async (): Promise<ApplyResult> => {
      applies++;
      if (options.throws) throw Error('private-adapter-key-must-not-reach-the-viewer');
      if (options.cachedResult && cached) return cached;
      const result = await engine.apply(appliedGraph); cached = result;
      if (options.missingEvidence) await rm(result.evidencePath);
      return options.wrongRun ? { ...result, runId: 'foreign-run' } : result;
    } };
  const running = await startDashboard({ directory: join(directory, 'viewer'), staticDirectory, port: 0, managedReview,
    systemView: { blocks: [
      { id: 'compute', label: 'Compute', family: 'compute', units: [{ id: 'app', label: 'App', resourceIds: ['application'] }] },
      { id: 'storage', label: 'Storage', family: 'storage', units: [{ id: 'db', label: 'Database', resourceIds: ['database'] }] },
    ] },
    identityReview: { stack: graph.name, checks: [{ id: 'allowed', label: 'Allowed access', kind: 'access', expected: 'allowed' }],
      adapter: { async check() { identityCalls++; return { verdict: 'allowed', observedAt: Date.now(), latencyMs: 1 }; } } } });
  t.after(async () => { release(); await running.close(); await rm(directory, { recursive: true, force: true }); });
  const post = (body: unknown) => fetch(running.url + '/api/run', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { ...running, directory, managedReview, graph, recorder, post, waiting, release,
    applies: () => applies, identityCalls: () => identityCalls };
}

test('managed review starts pending, streams native deployment, and reapply records real no-ops', async t => {
  const running = await fixture(t, { holdReady: true });
  const initial = running.controller.getSnapshot();
  assert.equal(initial.graph?.digest, running.graph.digest);
  assert.equal(initial.mode, 'managed');
  assert.equal(initial.managedReviewAvailable, true);
  assert.equal(initial.managedReviewLabel, 'Configured test deployment');
  assert.ok(initial.run?.resources.every(resource => resource.status === 'pending'));
  assert.ok(projectSystemBlocks(initial).every(block => block.counts.pending === 1));
  assert.equal((await running.post({ scenario: 'identity' })).status, 409);
  assert.equal(running.identityCalls(), 0, 'access checks cannot run before the configured resources are ready');
  assert.equal((await running.post({ scenario: 'review' })).status, 202);
  await running.waiting;
  const inFlight = running.controller.getSnapshot();
  assert.equal(inFlight.run?.status, 'running');
  assert.ok(inFlight.run?.resources.some(resource => resource.status === 'deploying'));
  assert.ok(inFlight.run?.resources.every(resource => resource.status !== 'ready'));
  assert.ok(inFlight.run?.events.every(event => !!event.runtimeStageId));
  const activeBlocks = projectSystemBlocks(inFlight);
  assert.equal(activeBlocks.find(block => block.id === 'storage')?.counts.deploying, 1);
  assert.equal(activeBlocks.find(block => block.id === 'compute')?.counts.pending, 1);
  assert.equal((await running.post({ scenario: 'review' })).status, 409);
  running.release(); await running.controller.whenIdle();
  const completed = running.controller.getSnapshot();
  assert.equal(completed.run?.status, 'passed');
  assert.ok(completed.run?.resources.every(resource => resource.status === 'ready' && resource.action === 'create'));
  assert.equal(completed.run?.id, running.recorder.getSnapshot().runId);
  assert.ok(completed.run?.recording?.snapshot);
  assert.ok(projectSystemBlocks(completed).every(block => block.counts.ready === 1));
  const firstRun = completed.run!.id;
  assert.equal((await running.post({ scenario: 'review' })).status, 202);
  await running.controller.whenIdle();
  const reapplied = running.controller.getSnapshot();
  assert.equal(reapplied.run?.status, 'passed');
  assert.notEqual(reapplied.run?.id, firstRun);
  assert.ok(reapplied.run?.resources.every(resource => resource.action === 'noop' && resource.status === 'ready'));
  assert.equal(running.applies(), 2);
  assert.equal((await running.post({ scenario: 'identity' })).status, 202);
  await running.controller.whenIdle();
  assert.equal(running.controller.getSnapshot().identity?.status, 'passed');
  assert.equal(running.identityCalls(), 1);
});

test('a managed host accepts no browser-selected target, graph or simulator scenario', async t => {
  const running = await fixture(t);
  for (const scenario of ['demo', 'failure', 'neo', 'noop', 'connections']) {
    assert.equal((await running.post({ scenario })).status, 409, scenario);
  }
  for (const body of [{ scenario: 'review', target: '/tmp/foreign' }, { scenario: 'review', graph: running.graph }]) {
    assert.equal((await running.post(body)).status, 400);
  }
  assert.equal(running.applies(), 0);
  assert.throws(() => new DashboardController({ directory: running.directory, managedReview: running.managedReview,
    initialReview: { graph: running.graph, run: { id: 'recorded', status: 'passed', resources: [], events: [] } } }), /Choose/);
});

test('an actual apply without the configured native recorder remains an incomplete failed review', async t => {
  const running = await fixture(t, { attachRecorder: false });
  assert.equal((await running.post({ scenario: 'review' })).status, 202);
  await running.controller.whenIdle();
  const state = running.controller.getSnapshot();
  assert.equal(state.run?.status, 'failed');
  assert.ok(state.run?.resources.every(resource => resource.status === 'pending'));
  assert.match(JSON.stringify(state.run?.report), /progress/i);
  assert.equal((await running.post({ scenario: 'identity' })).status, 409);
});

test('a captured apply of a different graph never confirms the declared design', async t => {
  const running = await fixture(t, { wrongGraph: true });
  assert.equal((await running.post({ scenario: 'review' })).status, 202);
  await running.controller.whenIdle();
  const state = running.controller.getSnapshot();
  assert.equal(state.run?.status, 'failed');
  assert.ok(state.run?.resources.every(resource => resource.status !== 'ready'));
  assert.match(JSON.stringify(state.run?.report), /graph/i);
  assert.equal(state.run?.recording, undefined);
});

test('a failed trusted callback never leaks its private exception or falls back to a simulator', async t => {
  const running = await fixture(t, { throws: true });
  assert.equal((await running.post({ scenario: 'review' })).status, 202);
  await running.controller.whenIdle();
  const state = running.controller.getSnapshot();
  assert.equal(state.mode, 'managed');
  assert.equal(state.run?.status, 'failed');
  assert.ok(state.run?.resources.every(resource => resource.status === 'pending'));
  assert.ok(!JSON.stringify(state).includes('private-adapter-key'));
});

test('a cached prior result cannot replace the next native execution', async t => {
  const running = await fixture(t, { cachedResult: true });
  assert.equal((await running.post({ scenario: 'review' })).status, 202);
  await running.controller.whenIdle();
  assert.equal(running.controller.getSnapshot().run?.status, 'passed');
  assert.equal((await running.post({ scenario: 'review' })).status, 202);
  await running.controller.whenIdle();
  const next = running.controller.getSnapshot();
  assert.equal(next.run?.status, 'failed');
  assert.ok(next.run?.resources.every(resource => resource.status === 'pending'));
  assert.deepEqual(next.run?.events, []);
});

for (const [label, options] of [
  ['missing saved evidence', { missingEvidence: true }], ['a mismatched result run', { wrongRun: true }],
] as const) {
  test(`${label} cannot mark declared resources ready`, async t => {
    const running = await fixture(t, options);
    assert.equal((await running.post({ scenario: 'review' })).status, 202);
    await running.controller.whenIdle();
    const state = running.controller.getSnapshot();
    assert.equal(state.run?.status, 'failed');
    assert.ok(state.run?.resources.every(resource => resource.status !== 'ready'));
    assert.equal(state.run?.recording, undefined);
    assert.match(JSON.stringify(state.run?.report), /capture|evidence/i);
  });
}

test('provider failure remains failed with its genuine native outcomes and recording', async t => {
  const running = await fixture(t, { providerFailure: true });
  assert.equal((await running.post({ scenario: 'review' })).status, 202);
  await running.controller.whenIdle();
  const state = running.controller.getSnapshot();
  assert.equal(state.run?.status, 'failed');
  assert.equal(state.run?.resources.find(resource => resource.id === 'database')?.status, 'ready');
  assert.equal(state.run?.resources.find(resource => resource.id === 'application')?.status, 'failed');
  assert.ok(state.run?.recording?.snapshot);
  assert.equal((state.run?.report as { captureError?: string })?.captureError, undefined);
});

test('an unconfigured review is refused and graph accessors are not invoked during admission', async t => {
  const running = await fixture(t);
  const plain = new DashboardController({ directory: join(running.directory, 'plain') });
  assert.throws(() => plain.start('review'), /not configured/);
  let reads = 0;
  const unsafe = structuredClone(running.graph);
  Object.defineProperty(unsafe.resources[0]!.spec, 'unsafe', { enumerable: true, get() { reads++; throw Error('graph getter ran'); } });
  assert.throws(() => new DashboardController({ directory: join(running.directory, 'bad'),
    managedReview: { ...running.managedReview, graph: unsafe } }), /accessor|plain JSON|unsupported/i);
  assert.equal(reads, 0);
});
