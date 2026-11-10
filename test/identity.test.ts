import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { infra, resource } from 'footprint-iac';
import type { AccessCheckAdapter, IdentityCheckRequest } from 'footprint-iac/identity';
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
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = runIdentityReview({ stack: 'identity-review', checks, directory: path,
    update: value => updates.push(value), adapter: { async check(request) {
      if (request.id === 'reader-login') { enter(); await gate; }
      return successfulAdapter.check(request);
    } } });
  await entered;
  assert.equal(updates.at(-1)?.checks[0]?.status, 'checking');
  assert.deepEqual(updates.at(-1)?.events.map(event => event.status), ['checking']);
  release(); const result = await pending;
  assert.equal(result.status, 'passed');
  assert.ok(result.checks.every(check => check.status === 'passed'));
  assert.equal(result.checks.find(check => check.checkId === 'guest-chat')?.observation?.verdict, 'denied');
  assert.equal(identityOutcomeLabel(result.checks[2]!), 'Denied · expected');
  assert.equal(identityOutcomeLabel(result.checks[3]!), 'Login rejected · expected');
  assert.equal(result.events.length, checks.length * 2);
  assert.ok(result.events.every(event => event.runtimeStageId.includes('#')));
  const evidence = JSON.parse(await readFile(result.report!.evidencePath!, 'utf8'));
  assert.equal(evidence.runId, result.id); assert.equal(evidence.ok, true);
  assert.equal(evidence.checks['guest-chat'].observation.verdict, 'denied');
  assert.equal(evidence.traceStatus.flushed, true);
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
  const controller = new DashboardController({ directory: path, initialReview: { graph, run, neoUrl: 'http://127.0.0.1:5230/?test' },
    identityReview: { stack: 'identity-review', checks, adapter: { async check(request) { enter(); await gate; return successfulAdapter.check(request); } } } });
  await controller.initialize();
  assert.equal(controller.getSnapshot().deploymentReadOnly, true);
  assert.throws(() => controller.start('noop'), error => error instanceof RequestError && error.status === 409);
  controller.start('identity'); await entered;
  assert.equal(controller.getSnapshot().identity?.checks[0]?.status, 'checking');
  assert.throws(() => controller.start('identity'), error => error instanceof RequestError && error.status === 409);
  release(); await controller.whenIdle();
  const final = controller.getSnapshot();
  assert.equal(final.identity?.status, 'passed'); assert.equal(final.busy, false);
  assert.deepEqual(final.run, run); assert.equal(final.neoUrl, 'http://127.0.0.1:5230/?test');
  const persisted = JSON.parse(await readFile(join(path, 'latest.json'), 'utf8')) as DashboardState;
  assert.deepEqual(persisted.run, run); assert.equal(persisted.identity?.status, 'passed');
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
