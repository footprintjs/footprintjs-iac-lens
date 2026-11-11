import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileStateStore, InfraEngine, SimulatorAdapter, infra, resource } from 'footprint-iac';
import { createDeploymentRecorder } from 'footprint-iac/progress';
import type { ConnectionAdapter } from 'footprint-iac/connections';
import { readDashboardState } from '../src/core/client.ts';
import { untestedConnections } from '../src/core/connections.ts';
import type { DashboardRun, DashboardState } from '../src/core/types.ts';
import { DashboardController, RequestError, startDashboard } from '../src/server/index.ts';
import { readConnectionReview, runConnectionReview } from '../src/server/run-connections.ts';

async function directory(t: { after(fn: () => Promise<void>): void }) {
  const path = await mkdtemp(join(tmpdir(), 'iac-configured-connections-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
function graph() {
  const app = resource('app', 'simulator', { kind: 'Deployment' });
  const service = { ...resource('service', 'simulator', { kind: 'Service' }), dependsOn: ['app'] };
  return infra('configured-connections').resource(app).resource(service).connect(service, app, 'communicatesWith').synth();
}
function deployed(): DashboardRun {
  return { id: 'recorded-deployment', status: 'passed', mode: 'managed', events: [],
    resources: graph().resources.map(item => ({ id: item.id, status: 'ready' })) };
}
const successfulAdapter: ConnectionAdapter = {
  async check(request) {
    return { method: 'fixture HTTP', target: `http://${request.from.id}/${request.to.id}`, observedAt: Date.now(), latencyMs: 2,
      details: { status: 200, source: 'owned fixture' } };
  },
};

test('a recorded host streams configured checking, connected, failed and recovered evidence without changing deployment outcomes', async t => {
  const path = await directory(t), publicPath = join(path, 'public');
  await mkdir(publicPath); await writeFile(join(publicPath, 'index.html'), '<!doctype html><title>Connection host</title>');
  let fail = false, calls = 0, entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const connectionId = untestedConnections(graph()).checks[0]!.connectionId;
  const scopes = { [connectionId]: 'Measured from the owned fixture through its configured HTTP route.' };
  const app = await startDashboard({ directory: join(path, 'viewer'), staticDirectory: publicPath,
    initialReview: { graph: graph(), run: deployed() }, connectionReview: {
      label: 'Configured network checks', description: 'One measured fixture path.', scopes,
      adapter: { async check(request) {
        calls++; if (calls === 1) { entered(); await held; }
        if (fail) throw Error('Configured route is unavailable');
        return successfulAdapter.check(request);
      } },
    } });
  t.after(async () => { release(); await app.close(); });
  scopes[connectionId] = 'A later mutation must not change the admitted host scope.';
  const initial = app.controller.getSnapshot(), before = structuredClone(initial.run);
  assert.equal(initial.deploymentReadOnly, true);
  assert.equal(initial.connectionReviewAvailable, true);
  assert.equal(initial.connections?.checks[0]?.status, 'untested');
  assert.equal(initial.connections?.label, 'Configured network checks');
  assert.match(initial.connections!.checks[0]!.scopeDescription!, /Measured from the owned fixture/);
  const updates: DashboardState[] = [];
  const invalidFrames: unknown[] = [];
  const unsubscribe = app.controller.subscribe(() => {
    const state = app.controller.getSnapshot();
    try { readDashboardState(JSON.parse(JSON.stringify(state))); } catch (error) { invalidFrames.push(error); }
    updates.push(state);
  });
  t.after(unsubscribe);
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(app.url + '/api/run', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await post({ scenario: 'connections', target: '/tmp/arbitrary' })).status, 400);
  assert.equal((await post({ scenario: 'connections' }, { origin: 'https://hostile.invalid' })).status, 403);
  assert.equal((await post({ scenario: 'connections' })).status, 202);
  await waiting;
  assert.equal(app.controller.getSnapshot().connections?.checks[0]?.status, 'checking');
  assert.equal((await post({ scenario: 'connections' })).status, 409);
  release(); await app.controller.whenIdle();
  const connected = app.controller.getSnapshot();
  assert.equal(connected.connections?.status, 'passed');
  assert.deepEqual(connected.run, before);
  assert.deepEqual(connected.connections?.events.map(event => event.status), ['checking', 'connected']);
  assert.ok(connected.connections?.events.every(event => event.scopeDescription?.startsWith('Measured from')));
  assert.ok(connected.connections?.recording?.snapshot && connected.connections.recording.structure);
  const originalEvidencePath = connected.connections!.report!.evidencePath!;
  const evidence = JSON.parse(await readFile(originalEvidencePath, 'utf8'));
  assert.equal(evidence.runId, connected.connections?.id);
  assert.equal(evidence.scopes[connectionId], initial.connections?.checks[0]?.scopeDescription);
  assert.ok(evidence.events.every((event: Record<string, unknown>) => event.scopeDescription === undefined), 'host metadata must not rewrite captured native events');
  fail = true; assert.equal((await post({ scenario: 'connections' })).status, 202); await app.controller.whenIdle();
  const failed = app.controller.getSnapshot();
  assert.equal(failed.connections?.status, 'failed');
  assert.equal(failed.connections?.checks[0]?.status, 'failed');
  assert.deepEqual(failed.run, before);
  assert.notEqual(failed.connections?.id, connected.connections?.id);
  fail = false; assert.equal((await post({ scenario: 'connections' })).status, 202); await app.controller.whenIdle();
  const recovered = app.controller.getSnapshot();
  assert.equal(recovered.connections?.checks[0]?.status, 'connected');
  assert.notEqual(recovered.connections?.id, failed.connections?.id);
  assert.equal(calls, 3);
  assert.deepEqual(invalidFrames, []);
  assert.ok(updates.some(state => state.connections?.checks[0]?.status === 'checking'));
  assert.equal((JSON.parse(await readFile(originalEvidencePath, 'utf8'))).runId, connected.connections?.id);
  const persisted = JSON.parse(await readFile(join(path, 'viewer/latest.json'), 'utf8'));
  assert.equal(readDashboardState(persisted).connections?.id, recovered.connections?.id);
});

test('managed deployment automatically records configured connection failures and recovery, then clears prior checks on reapply', async t => {
  const path = await directory(t), desired = graph();
  const recorder = createDeploymentRecorder();
  const engine = new InfraEngine({ adapters: [new SimulatorAdapter({ file: join(path, 'provider.json') })],
    store: new FileStateStore(join(path, 'state')), traceDirectory: join(path, 'traces'), recorders: [recorder], chartObservers: [recorder] });
  let fail = true, calls = 0;
  const controller = new DashboardController({ directory: join(path, 'viewer'), managedReview: { graph: desired, recorder, apply: () => engine.apply(desired) },
    connectionReview: { adapter: { async check(request) { calls++; if (fail) throw Error('Measured route unavailable'); return successfulAdapter.check(request); } },
      description: 'Configured fixture transport.' } });
  await controller.initialize();
  assert.throws(() => controller.start('connections'), error => error instanceof RequestError && error.status === 409);
  assert.equal(calls, 0);
  controller.start('review'); await controller.whenIdle();
  const failed = controller.getSnapshot();
  assert.equal(failed.run?.status, 'passed'); assert.equal(failed.connections?.status, 'failed');
  assert.ok(failed.run?.resources.every(item => item.status === 'ready'));
  fail = false; controller.start('connections'); await controller.whenIdle();
  const recovered = controller.getSnapshot();
  assert.equal(recovered.connections?.status, 'passed');
  assert.deepEqual(recovered.run, failed.run);
  controller.start('review');
  const reset = controller.getSnapshot();
  assert.equal(reset.connections?.status, 'idle');
  assert.ok(reset.connections?.checks.every(check => check.status === 'untested'));
  assert.equal(reset.connections?.recording, undefined);
  await controller.whenIdle();
  const reapplied = controller.getSnapshot();
  assert.equal(reapplied.connections?.status, 'passed');
  assert.ok(reapplied.run?.resources.every(item => item.action === 'noop'));
  assert.notEqual(reapplied.connections?.id, recovered.connections?.id);
  assert.equal(calls, 3);
});

test('configured connection probes follow their exact graph digest across foreign graphs, no-op and restoration', async t => {
  const path = await directory(t);
  let calls = 0;
  const controller = new DashboardController({ directory: path, readinessDelay: 0,
    connectionReview: { adapter: { async check(request) { calls++; return successfulAdapter.check(request); } },
      label: 'Graph-scoped paths', description: 'The configured graph relationships.' } });
  await controller.initialize();
  const original = controller.getSnapshot().graph!;
  const invalidFrames: unknown[] = [];
  const unsubscribe = controller.subscribe(() => {
    try { readDashboardState(JSON.parse(JSON.stringify(controller.getSnapshot()))); } catch (error) { invalidFrames.push(error); }
  });
  t.after(unsubscribe);
  controller.start('demo'); await controller.whenIdle();
  controller.start('connections'); await controller.whenIdle();
  const priorCalls = calls;
  controller.start('failure');
  assert.notEqual(controller.getSnapshot().graph?.digest, original.digest);
  assert.equal(controller.getSnapshot().connectionReviewAvailable, false);
  assert.equal(controller.getSnapshot().connections?.scopeDescription, undefined);
  assert.ok(controller.getSnapshot().connections?.checks.every(check => check.status === 'untested' && !check.scopeDescription));
  await controller.whenIdle();
  assert.throws(() => controller.start('connections'), error => error instanceof RequestError && error.status === 409 && /different resource graph/.test(error.message));
  assert.equal(calls, priorCalls);
  controller.start('demo'); await controller.whenIdle();
  assert.equal(controller.getSnapshot().graph?.digest, original.digest);
  assert.equal(controller.getSnapshot().connectionReviewAvailable, true);
  assert.equal(controller.getSnapshot().connections?.status, 'idle');
  controller.start('noop'); await controller.whenIdle();
  controller.start('connections'); await controller.whenIdle();
  assert.equal(calls, 0, 'the generic graph has no communication edges to probe');
  assert.equal(controller.getSnapshot().connections?.status, 'passed');
  assert.deepEqual(invalidFrames, []);
});

test('connection host admission refuses foreign scope IDs, malformed metadata and a mismatched graph digest', async t => {
  const path = await directory(t), desired = graph();
  for (const scopes of [{ 'communication:99': 'Foreign path' }, { 'communication:0': 12 }, []]) {
    assert.throws(() => readConnectionReview({ adapter: successfulAdapter, scopes: scopes as never }, desired), /Connection scopes/);
  }
  assert.throws(() => readConnectionReview({ adapter: successfulAdapter, description: 'bad\ntext' }, desired), /description/);
  assert.throws(() => readConnectionReview({ adapter: {} as never }, desired), /adapter/);
  const changed = structuredClone(desired); changed.digest = '0'.repeat(64);
  assert.throws(() => new DashboardController({ directory: path, initialReview: { graph: changed, run: deployed() },
    connectionReview: { adapter: successfulAdapter } }), /digest|graph/i);
  const controller = new DashboardController({ directory: path, initialReview: { graph: desired, run: deployed() } });
  assert.throws(() => controller.start('connections'), error => error instanceof RequestError && error.status === 409);
});

test('incomplete connection trace capture is visible while measured outcomes and metadata remain available', async t => {
  const path = await directory(t); await writeFile(join(path, 'connection-traces'), 'Blocks the native trace directory.');
  const result = await runConnectionReview({ graph: graph(), adapter: successfulAdapter, directory: path, update() {},
    label: 'Measured path', description: 'Trusted host path.', scopes: { [untestedConnections(graph()).checks[0]!.connectionId]: 'Observed fixture route.' } });
  assert.equal(result.status, 'passed'); assert.equal(result.checks[0]?.status, 'connected');
  assert.match(result.report!.captureError!, /native JSONL trace is incomplete/);
  assert.equal((result.report!.traceStatus as { flushed: boolean }).flushed, false);
  assert.ok(result.recording?.snapshot && result.report?.evidencePath);
  const state: DashboardState = { revision: 1, busy: false, graph: graph(), connections: result };
  assert.doesNotThrow(() => readDashboardState(state));
  for (const scopeDescription of [17, {}, 'x'.repeat(2001)]) {
    const invalid = structuredClone(state); invalid.connections!.checks[0]!.scopeDescription = scopeDescription as never;
    assert.throws(() => readDashboardState(invalid), /Connection progress/);
  }
});
