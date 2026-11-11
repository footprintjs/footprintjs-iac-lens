import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileStateStore, InfraEngine, ReconcileStrategy, SimulatorAdapter, loadEvidence, type InfraGraph } from 'footprint-iac';
import { compileGraph } from 'footprint-iac/graph';
import { createDeploymentRecorder } from 'footprint-iac/progress';
import { previewDeploymentChart } from 'footprint-iac/progress/preview';
import { createDashboardClient, projectRevisionReview, type DashboardState, type RevisionIdentity, type RevisionReviewState } from '../src/core/index.ts';
import { DashboardController, RequestError, startDashboard, type ControllerOptions, type RevisionPreparation } from '../src/server/index.ts';
import { executeManagedReview } from '../src/server/execute-managed-review.ts';

const ids = ['identity-directory', 'identity-provider', 'neo-namespace', 'neo-access-policy', 'neo-app', 'neo-service'];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function graph(image: string): InfraGraph {
  return compileGraph({ name: 'versioned-neo', boundaries: [], memberships: [], resources: [
    { id: 'identity-directory', provider: 'simulator', spec: { role: 'directory' } },
    { id: 'identity-provider', provider: 'simulator', dependsOn: ['identity-directory'], spec: { role: 'provider' } },
    { id: 'neo-namespace', provider: 'simulator', spec: { kind: 'Namespace' } },
    { id: 'neo-access-policy', provider: 'simulator', dependsOn: ['neo-namespace'], spec: { kind: 'ConfigMap' } },
    { id: 'neo-app', provider: 'simulator', dependsOn: ['neo-namespace', 'identity-provider', 'neo-access-policy'], spec: { kind: 'Deployment', image } },
    { id: 'neo-service', provider: 'simulator', dependsOn: ['neo-app'], spec: { kind: 'Service' } },
  ], relations: [
    { from: 'identity-provider', to: 'identity-directory', kind: 'communicatesWith' },
    { from: 'neo-app', to: 'identity-provider', kind: 'communicatesWith' },
    { from: 'neo-service', to: 'neo-app', kind: 'communicatesWith' },
  ] });
}
function gate() {
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  return { reached, release, async wait() { entered(); await held; } };
}
function identity(graph: InfraGraph, id: string): RevisionIdentity {
  return { id, label: `Neo ${id === 'neo-v1' ? '1' : '2'}`, digest: hash(id + graph.digest), graphDigest: graph.digest };
}
interface FixtureOptions { holdUpgrade?: boolean; holdReview?: boolean }

