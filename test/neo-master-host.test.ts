import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileStateStore, InfraEngine, ReconcileStrategy, SimulatorAdapter, type ResourceAdapter } from 'footprintjs-iac';
import { createIdentityGraph, type IdentityTarget } from 'footprintjs-iac/integration/identity';
import { createDeploymentRecorder } from 'footprintjs-iac/progress';
import { FileMasterStore } from 'footprintjs-iac/master/workflow';
import { DashboardController } from '../src/server/index.ts';
import { createNeoVersionedReview, type NeoMasterHostOptions } from '../examples/neo-identity/master-workflow.ts';
import { neoMasterBinding, readNeoMasterCandidate } from '../examples/neo-identity/master-candidate.ts';
import { writeMasterJson } from '../examples/neo-identity/master-files.ts';
import { publishNeoMasterTarget } from '../examples/neo-identity/master-publication.ts';
import { neoMasterForwardArgs } from '../examples/neo-identity/master-forward.ts';

const hex = (value: string) => value.repeat(64);

/** Real engine, master ledger, recorder, controller and files; only external transports are local seams. */
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'neo-master-host-'))), directory = join(root, '1234abcd');
  t.after(() => rm(root, { recursive: true, force: true }));
  const target: IdentityTarget = { version: 1, id: '1234abcd', directory, context: 'kind-footprint-iac-recording-aaaa1111',
    kubeconfig: join(root, 'kubeconfig'), namespace: 'footprint-iac-identity-1234abcd', stateDirectory: join(directory, 'state'),
    neoPort: 61660, providerPort: 61661, ldapPort: 61662, issuer: 'http://127.0.0.1:61661/realms/neo',
    providerName: 'footprint-identity-1234abcd-provider', directoryName: 'footprint-identity-1234abcd-directory',
    fixtureDigest: hex('f'), sourceCommit: 'a'.repeat(40), images: {
      nodeImage: 'footprint-iac/neo-node:identity-' + hex('1'), pythonImage: 'footprint-iac/neo-python:identity-' + hex('2'),
      ldapImage: 'sha256:' + hex('3'), providerImage: 'sha256:' + hex('4'),
    } };
  const candidate = structuredClone(target);
  candidate.images.nodeImage = 'footprint-iac/neo-node:identity-' + hex('5');
  candidate.images.pythonImage = 'footprint-iac/neo-python:identity-' + hex('6');
  const targetPath = join(directory, 'target.json'), tree = 'b'.repeat(40), candidatePath = join(directory, 'candidates', tree, 'target.json');
  await writeMasterJson(targetPath, target);
  await writeMasterJson(join(directory, '../latest.json'), target);
  const canonicalBytes = await readFile(targetPath, 'utf8');
  await writeMasterJson(candidatePath, candidate);
  await writeMasterJson(join(directory, 'candidates', tree, 'source-review.json'), {
    baseCommit: target.sourceCommit, sourceTree: tree, imageId: 'sha256:' + hex('5'), image: candidate.images.nodeImage,
    pythonImageId: 'sha256:' + hex('6'), pythonImage: candidate.images.pythonImage,
    canonicalTargetSha256: createHash('sha256').update(canonicalBytes).digest('hex'),
  });
  const simulator = new SimulatorAdapter({ file: join(root, 'provider.json'), faults: { failBeforeApply: new Set() } });
  const adapter = (name: string): ResourceAdapter => ({ name, scope: simulator.scope + '/' + name, supportsSafeRetry: true,
    observe: simulator.observe.bind(simulator), apply: simulator.apply.bind(simulator), remove: simulator.remove.bind(simulator),
    waitReady: simulator.waitReady.bind(simulator) });
  const engine: NonNullable<NeoMasterHostOptions['engine']> = () => {
    const recorder = createDeploymentRecorder();
    return { recorder, engine: new InfraEngine({ adapters: [adapter('local-identity-fixture'), adapter('kubernetes')],
      store: new FileStateStore(target.stateDirectory), traceDirectory: join(directory, 'native-traces'),
      strategy: new ReconcileStrategy(1), recorders: [recorder], chartObservers: [recorder] }) };
  };
  const baseline = engine(target), graph = createIdentityGraph(target, { includeNeo: true });
  const result = await baseline.engine.apply(graph);
  assert.equal(result.ok, true);
  await writeMasterJson(join(directory, 'deployment.json'), { graph, result, events: baseline.recorder.getEvents() });
  simulator.calls.length = 0;
  const observed = { connections: 0, access: 0, forward: 0 };
  const dependencies: NeoMasterHostOptions = { engine, loadTarget: async path => JSON.parse(await readFile(path, 'utf8')) as IdentityTarget,
    checks: (expected, graph) => ({
      connectionReview: { adapter: { async check(request) {
        observed.connections++;
        assert.deepEqual(JSON.parse(await readFile(targetPath, 'utf8')), expected, 'connection admission follows canonical publication');
        assert.ok(observed.forward > 0, 'same-port connection is restored before probes');
        return { method: 'local-test-transport', target: request.connectionId, observedAt: Date.now(), latencyMs: 1, details: { status: 200 } };
      } } },
      identityReview: { stack: graph.name, label: 'Access verification', checks: [
        { id: 'reader', label: 'Reader', kind: 'access', expected: 'allowed' },
        { id: 'guest', label: 'Guest', kind: 'access', expected: 'denied' },
      ], resourceBindings: { reader: ['neo-app'], guest: ['neo-app'] }, adapter: { id: 'local-checks', async check(request) {
        observed.access++; return { verdict: request.expected, observedAt: Date.now(), latencyMs: 1 };
      } } },
    }),
    async restoreForward(selected) {
      observed.forward++; assert.equal(selected.neoPort, target.neoPort);
      assert.deepEqual(JSON.parse(await readFile(targetPath, 'utf8')), candidate);
    },
  };
  const host = async () => {
    const options = await createNeoVersionedReview(targetPath, candidatePath, dependencies);
    const controller = new DashboardController(options); await controller.initialize(); return controller;
  };
  return { directory, target, candidate, targetPath, candidatePath, canonicalBytes, dependencies, simulator, observed, host,
    store: new FileMasterStore(join(directory, 'master')) };
}

