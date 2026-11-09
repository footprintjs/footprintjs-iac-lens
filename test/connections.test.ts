import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { infra, resource } from 'footprint-iac';
import { connectionProgress, untestedConnections } from '../src/core/connections.ts';
import { layoutResources } from '../src/core/layout.ts';
import { readDashboardState } from '../src/core/client.ts';
import type { ConnectionRun, DashboardState } from '../src/core/types.ts';
import { runConnectionReview } from '../src/server/run-connections.ts';

function graph() {
  const service = resource('service', 'fixture', { kind: 'Service' });
  const app = resource('app', 'fixture', { kind: 'Deployment' });
  return infra('connection-view-fixture').resource(service).resource(app).connect(service, app, 'communicatesWith').synth();
}
function state(): DashboardState {
  const desired = graph();
  return { revision: 1, graph: desired, busy: false, mode: 'kubernetes',
    run: { id: 'deployment', status: 'passed', resources: desired.resources.map(r => ({ id: r.id, status: 'ready' })), events: [] },
    connections: untestedConnections(desired) };
}

test('communication stays untested with ready nodes, and only native check states control edge colour and animation', () => {
  const input = state();
  const edge = () => layoutResources(input).edges.find(edge => edge.kind === 'communication')!;
  assert.equal(edge().connectionStatus, 'untested'); assert.equal(edge().active, false);
  const colors = new Set<string>();
  for (const status of ['checking', 'connected', 'failed'] as const) {
    input.connections!.checks[0]!.status = status;
    assert.equal(edge().connectionStatus, status); assert.equal(edge().active, status === 'checking');
    assert.ok(edge().label?.toLowerCase().includes(status)); colors.add(edge().color);
  }
  assert.equal(colors.size, 3);
  assert.ok(input.run!.resources.every(resource => resource.status === 'ready'));
  assert.equal(input.run!.status, 'passed', 'a connection failure cannot invent a deployment failure');
  assert.equal(connectionProgress(input, 'communication:0', 'other-service', 'app').status, 'untested', 'mismatched relation evidence cannot colour another edge');
  const bad = state(); bad.connections!.checks[0]!.status = 'ready' as never;
  assert.throws(() => readDashboardState(bad), /Connection progress/);
});

test('native connection events stream checking until the observation settles, save evidence, and reset on a failed recheck', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'iac-lens-connections-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const desired = graph();
  const updates: ConnectionRun[] = [];
  let entered!: () => void, release!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = runConnectionReview({ graph: desired, directory, update: value => updates.push(value), adapter: {
    async check(request) {
      assert.equal(request.from.id, 'service'); assert.equal(request.to.id, 'app'); entered(); await gate;
      return { method: 'fixture HTTP', target: 'http://fixture/health', observedAt: Date.now(), latencyMs: 3, details: { sourcePod: 'fixture', status: 200 } };
    },
  } });
  await enteredPromise;
  assert.equal(updates.at(-1)!.checks[0]!.status, 'checking');
  assert.deepEqual(updates.at(-1)!.events.map(event => event.status), ['checking']);
  release(); const success = await pending;
  assert.equal(success.status, 'passed'); assert.equal(success.checks[0]!.status, 'connected');
  assert.deepEqual(success.events.map(event => event.status), ['checking', 'connected']);
  assert.ok(success.events.every(event => event.runtimeStageId.includes('#')));
  assert.ok(success.recording?.snapshot && success.recording.structure);
  const evidence = JSON.parse(await readFile(success.report!.evidencePath!, 'utf8'));
  assert.equal(evidence.runId, success.id); assert.equal(evidence.checks['communication:0'].observation.details.status, 200);
  assert.equal(evidence.traceStatus.flushed, true);
  const second: ConnectionRun[] = [];
  const failure = await runConnectionReview({ graph: desired, directory, update: value => second.push(value), adapter: {
    async check() { throw Object.assign(new Error('HTTP route refused connection'), { details: { sourcePod: 'fixture', targetPort: 5999 } }); },
  } });
  assert.notEqual(failure.id, success.id);
  assert.equal(second[0]!.checks[0]!.status, 'untested');
  assert.equal(failure.status, 'failed'); assert.equal(failure.checks[0]!.status, 'failed');
  assert.match(failure.checks[0]!.message!, /refused connection/);
  assert.deepEqual(failure.events.map(event => event.status), ['checking', 'failed']);
  assert.equal(failure.events[0]!.sequence, 1);
  const failedEvidence = JSON.parse(await readFile(failure.report!.evidencePath!, 'utf8'));
  assert.equal(failedEvidence.ok, false);
  assert.match(failedEvidence.checks['communication:0'].error, /refused connection/);
  assert.ok(await readFile(success.report!.evidencePath!, 'utf8'), 'earlier successful evidence remains available');
});

test('a failure before native progress leaves the edge untested and reports the failed check run', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'iac-lens-no-connection-events-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const broken = structuredClone(graph()); broken.digest = '0'.repeat(64);
  let called = false;
  const result = await runConnectionReview({ graph: broken, directory, update() {}, adapter: { async check() { called = true; throw new Error('must not probe'); } } });
  assert.equal(called, false); assert.equal(result.status, 'failed');
  assert.deepEqual(result.events, []); assert.equal(result.checks[0]!.status, 'untested');
  assert.ok(result.report?.error);
});
