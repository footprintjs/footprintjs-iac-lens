import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bindSystem, infra, resource } from 'footprintjs-iac';
import { createNeoSystem, neoKubernetesProfile } from 'footprintjs-iac/integration/neo';
import type { AccessCheckAdapter, IdentityCheckRequest } from 'footprintjs-iac/identity';
import { readDashboardState } from '../src/core/client.ts';
import { identityOutcomeLabel } from '../src/core/identity.ts';
import type { DashboardRun, DashboardState, IdentityRun } from '../src/core/types.ts';
import { DashboardController, RequestError } from '../src/server/controller.ts';
import { pendingIdentity, runIdentityReview } from '../src/server/run-identity.ts';
import { startDashboard } from '../src/server/index.ts';

const checks: readonly IdentityCheckRequest[] = [
  { id: 'reader-login', label: 'Reader signs in', kind: 'login', expected: 'authenticated' },
  { id: 'reader-chat', label: 'Reader can chat', kind: 'access', expected: 'allowed' },
  { id: 'guest-chat', label: 'Guest cannot chat', kind: 'access', expected: 'denied' },
  { id: 'wrong-password', label: 'Wrong password is rejected', kind: 'login', expected: 'rejected' },
];
const successfulAdapter: AccessCheckAdapter = { async check(request) {
  return { verdict: request.expected, observedAt: Date.now(), latencyMs: 2,
    details: { protocol: 'http', httpStatus: request.expected === 'denied' ? 403 : request.expected === 'rejected' ? 401 : 200 } };
} };

async function directory(t: { after(fn: () => Promise<void>): void }) {
  const path = await mkdtemp(join(tmpdir(), 'iac-lens-identity-'));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}

test('native identity events stream real checking, expected denial passes, and safe evidence is retained', async t => {
  const path = await directory(t), updates: IdentityRun[] = [];
  const resourceBindings = { 'reader-login': ['identity-provider', 'directory'], 'reader-chat': ['neo', 'policy'] };
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = runIdentityReview({ stack: 'identity-review', checks, directory: path, resourceBindings,
    update: value => updates.push(value), adapter: { async check(request) {
      if (request.id === 'reader-login') { enter(); await gate; }
      return successfulAdapter.check(request);
    } } });
  await entered;
  assert.equal(updates.at(-1)?.checks[0]?.status, 'checking');
  assert.ok(updates.every(update => JSON.stringify(update.checks[0]?.resourceIds) === JSON.stringify(resourceBindings['reader-login'])));
  assert.deepEqual(updates.at(-1)?.events[0]?.resourceIds, resourceBindings['reader-login']);
  assert.deepEqual(updates.at(-1)?.events.map(event => event.status), ['checking']);
  release(); const result = await pending;
  assert.equal(result.status, 'passed');
  assert.ok(result.checks.every(check => check.status === 'passed'));
  assert.equal(result.checks.find(check => check.checkId === 'guest-chat')?.observation?.verdict, 'denied');
  assert.equal(identityOutcomeLabel(result.checks[2]!), 'Denied · expected');
  assert.equal(identityOutcomeLabel(result.checks[3]!), 'Login rejected · expected');
  assert.equal(result.events.length, checks.length * 2);
  assert.ok(result.events.every(event => event.runtimeStageId.includes('#')));
  assert.deepEqual(result.checks[0]?.resourceIds, resourceBindings['reader-login']);
  assert.deepEqual(result.checks[1]?.resourceIds, resourceBindings['reader-chat']);
  assert.equal(result.checks[2]?.resourceIds, undefined, 'legacy checks remain unassociated unless the host binds them');
  assert.ok(result.events.filter(event => event.checkId === 'reader-login')
    .every(event => JSON.stringify(event.resourceIds) === JSON.stringify(resourceBindings['reader-login'])));
  const evidence = JSON.parse(await readFile(result.report!.evidencePath!, 'utf8'));
  assert.equal(evidence.runId, result.id); assert.equal(evidence.ok, true);
  assert.equal(evidence.checks['guest-chat'].observation.verdict, 'denied');
  assert.equal(evidence.traceStatus.flushed, true);
  assert.deepEqual(evidence.resourceBindings, resourceBindings);
  assert.equal(evidence.events[0].resourceIds, undefined, 'saved native events retain their original payload');
  assert.ok(result.recording?.snapshot && result.recording.structure);
});