/** Only provider transports and the master-pointer seam are local test doubles; execution and capture are native. */
async function fixture(t: { after(fn: () => Promise<void>): void }, settings: FixtureOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'iac-revision-workflow-'));
  const upgradeGate = gate(), reviewGate = gate(), connectionGate = gate();
  const v1 = graph('neo:v1'), v2 = graph('neo:v2'), currentIdentity = identity(v1, 'neo-v1'), candidate = identity(v2, 'neo-v2');
  const target = { id: 'owned-neo', context: 'kind-owned', namespace: 'owned-neo', label: 'Neo' };
  const controls = { failReview: false, wrongScope: false, failAfterApply: false, failConnection: false, failAccess: false, holdConnections: false };
  const adapter = new SimulatorAdapter({ file: join(directory, 'provider.json'), faults: {
    failBeforeApply: new Set<string>(),
    async afterEffect(resource) { if (settings.holdUpgrade && resource.id === 'neo-app' && resource.spec.image === 'neo:v2') await upgradeGate.wait(); },
  } });
  const store = new FileStateStore(join(directory, 'state'));
  function engine(recorder: ReturnType<typeof createDeploymentRecorder>) {
    return new InfraEngine({ adapters: [adapter], store, strategy: new ReconcileStrategy(1),
      traceDirectory: join(directory, 'traces'), recorders: [recorder], chartObservers: [recorder] });
  }
  const baselineRecorder = createDeploymentRecorder(), baselineEngine = engine(baselineRecorder);
  const baselineRun = await executeManagedReview({ graph: v1, recorder: baselineRecorder, apply: () => baselineEngine.apply(v1), target }, () => {});
  assert.equal(baselineRun.status, 'passed');
  const baselineEffects = adapter.calls.length;
  const recorder = createDeploymentRecorder(), updater = engine(recorder);
  let pointer = currentIdentity, reviewCalls = 0, applyCalls = 0, completeCalls = 0;
  let connectionCalls = 0, accessCalls = 0;
  const order: string[] = [];
  const plans: RevisionPreparation[] = [];
  const workflow: NonNullable<ControllerOptions['revisionWorkflow']> = {
    async snapshot() { return { status: pointer.digest === candidate.digest ? 'applied' : 'available', current: pointer,
      ...(pointer.digest !== candidate.digest ? { candidate } : {}), canApply: false }; },
    async review() {
      reviewCalls++;
      if (settings.holdReview) await reviewGate.wait();
      if (controls.failReview) throw Error('Unreadable staged master document');
      const planned = await updater.plan(v2), lease = hash(`review-${reviewCalls}`);
      const summary: RevisionReviewState = { status: 'ready', current: pointer, candidate, reviewId: lease, canApply: true,
        resources: planned.operations.map(operation => ({ resourceId: operation.resource.id, action: operation.action,
          change: operation.action === 'noop' ? 'unchanged' : 'changed',
          ...(operation.resource.id === 'neo-app' && operation.action === 'update'
            ? { changes: [{ path: '/spec/image', before: 'neo:v1', after: 'neo:v2' }] } : {}) })),
      };
      const prepared: RevisionPreparation = { summary,
        managedReview: { graph: v2, recorder, mode: 'managed', target: controls.wrongScope ? { ...target, namespace: 'other-namespace' } : target,
          schedulePreview: previewDeploymentChart(planned, { graphDigest: v2.digest }), neoUrl: 'http://127.0.0.1:5230/?test',
          async apply() {
            applyCalls++; order.push('apply');
            const result = await updater.apply(v2);
            if (result.ok) pointer = candidate; // The master pointer denotes proven infrastructure convergence.
            return result;
          },
        },
        async afterApply() { order.push('afterApply'); if (controls.failAfterApply) throw Error('Local app connection unavailable'); },
        connectionReview: { adapter: { async check(request) {
          connectionCalls++; order.push('connection');
          assert.ok(order.includes('afterApply'), 'restore the owned local connection before verification');
          if (controls.holdConnections) await connectionGate.wait();
          if (controls.failConnection) throw Error('Measured connection unavailable');
          return { method: 'owned test transport', target: `${request.from.id}/${request.to.id}`, observedAt: Date.now(), latencyMs: 1, details: { httpStatus: 200 } };
        } } },
        identityReview: { stack: v2.name, label: 'Neo access', checks: [
          { id: 'reader', kind: 'access', label: 'Reader allowed', expected: 'allowed' },
          { id: 'guest', kind: 'access', label: 'Guest denied', expected: 'denied' },
        ], resourceBindings: { reader: ['neo-app'], guest: ['neo-app'] },
        adapter: { async check(request) { accessCalls++; order.push('access'); return {
          verdict: controls.failAccess ? 'unavailable' : request.id === 'reader' ? 'allowed' : 'denied', observedAt: Date.now(), latencyMs: 1,
        }; } } },
      };
      plans.push(prepared); return prepared;
    },
    async completed(prepared, run) {
      completeCalls++; order.push('completed');
      return { ...prepared.summary, current: pointer, status: run.status === 'passed' ? 'applied' : 'failed',
        canApply: false, runId: run.id, ...(run.status === 'failed' ? { error: 'The native apply did not converge; the current master revision is retained.' } : {}) };
    },
    async artifacts() { return [{ id: 'master-json', path: 'master/current.json', content: JSON.stringify(pointer), mediaType: 'application/json' }]; },
  };
  const options: ControllerOptions = { directory: join(directory, 'viewer'),
    initialReview: { graph: v1, run: baselineRun, target, neoUrl: 'http://127.0.0.1:5230/?test' }, revisionWorkflow: workflow };
  const controller = new DashboardController(options);
  await controller.initialize();
  const states: DashboardState[] = [controller.getSnapshot()];
  const close = controller.subscribe(() => states.push(controller.getSnapshot()));
  t.after(async () => {
    reviewGate.release(); upgradeGate.release(); connectionGate.release(); await controller.whenIdle(); close();
    await rm(directory, { recursive: true, force: true });
  });
  const review = async () => { controller.start('revision-review'); await controller.whenIdle(); return controller.getSnapshot().revisionReview!; };
  return { directory, options, controller, states, adapter, baselineEffects, baselineRun, v1, v2, currentIdentity, candidate,
    recorder, controls, upgradeGate, reviewGate, connectionGate, review, plans, order, pointer: () => pointer,
    counts: () => ({ reviewCalls, applyCalls, completeCalls, connectionCalls, accessCalls }) };
}

