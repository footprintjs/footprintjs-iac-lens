import test from 'node:test';
import assert from 'node:assert/strict';
import { system, bindSystem, simulationProfile } from 'footprintjs-iac';
import { projectAgentPlatformView } from '../src/core/agent-platform-project.ts';
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

function componentView(optional: 'pending' | 'running' | 'paused' | 'incomplete' | 'unknown' | 'failed' = 'pending', initial = false): AgentPlatformView {
  const result = view(initial ? 'unknown' : 'ready'), agent = result.agents[0]!;
  if (initial) { agent.layers[1]!.status = 'pending'; agent.layers[2]!.status = 'pending'; delete agent.layers[2]!.recording; }
  const childProof = { id: 'worker-proof', kind: 'readiness' as const, runId: 'worker-native', source: 'native' as const, complete: true };
  const phases = ['acquire', 'details', 'connect', 'verify'];
  agent.components = { version: 1, id: 'components', label: 'Components', digest: 'd'.repeat(64), binding: { graphDigest: digest, deploymentDigest: 'e'.repeat(64), revisionDigest: revision, targetId: 'local' },
    nodes: [{ id: 'worker', label: 'Worker', kind: 'execution', roles: ['worker'], required: true, selected: true, boundaryId: 'runtime', status: initial ? 'pending' : 'ready',
      progress: { completed: initial ? 0 : 4, total: 4, unit: 'stages', indeterminate: false }, stages: phases.map(id => ({ id, label: id, status: initial ? 'pending' : 'ready' })), ...initial ? {} : { recording: childProof } },
    { id: 'optional', label: 'Optional capability', kind: 'connection', roles: ['optional'], required: false, selected: true, status: initial ? 'pending' : optional,
      progress: { completed: 0, total: 4, unit: 'stages', indeterminate: optional === 'incomplete' }, stages: phases.map((id, index) => ({ id, label: id, status: !initial && optional === 'failed' && index === 0 ? 'failed' : 'pending' })),
      ...!initial && optional === 'failed' ? { recording: { ...childProof, id: 'optional-failure', runId: 'optional-native' } } : {} }],
    boundaries: [{ id: 'runtime', label: 'Runtime', kind: 'service', identityComponentId: 'worker', observed: !initial, status: initial ? 'pending' : 'ready',
      progress: { completed: initial ? 0 : 4, total: 4, unit: 'stages', indeterminate: false }, ...initial ? {} : { recording: childProof } }],
    relations: [], limitations: [], ...initial ? {} : { recording: { ...childProof, id: 'parent-proof', runId: 'parent-native' } } };
  return result;
}

test('a pending component registration remains checkable and a known optional failure remains settled', async () => {
  let checks = 0;
  const host: AgentPlatformHost = { version: 1, id: 'agents', label: 'Agents', async snapshot() { return componentView('pending', true); }, async check() { checks++; return componentView('failed'); } };
  const review = new AgentPlatformReview(host, context, () => {}); await review.initialize();
  await review.action({ action: 'check', agentId: 'neo' }); await review.whenIdle();
  await review.action({ action: 'check', agentId: 'neo' }); await review.whenIdle(); assert.equal(checks, 2); review.dispose();
});

test('an unfinished selected optional invocation cannot settle or authorize a second check', async () => {
  for (const optional of ['running', 'paused', 'incomplete', 'unknown'] as const) {
    let checks = 0;
    const host: AgentPlatformHost = { version: 1, id: 'agents', label: 'Agents', async snapshot() { return componentView('pending', true); }, async check() { checks++; return componentView(optional); } };
    let observed: AgentPlatformView | undefined;
    const review = new AgentPlatformReview(host, context, value => { observed = value; }); await review.initialize();
    await review.action({ action: 'check', agentId: 'neo' }); await review.whenIdle();
    assert.equal(observed?.agents[0]?.layers[2]?.status, 'incomplete', optional);
    await assert.rejects(review.action({ action: 'check', agentId: 'neo' }), /unavailable|confirmed/i); assert.equal(checks, 1, optional); review.dispose();
  }
});

test('retained optional unfinished work is not authorized by a permissive host flag', async () => {
  for (const optional of ['running', 'paused', 'incomplete', 'unknown'] as const) {
    let checks = 0;
    const host: AgentPlatformHost = { version: 1, id: 'agents', label: 'Agents', async snapshot() { return componentView(optional); }, async check() { checks++; return componentView('failed'); } };
    const review = new AgentPlatformReview(host, context, () => {}); await review.initialize();
    await assert.rejects(review.action({ action: 'check', agentId: 'neo' }), /unavailable|confirmed/i); assert.equal(checks, 0, optional); review.dispose();
  }
});

test('missing or incomplete component parent proof blocks retained success and failure before another effect', async () => {
  for (const complete of [undefined, false]) for (const outcome of ['ready', 'failed'] as const) {
    let checks = 0; const retained = componentView('failed'); retained.agents[0]!.layers[2]!.status = outcome;
    if (complete === undefined) delete retained.agents[0]!.components!.recording; else retained.agents[0]!.components!.recording!.complete = complete;
    assert.equal(projectAgentPlatformView(retained, context()).agents[0]?.status, 'incomplete');
    assert.equal(projectAgentPlatformView(retained, context()).agents[0]?.canCheck, false);
    const host: AgentPlatformHost = { version: 1, id: 'agents', label: 'Agents', async snapshot() { return retained; }, async check() { checks++; return componentView('failed'); } };
    const review = new AgentPlatformReview(host, context, () => {}); await review.initialize();
    await assert.rejects(review.action({ action: 'check', agentId: 'neo' }), /unavailable|confirmed/i); assert.equal(checks, 0, outcome); review.dispose();
  }
});