test('an identity outage is a failed check, including for expected denial, and recovery saves another native run', async t => {
  const path = await directory(t);
  const outage = await runIdentityReview({ stack: 'identity-review', checks, directory: path, update() {}, adapter: {
    async check() { return { verdict: 'unavailable', observedAt: Date.now(), latencyMs: 1,
      details: { code: 'directory-unavailable', protocol: 'ldaps', phase: 'directory' } }; },
  } });
  assert.equal(outage.status, 'failed');
  assert.equal(outage.checks[2]?.status, 'failed');
  assert.equal(identityOutcomeLabel(outage.checks[2]!), 'Unavailable · failed check');
  const restored = await runIdentityReview({ stack: 'identity-review', checks, directory: path, update() {}, adapter: successfulAdapter });
  assert.equal(restored.status, 'passed'); assert.notEqual(restored.id, outage.id);
  assert.equal(restored.events[0]?.sequence, 1);
  assert.ok(await readFile(outage.report!.evidencePath!, 'utf8'), 'failure evidence remains after recovery');
});

test('a raw adapter failure is sanitized and an invalid configuration never starts a probe', async t => {
  const path = await directory(t), secret = 'PRIVATE_PASSWORD_AND_TOKEN_DO_NOT_RECORD';
  const failed = await runIdentityReview({ stack: 'identity-review', checks, directory: path, update() {}, adapter: {
    async check() { throw new Error(secret); },
  } });
  assert.equal(failed.status, 'failed');
  const saved = await readFile(failed.report!.evidencePath!, 'utf8');
  assert.equal(saved.includes(secret), false); assert.equal(JSON.stringify(failed).includes(secret), false);
  let probed = false;
  const invalid = await runIdentityReview({ stack: 'identity-review', checks: [checks[0]!, checks[0]!], directory: path,
    update() {}, adapter: { async check() { probed = true; throw new Error(secret); } } });
  assert.equal(probed, false); assert.equal(invalid.status, 'failed');
  assert.deepEqual(invalid.events, []); assert.ok(invalid.checks.every(check => check.status === 'untested'));
  assert.ok(invalid.report?.error); assert.equal(JSON.stringify(invalid).includes(secret), false);
});

test('identity review keeps the deployment snapshot and serializes conflicting checks', async t => {
  const path = await directory(t);
  const graph = infra('recorded-neo').resource(resource('neo', 'fixture', { kind: 'Deployment' })).synth();
  const run: DashboardRun = { id: 'actual-deployment', status: 'passed', mode: 'kubernetes',
    resources: [{ id: 'neo', status: 'ready', action: 'create' }], events: [], report: { evidencePath: 'original-evidence.json' } };
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const resourceBindings = { 'reader-login': ['neo'], 'reader-chat': ['neo'] };
  const controller = new DashboardController({ directory: path, initialReview: { graph, run, neoUrl: 'http://127.0.0.1:5230/?test' },
    identityReview: { stack: 'identity-review', checks, resourceBindings,
      adapter: { async check(request) { enter(); await gate; return successfulAdapter.check(request); } } } });
  resourceBindings['reader-login'].push('foreign-after-construction');
  await controller.initialize();
  assert.equal(controller.getSnapshot().deploymentReadOnly, true);
  assert.throws(() => controller.start('noop'), error => error instanceof RequestError && error.status === 409);
  controller.start('identity'); await entered;
  assert.equal(controller.getSnapshot().identity?.checks[0]?.status, 'checking');
  assert.deepEqual(controller.getSnapshot().identity?.checks[0]?.resourceIds, ['neo']);
  assert.deepEqual(controller.getSnapshot().identity?.events[0]?.resourceIds, ['neo']);
  assert.throws(() => controller.start('identity'), error => error instanceof RequestError && error.status === 409);
  release(); await controller.whenIdle();
  const final = controller.getSnapshot();
  assert.equal(final.identity?.status, 'passed'); assert.equal(final.busy, false);
  assert.deepEqual(final.run, run); assert.equal(final.neoUrl, 'http://127.0.0.1:5230/?test');
  const persisted = JSON.parse(await readFile(join(path, 'latest.json'), 'utf8')) as DashboardState;
  assert.deepEqual(persisted.run, run); assert.equal(persisted.identity?.status, 'passed');
  assert.deepEqual(persisted.identity?.checks[0]?.resourceIds, ['neo']);
  assert.ok(persisted.identity?.events.filter(event => event.checkId === 'reader-login')
    .every(event => JSON.stringify(event.resourceIds) === JSON.stringify(['neo'])));
  assert.deepEqual(readDashboardState(persisted).identity, JSON.parse(JSON.stringify(final.identity)));
});