test('review keeps the existing six ready objects; applying the exact lease captures only one changed resource', { timeout: 10_000 }, async t => {
  const host = await fixture(t, { holdUpgrade: true, holdReview: true });
  const before = host.controller.getSnapshot();
  assert.equal(before.deploymentReadOnly, undefined);
  assert.equal(before.revisionReview?.current?.id, 'neo-v1');
  assert.equal(before.revisionReview?.candidate?.id, 'neo-v2');
  assert.ok(before.artifacts?.some(artifact => artifact.id === 'master-json'));
  host.controller.start('revision-review'); await host.reviewGate.reached;
  const reviewing = host.controller.getSnapshot();
  assert.equal(reviewing.revisionReview?.status, 'reviewing');
  assert.deepEqual(reviewing.run, before.run);
  assert.equal(reviewing.graph?.digest, host.v1.digest);
  assert.ok(reviewing.run?.resources.every(resource => resource.status === 'ready'));
  assert.equal(host.adapter.calls.length, host.baselineEffects, 'review must never contact provider mutation methods');
  host.reviewGate.release(); await host.controller.whenIdle();
  const ready = host.controller.getSnapshot(), summary = ready.revisionReview!;
  assert.deepEqual(ready.run, before.run); assert.equal(ready.neoUrl, before.neoUrl);
  assert.equal(summary.status, 'ready'); assert.equal(summary.resources?.filter(row => row.action === 'update').length, 1);
  assert.equal(summary.resources?.filter(row => row.action === 'noop').length, 5);
  assert.equal(projectRevisionReview(ready)?.headline, 'Update Program');
  for (const bad of [undefined, hash('wrong')]) assert.throws(() => host.controller.start('revision-apply', bad),
    error => error instanceof RequestError && error.status === 409);
  assert.equal(host.counts().applyCalls, 0); assert.equal(host.adapter.calls.length, host.baselineEffects);
  host.controls.holdConnections = true;
  host.controller.start('revision-apply', summary.reviewId); await host.upgradeGate.reached;
  const applying = host.controller.getSnapshot();
  assert.equal(applying.graph?.digest, host.v2.digest); assert.equal(applying.revisionReview?.status, 'applying');
  assert.notEqual(applying.run?.id, before.run?.id);
  assert.ok(applying.run?.events.some(event => event.resourceId === 'neo-app' && event.status === 'deploying' && event.action === 'update'));
  assert.deepEqual(host.adapter.calls.slice(host.baselineEffects).map(call => call.id), ['neo-app']);
  assert.equal(host.pointer().digest, host.currentIdentity.digest, 'a partially running update is not an applied master revision');
  host.upgradeGate.release(); await host.connectionGate.reached;
  const checking = host.controller.getSnapshot();
  assert.equal(checking.run?.status, 'passed', 'verification follows the actual completed infrastructure recording');
  assert.equal(checking.connections?.status, 'checking');
  assert.ok(checking.connections?.events.some(event => event.status === 'checking'));
  assert.ok(checking.connections?.checks.some(check => check.status === 'checking'));
  assert.equal(host.counts().accessCalls, 0, 'access checks wait for connection verification');
  host.connectionGate.release(); await host.controller.whenIdle();
  const after = host.controller.getSnapshot();
  assert.equal(after.run?.status, 'passed'); assert.equal(after.revisionReview?.status, 'applied');
  assert.equal(after.revisionReview?.current?.digest, host.candidate.digest);
  assert.equal(after.revisionReview?.canApply, false); assert.equal(host.pointer().digest, host.candidate.digest);
  assert.equal(after.graph?.digest, host.v2.digest); assert.equal(after.target?.namespace, before.target?.namespace);
  assert.deepEqual(new Set(after.run?.resources.map(resource => resource.id)), new Set(ids));
  assert.equal(after.run?.resources.filter(resource => resource.action === 'update').length, 1);
  assert.equal(after.run?.resources.filter(resource => resource.action === 'noop').length, 5);
  assert.ok(after.run?.resources.every(resource => resource.status === 'ready'));
  assert.equal(after.connections?.status, 'passed'); assert.equal(after.connections?.checks.length, 3);
  assert.equal(after.identity?.status, 'passed'); assert.deepEqual(after.identity?.checks.map(check => check.observation?.verdict), ['allowed', 'denied']);
  assert.ok(after.connections?.recording && after.identity?.recording);
  assert.equal(after.neoUrl, before.neoUrl); assert.equal(after.appAccess?.status, 'ready');
  assert.deepEqual(host.counts(), { reviewCalls: 1, applyCalls: 1, completeCalls: 1, connectionCalls: 3, accessCalls: 2 });
  assert.equal(host.order[0], 'apply'); assert.equal(host.order[1], 'afterApply');
  assert.ok(host.order.indexOf('access') > host.order.lastIndexOf('connection'));
  const evidence = await loadEvidence((after.run!.report as { evidencePath: string }).evidencePath);
  assert.equal(evidence.runId, after.run!.id); assert.equal(evidence.graph?.digest, host.v2.digest);
  assert.equal((after.run!.report as { captureError?: string }).captureError, undefined);
  assert.deepEqual(new Set(host.states.filter(state => state.run?.id && state.run.id !== before.run?.id).map(state => state.run!.id)), new Set([after.run!.id]));
  assert.throws(() => host.controller.start('revision-apply', summary.reviewId), error => error instanceof RequestError && error.status === 409);
});