test('real native host adopts v1, reviews one app update, publishes only after v2 success, and reopens v2 without a redeploy', async t => {
  const f = await fixture(t), controller = await f.host();
  let state = await f.store.load();
  assert.equal(state.attempts.length, 1); assert.equal(state.attempts[0]?.kind, 'adopt');
  assert.equal(controller.getSnapshot().revisionReview?.status, 'available');
  assert.equal(f.simulator.calls.length, 0, 'opening and adopting never mutate infrastructure');
  assert.equal(await readFile(f.targetPath, 'utf8'), f.canonicalBytes);
  controller.start('revision-review'); await controller.whenIdle();
  const reviewed = controller.getSnapshot().revisionReview!;
  assert.equal(reviewed.status, 'ready'); assert.match(reviewed.reviewId!, /^[a-f0-9]{64}$/);
  assert.deepEqual(reviewed.resources!.filter(item => item.action !== 'noop').map(item => [item.resourceId, item.action]), [['neo-app', 'update']]);
  assert.equal(reviewed.resources!.filter(item => item.action === 'noop').length, 5);
  assert.ok(reviewed.resources!.find(item => item.resourceId === 'neo-app')!.changes!.some(change => change.before && change.after));
  assert.equal(f.simulator.calls.length, 0);
  assert.deepEqual(f.observed, { connections: 0, access: 0, forward: 0 });
  controller.start('revision-apply', reviewed.reviewId); await controller.whenIdle();
  const finished = controller.getSnapshot(); state = await f.store.load();
  assert.equal(finished.run?.status, 'passed'); assert.equal(finished.revisionReview?.status, 'applied');
  assert.equal(finished.revisionReview?.resources?.filter(item => item.action === 'noop').length, 5);
  assert.equal(finished.revisionReview?.current?.digest, state.appliedDigest);
  assert.deepEqual(f.simulator.calls.map(call => call.id), ['neo-app']);
  assert.deepEqual(f.observed, { connections: 3, access: 2, forward: 1 });
  assert.equal(finished.connections?.status, 'passed'); assert.equal(finished.identity?.status, 'passed');
  assert.deepEqual(JSON.parse(await readFile(f.targetPath, 'utf8')), f.candidate);
  assert.equal(state.candidateDigest, null); assert.equal(state.revisions.length, 2);
  assert.equal(state.revisions[1]?.parentDigest, state.revisions[0]?.digest);
  const reopened = await f.host();
  assert.equal(reopened.getSnapshot().graph?.digest, finished.graph?.digest);
  assert.equal(reopened.getSnapshot().run?.id, finished.run?.id);
  assert.equal(reopened.getSnapshot().revisionReview?.current?.digest, state.appliedDigest);
  assert.deepEqual(f.simulator.calls.map(call => call.id), ['neo-app'], 'reopening cannot roll the app back or deploy again');
});