test('identity resource bindings reject unknown checks, undeclared resources and malformed resource lists before execution', async t => {
  const path = await directory(t);
  const graph = infra('identity-resources').resource(resource('neo', 'fixture', { kind: 'Deployment' })).synth();
  const run: DashboardRun = { id: 'deployed', status: 'passed', resources: [{ id: 'neo', status: 'ready' }], events: [] };
  for (const resourceBindings of [{ unknown: ['neo'] }, { 'reader-login': ['foreign'] },
    { 'reader-login': 'neo' }, { 'reader-login': ['neo', 'neo'] }]) {
    assert.throws(() => new DashboardController({ directory: path, initialReview: { graph, run },
      identityReview: { stack: graph.name, checks, adapter: successfulAdapter,
        resourceBindings: resourceBindings as unknown as Readonly<Record<string, readonly string[]>> } }), /Identity resource bindings/);
  }
});

test('identity resource associations are admitted only as unique declared resource IDs on checks and events', () => {
  const graph = infra('identity-resources').resource(resource('neo', 'fixture', { kind: 'Deployment' })).synth();
  const identity = pendingIdentity({ stack: graph.name, checks, adapter: successfulAdapter,
    resourceBindings: { 'reader-login': ['neo'] } });
  const state: DashboardState = { revision: 1, graph, busy: false, identity, artifacts: [] };
  assert.deepEqual(readDashboardState(state).identity?.checks[0]?.resourceIds, ['neo']);
  for (const resourceIds of ['neo', ['foreign'], ['neo', 'neo'], [17]]) {
    const candidate = structuredClone(state);
    candidate.identity!.checks[0]!.resourceIds = resourceIds as unknown as readonly string[];
    assert.throws(() => readDashboardState(candidate), /Identity progress/);
  }
  const eventState = structuredClone(state);
  eventState.identity!.events = [{ ...identity.checks[0]!, version: 1, runId: 'identity-run', sequence: 1,
    timestamp: 1, runtimeStageId: 'check#0', status: 'checking', resourceIds: 'neo' as unknown as readonly string[] }];
  assert.throws(() => readDashboardState(eventState), /Identity progress/);
});

test('resource-bound identity checks follow their configured graph through changed specs, restoration and no-op', async t => {
  const path = await directory(t);
  let calls = 0;
  const controller = new DashboardController({ directory: path, readinessDelay: 0,
    identityReview: { stack: 'identity-review', checks, resourceBindings: { 'reader-login': ['api'] },
      adapter: { async check(request) { calls++; return successfulAdapter.check(request); } } } });
  await controller.initialize();
  const originalDigest = controller.getSnapshot().graph!.digest;
  const invalidFrames: unknown[] = [];
  const stop = controller.subscribe(() => {
    try { readDashboardState(JSON.parse(JSON.stringify(controller.getSnapshot()))); }
    catch (error) { invalidFrames.push(error); }
  });
  t.after(stop);
  controller.start('identity'); await controller.whenIdle();
  assert.equal(controller.getSnapshot().identity?.status, 'passed');
  const priorCalls = calls;
  controller.start('failure');
  const foreign = controller.getSnapshot();
  assert.notEqual(foreign.graph!.digest, originalDigest);
  assert.ok(foreign.graph!.resources.some(resource => resource.id === 'api'), 'a matching resource ID cannot establish matching graph scope');
  assert.equal(foreign.identity, undefined);
  await controller.whenIdle();
  assert.throws(() => controller.start('identity'), error => error instanceof RequestError && error.status === 409);
  assert.equal(calls, priorCalls);
  controller.start('demo');
  const restored = controller.getSnapshot();
  assert.equal(restored.graph!.digest, originalDigest);
  assert.equal(restored.identity?.status, 'idle');
  assert.deepEqual(restored.identity?.checks[0]?.resourceIds, ['api']);
  assert.ok(restored.identity?.checks.every(check => check.status === 'untested'));
  await controller.whenIdle();
  controller.start('identity'); await controller.whenIdle();
  assert.equal(controller.getSnapshot().identity?.status, 'passed');
  controller.start('noop');
  assert.equal(controller.getSnapshot().identity?.status, 'idle');
  await controller.whenIdle();
  assert.deepEqual(invalidFrames, []);
});