test('a newer completed review invalidates an older lease and review failures/scope changes cannot mutate the existing deployment', async t => {
  const host = await fixture(t);
  const before = host.controller.getSnapshot(), first = await host.review(), second = await host.review();
  assert.notEqual(first.reviewId, second.reviewId);
  assert.throws(() => host.controller.start('revision-apply', first.reviewId), error => error instanceof RequestError && error.status === 409);
  host.controls.wrongScope = true; await host.review();
  assert.equal(host.controller.getSnapshot().revisionReview?.status, 'failed');
  assert.deepEqual(host.controller.getSnapshot().run, before.run);
  assert.equal(host.controller.getSnapshot().graph?.digest, host.v1.digest);
  assert.throws(() => host.controller.start('revision-apply', second.reviewId), error => error instanceof RequestError && error.status === 409);
  host.controls.wrongScope = false; host.controls.failReview = true; await host.review();
  assert.equal(host.controller.getSnapshot().revisionReview?.canApply, false);
  assert.equal(host.counts().applyCalls, 0); assert.equal(host.adapter.calls.length, host.baselineEffects);
  assert.equal(host.pointer().digest, host.currentIdentity.digest);
});

test('a failed native update retains the applied master and failed evidence, then a new review can retry on the same target', { timeout: 10_000 }, async t => {
  const host = await fixture(t);
  host.adapter.faults.failBeforeApply!.add('neo-app');
  const summary = await host.review(); host.controller.start('revision-apply', summary.reviewId); await host.controller.whenIdle();
  const failed = host.controller.getSnapshot();
  assert.equal(failed.run?.status, 'failed'); assert.equal(failed.revisionReview?.status, 'failed');
  assert.equal(host.pointer().digest, host.currentIdentity.digest); assert.equal(failed.revisionReview?.current?.digest, host.currentIdentity.digest);
  assert.equal(failed.graph?.digest, host.v2.digest, 'the failed candidate recording remains attached to its own graph');
  assert.ok(failed.run?.recording?.snapshot); assert.equal(failed.run?.resources.find(resource => resource.id === 'neo-app')?.status, 'failed');
  assert.equal(failed.neoUrl, undefined); assert.equal(host.counts().connectionCalls, 0); assert.equal(host.counts().accessCalls, 0);
  for (const scenario of ['connections', 'identity'] as const) assert.throws(() => host.controller.start(scenario),
    error => error instanceof RequestError && error.status === 409, 'a failed revision cannot authorize checks against unconfirmed resources');
  const failedEvidence = await loadEvidence((failed.run!.report as { evidencePath: string }).evidencePath);
  assert.equal(failedEvidence.runId, failed.run!.id);
  host.adapter.faults.failBeforeApply!.clear();
  const freshReview = await host.review();
  assert.equal(freshReview.status, 'ready', 'a failed candidate graph cannot prevent reviewing against the unchanged applied master');
  assert.notEqual(freshReview.reviewId, summary.reviewId);
  host.controller.start('revision-apply', freshReview.reviewId); await host.controller.whenIdle();
  const recovered = host.controller.getSnapshot();
  assert.equal(recovered.run?.status, 'passed'); assert.notEqual(recovered.run?.id, failed.run?.id);
  assert.equal(recovered.revisionReview?.current?.digest, host.candidate.digest); assert.equal(host.pointer().digest, host.candidate.digest);
  assert.equal(recovered.run?.resources.filter(resource => resource.action === 'update').length, 1);
  assert.equal(recovered.run?.resources.filter(resource => resource.action === 'noop').length, 5);
  assert.equal(recovered.connections?.status, 'passed'); assert.equal(recovered.identity?.status, 'passed');
});

