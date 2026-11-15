import test from 'node:test';
import assert from 'node:assert/strict';
import { system, bindSystem, simulationProfile } from 'footprintjs-iac';
import { AgentPlatformReview } from '../src/server/agent-platform-review.ts';
import type { AgentPlatformView } from '../src/core/agent-platform.ts';
import type { AgentPlatformContext, AgentPlatformHost, PublishAgentPlatform } from '../src/server/agent-platform-host.ts';

const graph = bindSystem(system('agent-review').addStorage('data', storage => storage.addDataStore('history', store => store.retainOnRemoval())).build(), simulationProfile({ artifacts: {} })).graph;
const digest = graph.digest, resourceId = graph.resources[0]!.id, revision = 'b'.repeat(64);
function view(agentStatus: 'ready' | 'failed' | 'incomplete' | 'unknown' | 'paused' = 'ready', version = revision): AgentPlatformView {
  return { version: 1, id: 'agents', label: 'Agents', busy: false, limitations: [], agents: [{
    id: 'neo', label: 'Neo', revisionId: version, status: 'unknown', canCheck: true, resourceIds: [resourceId],
    binding: { graphDigest: digest, targetId: 'local' }, limitations: [], conversations: [], capabilities: [],
    layers: [{ id: 'infrastructure', label: 'Infrastructure', status: 'unknown' },
      { id: 'environment', label: 'Environment', status: 'ready' },
      { id: 'agent', label: 'Agent', status: agentStatus,
        recording: { id: 'readiness', kind: 'readiness', runId: 'native-run', complete: true, source: 'native' } }],
  }] };
}
function context(): AgentPlatformContext {
  return { graph, target: { id: 'local' },
    application: { id: 'neo', label: 'Neo', phase: 'ready', busy: false, selection: { strategyId: 'host', targetId: 'local' },
      strategies: [{ id: 'host', label: 'Host', targets: [{ id: 'local', label: 'Local', requiresProfile: false, requiredInspectionCheckIds: [], requiredVerificationCheckIds: [] }] }],
      canInspect: true, canReview: false, canDeploy: false, deployment: { ok: true, status: 'promoted', promoted: true } },
    run: { id: 'native-run', status: 'passed', resources: [{ id: resourceId, status: 'ready' }], events: [],
      recording: { provenance: { runId: 'native-run', graphDigest: digest, stack: graph.name }, snapshot: { runId: 'native-run', commitLog: [{}] }, structure: {} } } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('an older refresh cannot replace a newer native agent check', async () => {
  const gate = deferred<AgentPlatformView>(); let reads = 0, observed: AgentPlatformView | undefined;
  const host: AgentPlatformHost = { version: 1, id: 'agents', label: 'Agents',
    async snapshot() { return ++reads === 1 ? view() : gate.promise; }, async check() { return view('failed'); } };
  const review = new AgentPlatformReview(host, context, value => { observed = value; });
  await review.initialize(); const refresh = review.action({ action: 'refresh' });
  await review.action({ action: 'check', agentId: 'neo' });
  gate.resolve(view()); await refresh; await review.whenIdle();
  assert.equal(observed?.agents[0]?.layers[2]?.status, 'failed');
  review.dispose();
});

test('unsettled native results cannot cause another check in the same revision', async () => {
  for (const state of ['incomplete', 'unknown', 'paused', 'missing', 'wrong-revision'] as const) {
    let checks = 0;
    const host: AgentPlatformHost = { version: 1, id: 'agents', label: 'Agents', async snapshot() { return view(); },
      async check() { checks++; const result = view(state === 'missing' || state === 'wrong-revision' ? 'ready' : state);
        if (state === 'missing') result.agents = []; if (state === 'wrong-revision') result.agents[0]!.revisionId = 'c'.repeat(64); return result; } };
    const review = new AgentPlatformReview(host, context, () => {}); await review.initialize();
    await review.action({ action: 'check', agentId: 'neo' }); await review.whenIdle();
    await assert.rejects(review.action({ action: 'check', agentId: 'neo' }), /unavailable|confirmed/i);
    assert.equal(checks, 1, state); review.dispose();
  }
});

test('a confirmed native failure can be checked again while an unrecorded failure cannot', async () => {
  for (const complete of [true, false]) {
    let checks = 0;
    const host: AgentPlatformHost = { version: 1, id: 'agents', label: 'Agents', async snapshot() { return view(); }, async check() {
      checks++; const result = view('failed'); result.agents[0]!.layers[2]!.recording!.complete = complete; return result;
    } };
    const review = new AgentPlatformReview(host, context, () => {}); await review.initialize();
    await review.action({ action: 'check', agentId: 'neo' }); await review.whenIdle();
    if (complete) { await review.action({ action: 'check', agentId: 'neo' }); await review.whenIdle(); assert.equal(checks, 2); }
    else { await assert.rejects(review.action({ action: 'check', agentId: 'neo' }), /unavailable|confirmed/i); assert.equal(checks, 1); }
    review.dispose();
  }
});

test('a completed check no longer accepts its retained live publisher', async () => {
  let publish!: PublishAgentPlatform, observed: AgentPlatformView | undefined;
  const host: AgentPlatformHost = { version: 1, id: 'agents', label: 'Agents', async snapshot() { return view(); },
    async check(_id, _context, next) { publish = next; return view('failed'); } };
  const review = new AgentPlatformReview(host, context, value => { observed = value; }); await review.initialize();
  await review.action({ action: 'check', agentId: 'neo' }); await review.whenIdle(); publish(view());
  assert.equal(observed?.agents[0]?.layers[2]?.status, 'failed'); review.dispose();
});

test('a context change during a read refreshes the latest context without another UI action', async () => {
  let current = context(), reads = 0; const gate = deferred<AgentPlatformView>();
  const host: AgentPlatformHost = { version: 1, id: 'agents', label: 'Agents', async snapshot() {
    reads++; return reads === 2 ? gate.promise : view();
  } };
  const review = new AgentPlatformReview(host, () => current, () => {}); await review.initialize();
  const refresh = review.action({ action: 'refresh' }); current = { ...current, run: { ...current.run!, id: 'next-run' } }; review.contextChanged();
  gate.resolve(view()); await refresh; await review.whenIdle(); assert.equal(reads, 3); review.dispose();
});

test('uncertainty is scoped to the checked revision and a new admitted revision remains checkable', async () => {
  let current = view(), checks = 0;
  const host: AgentPlatformHost = { version: 1, id: 'agents', label: 'Agents', async snapshot() { return current; }, async check() {
    checks++; if (checks === 1) throw Error('unconfirmed outcome'); return current;
  } };
  const review = new AgentPlatformReview(host, context, () => {}); await review.initialize();
  await review.action({ action: 'check', agentId: 'neo' }); await review.whenIdle();
  current = view('ready', 'c'.repeat(64)); await review.action({ action: 'refresh' });
  await review.action({ action: 'check', agentId: 'neo' }); await review.whenIdle(); assert.equal(checks, 2); review.dispose();
});
