import test from 'node:test';
import assert from 'node:assert/strict';
import { readApplicationSourceView, type ApplicationSourceView } from '../src/core/application-source.ts';
import { readApplicationPublication } from '../src/server/application-publication.ts';
import { ApplicationReview } from '../src/server/application.ts';
import type { ApplicationHost } from '../src/server/application-host.ts';
import { compileGraph } from 'footprintjs-iac/graph';
import { readDashboardState } from '../src/core/client.ts';
import { projectAgentPlatformView, agentContextKey } from '../src/core/agent-platform-project.ts';
import { readAgentPlatformView } from '../src/core/agent-platform-read.ts';
import type { DashboardState } from '../src/core/types.ts';
import type { AgentPlatformView } from '../src/core/agent-platform.ts';

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