test('failed host update retains v1 and canonical bindings, then re-review recovers the same candidate', async t => {
  const f = await fixture(t), controller = await f.host(), head = (await f.store.load()).appliedDigest;
  f.simulator.faults.failBeforeApply!.add('neo-app');
  controller.start('revision-review'); await controller.whenIdle();
  controller.start('revision-apply', controller.getSnapshot().revisionReview!.reviewId); await controller.whenIdle();
  let state = await f.store.load();
  assert.equal(controller.getSnapshot().run?.status, 'failed'); assert.equal(state.appliedDigest, head);
  assert.equal(state.attempts.at(-1)?.status, 'failed');
  assert.equal(await readFile(f.targetPath, 'utf8'), f.canonicalBytes);
  assert.deepEqual(f.observed, { connections: 0, access: 0, forward: 0 });
  await assert.rejects(() => publishNeoMasterTarget({ current: f.target, candidate: f.candidate,
    revision: state.revisions[1]!, state, canonicalBytes: f.canonicalBytes, directory: join(f.directory, 'master') }), /proven applied/);
  f.simulator.faults.failBeforeApply!.clear();
  controller.start('revision-review'); await controller.whenIdle();
  controller.start('revision-apply', controller.getSnapshot().revisionReview!.reviewId); await controller.whenIdle();
  state = await f.store.load();
  assert.equal(controller.getSnapshot().revisionReview?.status, 'applied');
  assert.equal(state.attempts.length, 3); assert.equal(state.attempts.at(-1)?.status, 'applied');
  assert.equal(state.appliedDigest, state.revisions[1]?.digest);
});

test('staged release admission refuses moved ownership, tampered receipt and stale canonical target', async t => {
  const f = await fixture(t);
  const admitted = await readNeoMasterCandidate(f.candidatePath, f.target);
  assert.deepEqual(admitted.target, f.candidate);
  const reordered = Object.fromEntries(Object.entries(f.target).reverse()) as unknown as IdentityTarget;
  assert.deepEqual(neoMasterBinding(reordered), neoMasterBinding(f.target));
  await writeMasterJson(f.candidatePath, { ...f.candidate, neoPort: 61659 });
  await assert.rejects(() => readNeoMasterCandidate(f.candidatePath, f.target), /ownership/);
  await writeMasterJson(f.candidatePath, f.candidate);
  await writeMasterJson(f.targetPath, { ...f.target, sourceCommit: 'c'.repeat(40) });
  await assert.rejects(() => readNeoMasterCandidate(f.candidatePath, f.target), /applied target changed/);
  assert.deepEqual(neoMasterForwardArgs(f.target).slice(-5), ['port-forward', 'deployment/neo', '61660:5230', '--address', '127.0.0.1']);
});

test('a canonical target change after review refuses the native update before provider effects', async t => {
  const f = await fixture(t), controller = await f.host(), head = (await f.store.load()).appliedDigest;
  controller.start('revision-review'); await controller.whenIdle();
  const review = controller.getSnapshot().revisionReview!;
  await writeMasterJson(f.targetPath, { ...f.target, neoPort: 61659 });
  controller.start('revision-apply', review.reviewId); await controller.whenIdle();
  assert.equal(controller.getSnapshot().run?.status, 'failed');
  assert.equal((await f.store.load()).appliedDigest, head);
  assert.equal((await f.store.load()).attempts.length, 1);
  assert.equal(f.simulator.calls.length, 0);
  assert.deepEqual(f.observed, { connections: 0, access: 0, forward: 0 });
});
