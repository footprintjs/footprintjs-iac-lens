import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationSourceIdentity, readApplicationSourceView, type ApplicationSourceView } from '../src/core/application-source.ts';
import { readApplicationPublication } from '../src/server/application-publication.ts';
import { ApplicationReview } from '../src/server/application.ts';
import type { ApplicationHost } from '../src/server/application-host.ts';
import { compileGraph } from 'footprintjs-iac/graph';
import { readDashboardState } from '../src/core/client.ts';
import { projectAgentPlatformView, agentContextKey } from '../src/core/agent-platform-project.ts';
import { readAgentPlatformView } from '../src/core/agent-platform-read.ts';
import type { DashboardState } from '../src/core/types.ts';
import type { AgentPlatformView } from '../src/core/agent-platform.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReleasePreparationWorkflow, FileReleasePreparationStore, loadReleaseBuildRecording } from 'footprintjs-iac/releases/node';

const selection = { strategyId: 'systemd', targetId: 'office' };
function source(version = 'a'): ApplicationSourceView {
  return { version: 1, id: 'source-input', label: 'Application code', providerId: 'git-source', binding: selection,
    definitionDigest: 'a'.repeat(64), receiptDigest: version.repeat(64), recipeDigest: 'b'.repeat(64), configurationDigest: 'c'.repeat(64), repository: 'https://github.com/company/application.git', ref: 'main', status: 'ready',
    commit: version.repeat(40), tree: 'd'.repeat(40), stages: ['resolve', 'fetch', 'build', 'publish'].map(id => ({ id: id as ApplicationSourceView['stages'][number]['id'], label: id, status: 'passed' })),
    recording: { id: 'source-proof-' + version, kind: 'source-preparation', runId: 'native-source-' + version, complete: true, source: 'native' } };
}
function fixture() {
  let current: ApplicationSourceView | undefined = source(), plans = 0, applies = 0, reads = 0;
  const host: ApplicationHost = { version: 1, id: 'app', label: 'Application', strategies: [{ id: 'systemd', label: 'Existing server', targets: [{ id: 'office', label: 'Office', requiresProfile: false,
    requiresSource: true, requiredInspectionCheckIds: ['host'], requiredVerificationCheckIds: ['health'] }] }],
    async inspect(_selection, publish) { if (current) publish({ source: current }); return { ok: true, checks: [{ id: 'host', label: 'Host', status: 'passed' }] }; },
    async plan() { plans++; return { ok: true, reviewId: 'sealed-' + plans, changes: [] }; },
    async apply() { applies++; return { ok: true, promoted: true, status: 'promoted', checks: [{ id: 'health', label: 'Health', status: 'passed' }] }; },
    async snapshot() { reads++; return { incomplete: false }; } };
  const review = new ApplicationReview(host, () => {});
  return { host, review, setSource(value: ApplicationSourceView | undefined) { current = value; }, counts: () => ({ plans, applies, reads }) };
}
async function inspect(f: ReturnType<typeof fixture>) {
  await f.review.initialize(); f.review.action({ action: 'select', ...selection }); f.review.action({ action: 'inspect' }); await f.review.whenIdle();
}
test('source views retain native phase identities and reject paths, credentials and unsupported ready claims', () => {
  assert.deepEqual(readApplicationSourceView(source()), source());
  for (const patch of [{ location: '/private/source' }, { repository: 'https://token:private@example.test/app.git' }, { recording: undefined }, { receiptDigest: undefined }, { commit: undefined }, { definitionDigest: 'wrong' }]) {
    assert.throws(() => readApplicationSourceView({ ...source(), ...patch }));
  }
  const pending = source(); pending.status = 'pending'; assert.throws(() => readApplicationSourceView(pending));
  const accessor = source(); let invoked = false;
  Object.defineProperty(accessor.stages, '0', { enumerable: true, get() { invoked = true; return {}; } });
  assert.throws(() => readApplicationSourceView(accessor)); assert.equal(invoked, false);
  assert.deepEqual(readApplicationPublication({ source: source() }).source, source());
});
test('one prepared release can supply source proof without being relabelled as another native workflow', () => {
  const release = { ...source(), recording: { ...source().recording!, kind: 'release-build' } };
  const admitted = readApplicationSourceView(release);
  assert.equal(admitted.recording?.kind, 'release-build');
  assert.equal(readApplicationPublication({ source: release }).source?.recording?.kind, 'release-build');
  assert.equal(readDashboardState({ ...readyContext(), source: release }).source?.recording?.kind, 'release-build');
  assert.notEqual(applicationSourceIdentity(source()), applicationSourceIdentity(admitted));
  assert.throws(() => readApplicationSourceView({ ...release, recording: { ...release.recording, kind: 'deployment' } }));
});
test('a native shared release build completes the existing inspect review deploy lifecycle without rebuilding', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lens-shared-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const selected = source(), nativeCalls: string[] = [];
  const definition = { id: 'build-once', label: 'Build once', target: { id: 'build-host', scope: 'approved-artifacts' },
    source: { repository: selected.repository, ref: selected.ref }, recipe: { id: 'application', digest: selected.recipeDigest }, configurationDigest: selected.configurationDigest };
  const preparation = new ReleasePreparationWorkflow({ definition, store: new FileReleasePreparationStore(directory), adapters: {
    source: { async resolve(input) { nativeCalls.push('resolve'); return { ...input, commit: selected.commit!, tree: selected.tree! }; },
      async fetch(revision) { nativeCalls.push('fetch'); return { revision, location: '/private/native-shared-source' }; } },
    build: { async build(_source, recipe) { nativeCalls.push('build'); return { recipeDigest: recipe.digest,
      artifacts: [{ id: 'application', digest: 'e'.repeat(64), reference: 'registry.example/application@sha256:' + 'e'.repeat(64) }] }; } },
    artifacts: { async publish(build) { nativeCalls.push('publish'); return { artifacts: build.artifacts }; } },
  } });
  const prepared = await preparation.start(); assert.equal(prepared.status, 'passed');
  const proof = prepared.recordings[0]!;
  await loadReleaseBuildRecording(proof.evidencePath, proof.tracePath, { runId: proof.runId, executionId: prepared.executionId!, definitionDigest: prepared.definitionDigest });
  const admitted: ApplicationSourceView = { ...selected, id: prepared.definition.id, label: prepared.definition.label,
    definitionDigest: prepared.definitionDigest, receiptDigest: prepared.release!.digest,
    commit: prepared.release!.source.commit, tree: prepared.release!.source.tree,
    stages: prepared.stages.map(stage => ({ ...stage, id: stage.id as ApplicationSourceView['stages'][number]['id'] })),
    recording: { id: 'release-' + proof.runId, kind: 'release-build', runId: proof.runId, complete: true, source: 'native' } };
  const f = fixture(); f.setSource(admitted);
  f.host.strategies[0]!.targets[0]!.requiredVerificationCheckIds = ['health', 'source-runtime'];
  const apply = f.host.apply.bind(f.host);
  f.host.apply = async (...args) => { const result = await apply(...args); return { ...result,
    checks: [...result.checks!, { id: 'source-runtime', label: 'Running package', status: 'passed' as const }], appUrl: 'https://app.example.test' }; };
  const published: ApplicationSourceView[] = [];
  const review = new ApplicationReview(f.host, (_view, publication) => { if (publication?.source) published.push(publication.source); });
  await review.initialize(); review.action({ action: 'select', ...selection });
  review.action({ action: 'inspect' }); await review.whenIdle(); assert.equal(review.snapshot().canReview, true);
  review.action({ action: 'review' }); await review.whenIdle(); assert.equal(review.snapshot().canDeploy, true);
  assert.equal(published.at(-1)?.recording?.kind, 'release-build'); assert.equal(published.at(-1)?.recording?.runId, proof.runId);
  for (let i = 0; i < 3; i++) review.snapshot();
  review.action({ action: 'deploy', reviewId: 'sealed-1' }); await review.whenIdle();
  assert.equal(review.snapshot().phase, 'ready'); assert.equal(review.snapshot().deployment?.appUrl, 'https://app.example.test');
  assert.deepEqual(f.counts(), { plans: 1, applies: 1, reads: 1 });
  assert.deepEqual(nativeCalls, ['resolve', 'fetch', 'build', 'publish']);
  assert.throws(() => review.action({ action: 'deploy', reviewId: 'sealed-1' }), /review/i);
  assert.deepEqual(await preparation.start(), prepared); assert.equal(nativeCalls.length, 4);
});
test('a source-required application cannot review or deploy without a complete bound source receipt', async () => {
  for (const value of [undefined, { ...source(), status: 'incomplete' as const }, { ...source(), binding: { ...selection, targetId: 'foreign' } }]) {
    const f = fixture(); f.setSource(value); await inspect(f);
    assert.equal(f.review.snapshot().canReview, false);
    assert.throws(() => f.review.action({ action: 'review' }), /setup|source|recorded/i); assert.deepEqual(f.counts(), { plans: 0, applies: 0, reads: 1 });
  }
});
test('a complete source can be reviewed once and opening or reading never fetches it', async () => {
  const f = fixture(); await inspect(f); assert.equal(f.review.snapshot().canReview, true);
  f.review.action({ action: 'review' }); await f.review.whenIdle(); assert.equal(f.review.snapshot().canDeploy, true);
  for (let i = 0; i < 3; i++) f.review.snapshot(); assert.deepEqual(f.counts(), { plans: 1, applies: 0, reads: 1 });
  f.review.action({ action: 'deploy', reviewId: 'sealed-1' }); await f.review.whenIdle(); assert.equal(f.review.snapshot().phase, 'ready'); assert.equal(f.counts().applies, 1);
});
test('a source receipt replaced during planning invalidates the review before an effect', async () => {
  const f = fixture(); f.host.plan = async (_selection, publish) => { publish({ source: source('e') }); return { ok: true, reviewId: 'old-source-review', changes: [] }; };
  const review = new ApplicationReview(f.host, () => {}); await review.initialize(); review.action({ action: 'select', ...selection });
  review.action({ action: 'inspect' }); await review.whenIdle(); review.action({ action: 'review' }); await review.whenIdle();
  assert.equal(review.snapshot().canDeploy, false); assert.throws(() => review.action({ action: 'deploy', reviewId: 'old-source-review' }), /review/i); assert.equal(f.counts().applies, 0);
});
test('a promoted receipt cannot restore when its required source proof is missing or mismatched', async () => {
  for (const value of [undefined, { ...source(), binding: { ...selection, targetId: 'foreign' } }]) {
    const f = fixture(); f.host.snapshot = async () => ({ selection, incomplete: false, deployment: { ok: true, promoted: true, status: 'promoted', checks: [{ id: 'health', label: 'Health', status: 'passed' }] },
      ...(value ? { publication: { source: value } } : {}) });
    const review = new ApplicationReview(f.host, () => {}); await review.initialize(); assert.equal(review.snapshot().phase, 'incomplete'); assert.notEqual(review.snapshot().deployment?.promoted, true);
  }
});
test('a source changed during apply cannot publish a promoted application', async () => {
  for (const live of [true, false]) {
    const f = fixture(); f.host.apply = async (_selection, publish) => {
      if (live) publish({ source: source('e') });
      return { ok: true, promoted: true, status: 'promoted', checks: [{ id: 'health', label: 'Health', status: 'passed' }], ...!live ? { publication: { source: source('e') } } : {} };
    };
    const review = new ApplicationReview(f.host, () => {}); await review.initialize(); review.action({ action: 'select', ...selection });
    review.action({ action: 'inspect' }); await review.whenIdle(); review.action({ action: 'review' }); await review.whenIdle();
    review.action({ action: 'deploy', reviewId: 'sealed-1' }); await review.whenIdle();
    assert.equal(review.snapshot().phase, 'incomplete'); assert.notEqual(review.snapshot().deployment?.promoted, true); assert.equal(review.snapshot().canDeploy, false);
  }
});
test('a package receipt cannot substitute for the additional source-runtime verification policy', async () => {
  const f = fixture(), publications: unknown[] = [];
  f.host.strategies[0]!.targets[0]!.requiredVerificationCheckIds = ['health', 'source-runtime'];
  f.host.apply = async () => ({ ok: true, promoted: true, status: 'promoted', checks: [{ id: 'health', label: 'Health', status: 'passed' }], appUrl: 'https://app.example.test',
    publication: { neoUrl: 'https://app.example.test', source: source() } });
  const review = new ApplicationReview(f.host, (_view, publication) => { if (publication) publications.push(publication); });
  await review.initialize(); review.action({ action: 'select', ...selection }); review.action({ action: 'inspect' }); await review.whenIdle();
  review.action({ action: 'review' }); await review.whenIdle(); review.action({ action: 'deploy', reviewId: 'sealed-1' }); await review.whenIdle();
  assert.equal(review.snapshot().phase, 'incomplete'); assert.notEqual(review.snapshot().deployment?.promoted, true); assert.equal(review.snapshot().deployment?.appUrl, undefined);
  assert.equal(JSON.stringify(publications).includes('https://app.example.test'), false);
});
function readyContext(): DashboardState {
  const graph = compileGraph({ name: 'source-bound-app', resources: [{ id: 'program', provider: 'registered-runtime', spec: {} }], boundaries: [], memberships: [], relations: [] });
  const f = fixture();
  return { revision: 1, busy: false, graph, source: source(), application: { id: f.host.id, label: f.host.label, strategies: f.host.strategies,
    selection, phase: 'ready', busy: false, canInspect: true, canReview: false, canDeploy: false,
    deployment: { ok: true, promoted: true, status: 'promoted', checks: [{ id: 'health', label: 'Health', status: 'passed' }] } },
    run: { id: 'native-infra', status: 'passed', resources: [{ id: 'program', status: 'ready' }], events: [],
      recording: { provenance: { runId: 'native-infra', graphDigest: graph.digest, stack: graph.name }, snapshot: { runId: 'native-infra', commitLog: [{}] }, structure: {} } } };
}
function agentView(state: DashboardState): AgentPlatformView {
  const proof = { id: 'worker-proof', runId: 'native-worker', kind: 'readiness' as const, source: 'native' as const, complete: true };
  return { version: 1, id: 'agents', label: 'Agents', busy: false, limitations: [], agents: [{ id: 'worker', label: 'Worker', resourceIds: ['program'], revisionId: 'e'.repeat(64), status: 'ready', canCheck: true, capabilities: [], conversations: [], limitations: [],
    binding: { graphDigest: state.graph!.digest, targetId: selection.targetId, sourceDigest: source().receiptDigest },
    layers: [{ id: 'infrastructure', label: 'Infrastructure', status: 'unknown' }, { id: 'environment', label: 'Environment', status: 'ready' }, { id: 'agent', label: 'Agent', status: 'ready', recording: proof }],
    components: { version: 1, id: 'components', label: 'Components', digest: 'f'.repeat(64), binding: { graphDigest: state.graph!.digest, targetId: selection.targetId, revisionDigest: 'e'.repeat(64), deploymentDigest: 'd'.repeat(64) },
      nodes: [{ id: 'worker', label: 'Worker', kind: 'execution', roles: ['worker'], status: 'ready', required: true, selected: true, progress: { completed: 4, total: 4, unit: 'stages', indeterminate: false }, recording: proof,
        stages: ['acquire', 'details', 'connect', 'verify'].map(id => ({ id, label: id, status: 'ready' })) }], boundaries: [], relations: [], limitations: [], recording: { ...proof, id: 'parent-proof', runId: 'native-parent' } } }] };
}
test('a promoted source-required dashboard rejects absent, unconfirmed and foreign source inputs', () => {
  const state = readyContext(); assert.equal(readDashboardState(state).source?.commit, source().commit);
  for (const change of [undefined, { ...source(), status: 'incomplete' as const }, { ...source(), binding: { ...selection, targetId: 'foreign' } }]) {
    assert.throws(() => readDashboardState({ ...state, source: change }));
  }
});
test('component readiness remains bound to the exact prepared source even when target and infrastructure are unchanged', () => {
  const state = readyContext(), view = readAgentPlatformView(agentView(state));
  assert.equal(projectAgentPlatformView(view, state).agents[0]?.status, 'ready'); assert.equal(projectAgentPlatformView(view, state).agents[0]?.canCheck, true);
  const next = { ...state, source: source('f') }; assert.notEqual(agentContextKey(state), agentContextKey(next));
  const stale = projectAgentPlatformView(view, next).agents[0]!;
  assert.notEqual(stale.status, 'ready'); assert.equal(stale.canCheck, false); assert.equal(stale.components, undefined);
  assert.equal(projectAgentPlatformView(view, { ...state, source: undefined }).agents[0]?.canCheck, false);
  const unbound = structuredClone(view); delete unbound.agents[0]!.binding!.sourceDigest;
  assert.equal(projectAgentPlatformView(unbound, state).agents[0]?.canCheck, false);
});
