import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { infra, resource } from 'footprintjs-iac';
import { ConnectionCheckError } from 'footprintjs-iac/connections';
import { diagnosticCandidates } from '../src/core/diagnostic-candidates.ts';
import { readDiagnosticFact, readRecordedDiagnostics } from '../src/core/recorded-diagnostics.ts';
import type { DashboardState } from '../src/core/types.ts';
import { RecordedDiagnosticHistory } from '../src/server/recorded-diagnostics.ts';
import { runConnectionReview } from '../src/server/run-connections.ts';

function fixture(): DashboardState {
  const endpoint = resource('edge', 'fixture', { kind: 'Service' }), app = resource('app', 'fixture', { kind: 'Deployment' });
  return { revision: 1, busy: false, graph: infra('diagnostic-history').resource(endpoint).resource(app).connect(endpoint, app, 'communicatesWith').synth() };
}
test('actual failed and recovered native checks retain separate value-free explanations across reopen', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lens-trace-history-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const state = fixture(), history = new RecordedDiagnosticHistory(directory, () => assert.fail('history write failed'));
  await history.initialize(state);
  const observation = { method: 'fixture HTTP', target: 'http://private-endpoint/?token=private-token', observedAt: Date.now(), latencyMs: 7,
    details: { status: 503, body: 'private-response-body', password: 'private-password' } };
  state.connections = await runConnectionReview({ graph: state.graph!, directory, update() {}, adapter: {
    async check() { throw new ConnectionCheckError('private-provider-error', observation); },
  } });
  assert.equal(state.connections.status, 'failed'); history.update(state); await history.whenIdle();
  const failed = history.snapshot()!.runs[0]!;
  assert.equal(failed.outcome, 'failed'); assert.equal(failed.targets[0]!.label, 'Network → Program');
  assert.equal(failed.targets[0]!.trace?.status, 'available');
  assert.ok(failed.targets[0]!.trace!.summary.nodes > 0);
  assert.ok(failed.targets[0]!.trace!.summary.controlEdges > 0, 'actual saved native controls are supplied');
  assert.ok(failed.targets[0]!.facts.some(fact => fact.code === 'http-status' && fact.value === 503));
  const before = JSON.stringify(failed);
  state.connections = await runConnectionReview({ graph: state.graph!, directory, update() {}, adapter: {
    async check() { return { ...observation, details: { status: 200 } }; },
  } });
  history.update(state); await history.whenIdle();
  const complete = history.snapshot()!;
  assert.deepEqual(complete.runs.map(run => run.outcome), ['failed','passed']);
  assert.equal(JSON.stringify(complete.runs[0]), before); assert.notEqual(complete.runs[0]!.runtimeRunId, complete.runs[1]!.runtimeRunId);
  const persisted = await readFile(join(directory, 'recorded-diagnostics.json'), 'utf8');
  for (const secret of ['private-token','private-response-body','private-password','private-provider-error','private-endpoint']) assert.equal(persisted.includes(secret), false);
  const reopened = new RecordedDiagnosticHistory(directory, () => assert.fail('history write failed'));
  await reopened.initialize(state); assert.deepEqual(reopened.snapshot(), complete);
});

test('unreadable, oversized and mismatched history remain intact with a visible completeness limitation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lens-trace-unreadable-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'recorded-diagnostics.json');
  for (const content of ['{corrupt', ' '.repeat(16 * 1024 * 1024 + 1), JSON.stringify({ version: 1, binding: 'f'.repeat(64), runs: [], omitted: 0 })]) {
    await writeFile(file, content); const state = fixture();
    state.connections = { id: 'new-check', status: 'failed', checks: [{ connectionId: 'communication:0', from: 'edge', to: 'app', status: 'failed' }], events: [] };
    const history = new RecordedDiagnosticHistory(directory, () => assert.fail('blocked history must not write'));
    await history.initialize(state); const current = history.snapshot()!;
    assert.equal(current.runs.length, 1); assert.ok(current.limitations?.length);
    assert.match(current.limitations!.join(), /retained/); assert.match(current.limitations!.join(), /not saved/);
    assert.equal(await readFile(file, 'utf8'), content);
  }
});

test('fact and history admission reject executable or raw observation values, preserve only approved reason codes', () => {
  assert.deepEqual(readDiagnosticFact({ code: 'reason', value: 'provider-unavailable' }), { code: 'reason', value: 'provider-unavailable' });
  assert.deepEqual(readDiagnosticFact({ code: 'reason', value: 'federated-login-failed' }), { code: 'reason', value: 'federated-login-failed' });
  assert.deepEqual(readDiagnosticFact({ code: 'reason', value: 'jwks-probe-failed' }), { code: 'reason', value: 'jwks-probe-failed' });
  for (const fact of [{ code: 'reason', value: 'raw-provider-body' }, { code: 'status', value: 'password' }, { code: 'http-status', value: 600 }, { code: 'http-status', value: 503, password: 'secret' }]) assert.throws(() => readDiagnosticFact(fact));
  let invoked = false;
  assert.throws(() => readRecordedDiagnostics({ version: 1, binding: 'a'.repeat(64), omitted: 0, runs: [{ kind: { toString() { invoked = true; return 'connections'; } }, runtimeRunId: null, runId: 'a' }] }));
  assert.equal(invoked, false);
  const state = fixture();
  state.identity = { id: 'identity-check', label: 'Access', status: 'failed', events: [], checks: [{ checkId: 'sign-in', label: 'Sign in', kind: 'login', expected: 'authenticated', status: 'failed',
    observation: { verdict: 'unavailable', latencyMs: 2, observedAt: 0, details: { code: 'provider-unavailable', httpStatus: 503 } } }] };
  const candidate = diagnosticCandidates(state)[0]!;
  assert.ok(candidate.targets[0]!.facts.some(fact => fact.code === 'reason' && fact.value === 'provider-unavailable'));
});