test('a converged infrastructure revision stays applied when later connection or access verification fails', async t => {
  for (const failure of ['failConnection', 'failAccess'] as const) {
    const host = await fixture(t); host.controls[failure] = true;
    const summary = await host.review(); host.controller.start('revision-apply', summary.reviewId); await host.controller.whenIdle();
    const after = host.controller.getSnapshot();
    assert.equal(after.run?.status, 'passed'); assert.equal(host.pointer().digest, host.candidate.digest);
    assert.equal(after.revisionReview?.current?.digest, host.candidate.digest);
    assert.equal(after.revisionReview?.status, 'applied');
    assert.match(after.revisionReview?.error ?? '', /verification|connection|access|attention/i, 'an applied revision cannot hide a failed later verification');
    assert.equal(after.connections?.status, failure === 'failConnection' ? 'failed' : 'passed');
    assert.equal(after.identity?.status, failure === 'failAccess' ? 'failed' : 'passed');
    host.controls[failure] = false;
    host.controller.start(failure === 'failConnection' ? 'connections' : 'identity'); await host.controller.whenIdle();
    const recovered = host.controller.getSnapshot();
    assert.equal(recovered.revisionReview?.status, 'applied'); assert.equal(recovered.revisionReview?.current?.digest, host.candidate.digest);
    assert.equal(recovered.revisionReview?.error, undefined, 'fresh successful verification clears the attention message');
    assert.equal(recovered.connections?.status, 'passed'); assert.equal(recovered.identity?.status, 'passed');
    assert.equal(recovered.run?.id, after.run?.id); assert.equal(host.counts().applyCalls, 1, 'verification recovery does not redeploy resources');
  }
});

test('failure restoring the local app connection retains the proven new master and discloses unavailable access', async t => {
  const host = await fixture(t); host.controls.failAfterApply = true;
  const summary = await host.review(); host.controller.start('revision-apply', summary.reviewId); await host.controller.whenIdle();
  const after = host.controller.getSnapshot();
  assert.equal(after.run?.status, 'passed'); assert.equal(host.pointer().digest, host.candidate.digest);
  assert.equal(after.revisionReview?.current?.digest, host.candidate.digest, 'the host snapshot must refresh the master pointer even if app forwarding fails');
  assert.equal(after.revisionReview?.canApply, false); assert.ok(after.revisionReview?.error);
  assert.equal(after.appAccess?.status, 'failed'); assert.equal(after.neoUrl, undefined);
  assert.equal(host.counts().connectionCalls, 0); assert.equal(host.counts().accessCalls, 0);
});

test('HTTP admission and the client require the exact review ID; invalid requests cannot reach apply', { timeout: 10_000 }, async t => {
  const host = await fixture(t);
  const running = await startDashboard({ ...host.options, directory: join(host.directory, 'http-viewer'), staticDirectory: join(host.directory, 'static'), port: 0 });
  t.after(() => running.close());
  const outgoing: { scenario: string; reviewId?: string }[] = [];
  const client = createDashboardClient({ baseUrl: running.url, fetch: async (url, options) => {
    if (options?.body) outgoing.push(JSON.parse(options.body));
    return fetch(url, options);
  } });
  await assert.rejects(client.run('revision-apply'), /exact completed revision review/);
  await assert.rejects(client.run('connections', hash('wrong')), /review ID/);
  assert.equal(outgoing.length, 0, 'the client refuses malformed commands before transmission');
  const post = (body: unknown) => fetch(running.url + '/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  for (const body of [
    { scenario: 'revision-apply' }, { scenario: 'revision-apply', reviewId: 'not-a-lease' },
    { scenario: 'revision-review', reviewId: hash('bad') }, { scenario: 'revision-apply', reviewId: hash('bad'), graph: {} },
  ]) assert.equal((await post(body)).status, 400);
  assert.equal((await post({ scenario: 'revision-apply', reviewId: hash('bad'), graph: host.v2 })).status, 413);
  assert.equal((await post({ scenario: 'revision-apply', reviewId: hash('wrong') })).status, 409);
  await client.run('revision-review'); await running.controller.whenIdle();
  const state = await client.getState(), lease = state.revisionReview!.reviewId!;
  assert.match(lease, /^[a-f0-9]{64}$/); assert.equal(host.counts().applyCalls, 0);
  await client.run('revision-apply', lease); await running.controller.whenIdle();
  assert.deepEqual(outgoing.at(-1), { scenario: 'revision-apply', reviewId: lease });
  assert.equal(host.counts().applyCalls, 1);
  const updated = await client.getState();
  assert.equal(updated.run?.status, 'passed'); assert.equal(updated.revisionReview?.current?.digest, host.candidate.digest);
  assert.equal((await post({ scenario: 'revision-apply', reviewId: lease })).status, 409, 'a successful apply consumes its review lease');
});