test('switching a bound Neo graph to demo and no-op keeps every published identity frame admissible', async t => {
  const path = await directory(t);
  const design = createNeoSystem();
  const binding = bindSystem(design, neoKubernetesProfile({ context: 'kind-footprint-iac-test' }));
  const resourceId = binding.graph.resources[0]!.id;
  let calls = 0;
  const controller = new DashboardController({ directory: path, readinessDelay: 0, initialScenario: 'neo',
    neo: { context: 'unused-in-this-test', kubeconfig: join(path, 'unused-kubeconfig'), stateDirectory: join(path, 'unused-neo-state'), design, binding },
    identityReview: { stack: 'identity-review', checks, resourceBindings: { 'reader-login': [resourceId] },
      adapter: { async check(request) { calls++; return successfulAdapter.check(request); } } } });
  await controller.initialize();
  controller.start('identity'); await controller.whenIdle();
  const invalidFrames: unknown[] = [];
  const stop = controller.subscribe(() => {
    try { readDashboardState(JSON.parse(JSON.stringify(controller.getSnapshot()))); }
    catch (error) { invalidFrames.push(error); }
  });
  t.after(stop);
  const priorCalls = calls;
  controller.start('demo');
  assert.equal(controller.getSnapshot().identity, undefined);
  await controller.whenIdle();
  assert.throws(() => controller.start('identity'), error => error instanceof RequestError && error.status === 409);
  controller.start('noop'); await controller.whenIdle();
  assert.equal(controller.getSnapshot().identity, undefined);
  assert.equal(calls, priorCalls, 'foreign graph changes must not invoke the configured identity adapter');
  assert.deepEqual(invalidFrames, []);
});

test('legacy identity checks without resource bindings remain available after a generic graph change', async t => {
  const path = await directory(t);
  const controller = new DashboardController({ directory: path, readinessDelay: 0,
    identityReview: { stack: 'identity-review', checks, adapter: successfulAdapter } });
  await controller.initialize();
  controller.start('identity'); await controller.whenIdle();
  const prior = controller.getSnapshot().identity;
  controller.start('failure'); await controller.whenIdle();
  assert.deepEqual(controller.getSnapshot().identity, prior);
  controller.start('identity'); await controller.whenIdle();
  assert.equal(controller.getSnapshot().identity?.status, 'passed');
  assert.notEqual(controller.getSnapshot().identity?.id, prior?.id);
  assert.doesNotThrow(() => readDashboardState(controller.getSnapshot()));
});

test('HTTP identity review accepts only the host-configured checks and preserves resource outcomes', async t => {
  const path = await directory(t), publicPath = join(path, 'public'); await mkdir(publicPath);
  await writeFile(join(publicPath, 'index.html'), '<!doctype html><title>Identity Lens</title>');
  const running = await startDashboard({ directory: join(path, 'data'), staticDirectory: publicPath,
    identityReview: { stack: 'identity-review', checks, adapter: successfulAdapter }, readinessDelay: 0 });
  t.after(() => running.close());
  const before = running.controller.getSnapshot().run;
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(running.url + '/api/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await post({ scenario: 'identity', password: 'must-never-be-accepted' })).status, 400);
  assert.equal((await post({ scenario: 'identity' }, { Origin: 'https://hostile.invalid' })).status, 403);
  assert.equal((await post({ scenario: 'identity' })).status, 202);
  await running.controller.whenIdle();
  assert.deepEqual(running.controller.getSnapshot().run, before);
  assert.equal(running.controller.getSnapshot().identity?.status, 'passed');
});

test('the headless client refuses a passed denial whose actual observation was unavailable', () => {
  const identity = pendingIdentity({ stack: 'identity-review', checks, adapter: successfulAdapter });
  identity.checks[2] = { ...identity.checks[2]!, status: 'passed', observation: { verdict: 'unavailable', observedAt: 1, latencyMs: 2 } };
  assert.throws(() => readDashboardState({ revision: 1, graph: null, busy: false, identity }), /Identity progress/);
});

test('an incomplete native JSONL trace stays visible without rewriting measured access outcomes', async t => {
  const path = await directory(t);
  await writeFile(join(path, 'identity-traces'), 'A file prevents the trace directory from being created.');
  const result = await runIdentityReview({ stack: 'identity-review', checks, directory: path, update() {}, adapter: successfulAdapter });
  assert.equal(result.status, 'passed');
  assert.ok(result.checks.every(check => check.status === 'passed'));
  assert.match(result.report!.captureError!, /native JSONL trace is incomplete/);
  assert.ok(result.recording?.snapshot);
  assert.ok(result.report?.evidencePath);
  assert.equal((result.report?.traceStatus as { flushed: boolean }).flushed, false);
});
