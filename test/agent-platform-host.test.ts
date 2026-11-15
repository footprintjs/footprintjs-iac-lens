import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DashboardController } from '../src/server/controller.ts';
import { readAgentPlatformAction, readAgentPlatformView } from '../src/core/agent-platform-read.ts';
import { projectAgentPlatformView } from '../src/core/agent-platform-project.ts';
import type { AgentPlatformHost } from '../src/server/agent-platform-host.ts';
import type { AgentPlatformView } from '../src/core/agent-platform.ts';

function view(): AgentPlatformView {
  return { version: 1, id: 'agents', label: 'Registered agents', busy: false, limitations: [], agents: [{
    id: 'neo', label: 'Neo', status: 'unknown', resourceIds: [], canCheck: false, limitations: [], conversations: [], capabilities: [],
    layers: [{ id: 'infrastructure', label: 'Infrastructure', status: 'unknown' }, { id: 'environment', label: 'Environment', status: 'unknown' },
      { id: 'agent', label: 'Agent', status: 'unknown' }],
  }] };
}
test('the agent host stays unloaded until explicitly opened, without replacing infrastructure', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lens-agent-host-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let loaded = 0, snapshots = 0, checks = 0;
  const host: AgentPlatformHost = { version: 1, id: 'agents', label: 'Registered agents', async snapshot() { snapshots++; return view(); },
    async check() { checks++; throw Error('must not execute on open'); } };
  const options = { directory, agentPlatform: async () => { loaded++; return host; } };
  const controller = new DashboardController(options); t.after(() => controller.dispose());
  await controller.initialize(); const initial = controller.getSnapshot();
  assert.equal(initial.agentPlatformAvailable, true); assert.equal(initial.agentPlatform, undefined); assert.equal(loaded, 0);
  await controller.agentPlatformAction({ action: 'open' });
  assert.equal(loaded, 1); assert.equal(snapshots, 1); assert.equal(checks, 0);
  assert.equal(controller.getSnapshot().agentPlatform?.agents[0]?.id, 'neo');
  assert.deepEqual(controller.getSnapshot().graph, initial.graph);
  await controller.agentPlatformAction({ action: 'open' }); assert.equal(loaded, 1); assert.equal(snapshots, 1);
  await controller.agentPlatformAction({ action: 'refresh' }); assert.equal(snapshots, 2); assert.equal(checks, 0);
  await assert.rejects(controller.agentPlatformAction({ action: 'check', agentId: 'neo' }), /deployment|unavailable|check/i);
  assert.equal(checks, 0);
});
test('agent observations reject raw payloads, forged ready turns and unsupported proof claims', () => {
  const sample = view(); assert.deepEqual(readAgentPlatformView(sample), sample);
  assert.throws(() => readAgentPlatformView({ ...sample, token: 'private-token' }));
  assert.throws(() => readAgentPlatformView({ ...sample, agents: [{ ...sample.agents[0], capabilities: [{ id: 'sandbox', label: 'Sandbox', status: 'supported' }] }] }));
  assert.throws(() => readAgentPlatformView({ ...sample, agents: [{ ...sample.agents[0], conversations: [{ id: 'conversation', status: 'ready', turns: [{ id: 'turn', status: 'ready', stages: [] }] }] }] }));
  assert.throws(() => readAgentPlatformView({ ...sample, agents: [{ ...sample.agents[0], prompt: 'private prompt' }] }));
  assert.throws(() => readAgentPlatformAction({ action: 'check', agentId: 'neo', command: 'execute arbitrary code' }));
  assert.throws(() => readAgentPlatformAction({ action: 'check', agentId: '../another-target' }));
});
test('deployment alone cannot mark an agent ready and a changed graph demotes earlier readiness', () => {
  const sample = view(); sample.agents[0]!.layers = [sample.agents[0]!.layers[0]!, { id: 'environment', label: 'Environment', status: 'ready' },
    { id: 'agent', label: 'Agent', status: 'ready', recording: { id: 'readiness', runId: 'native-readiness', kind: 'readiness', source: 'native', complete: true } }];
  const projected = projectAgentPlatformView(sample, { graph: null });
  assert.equal(projected.agents[0]?.status, 'unknown'); assert.equal(projected.agents[0]?.canCheck, false);
  assert.equal(projected.agents[0]?.layers[2]?.status, 'unknown');
});

test('private host failures never become public refresh errors', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lens-agent-private-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let reject = false;
  const host: AgentPlatformHost = { version: 1, id: 'agents', label: 'Registered agents', async snapshot() {
    if (reject) throw Object.assign(new Error('private-access-key-value'), { status: 401 }); return view();
  } };
  const controller = new DashboardController({ directory, agentPlatform: host }); t.after(() => controller.dispose());
  await controller.initialize(); await controller.agentPlatformAction({ action: 'open' }); reject = true;
  await assert.rejects(controller.agentPlatformAction({ action: 'refresh' }), error => {
    assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /private-access-key-value/); return true;
  });
});

test('domain deployment provenance admits a separate native runtime identity', async () => {
  const { system, bindSystem, simulationProfile } = await import('footprintjs-iac');
  const graph = bindSystem(system('agent-provenance').addStorage('data', s => s.addDataStore('history', store => store.retainOnRemoval())).build(), simulationProfile({ artifacts: {} })).graph;
  const sample = view(), item = sample.agents[0]!;
  item.binding = { graphDigest: graph.digest, targetId: 'registered-target' }; item.resourceIds = graph.resources.map(r => r.id); item.canCheck = true;
  const context: any = { graph, application: { selection: { strategyId: 'systemd', targetId: 'registered-target' }, phase: 'ready', busy: false, deployment: { promoted: true } },
    run: { id: 'domain-deployment', status: 'passed', resources: item.resourceIds.map(id => ({ id, status: 'ready' })), events: [],
      recording: { provenance: { runId: 'domain-deployment', stack: graph.name, graphDigest: graph.digest }, snapshot: { runId: 'native-runtime', commitLog: [{}] }, structure: {} } } };
  const projected = projectAgentPlatformView(sample, context);
  assert.equal(projected.agents[0]?.layers[0]?.status, 'ready'); assert.equal(projected.agents[0]?.canCheck, true);
  assert.equal(projected.agents[0]?.layers[0]?.recording?.runId, 'domain-deployment');
  context.run.recording.provenance.runId = 'foreign-deployment';
  assert.equal(projectAgentPlatformView(sample, context).agents[0]?.layers[0]?.status, 'incomplete');
});

test('agent observations bound total stages before mapping oversized histories', () => {
  const sample = view(), stages = Array.from({ length: 4096 }, (_, i) => ({ id: 'stage-' + i, label: 'Stage', status: 'ready' as const }));
  sample.agents[0]!.conversations = [{ id: 'conversation', status: 'unknown', turns: Array.from({ length: 5 }, (_, i) => ({ id: 'turn-' + i, status: 'unknown' as const, stages })) }];
  assert.throws(() => readAgentPlatformView(sample));
});

test('native runtime stage identities retain visit numbers and nested drill paths', () => {
  const sample = view();
  sample.agents[0]!.conversations = [{ id: 'conversation', status: 'running', turns: [{ id: 'turn', status: 'running', stages: [
    { id: 'final/prepare-final#103', runtimeStageId: 'final/prepare-final#103', label: 'Recorded stage', status: 'running', sequence: 171 },
  ] }] }];
  assert.deepEqual(readAgentPlatformView(sample).agents[0]?.conversations[0]?.turns[0]?.stages, sample.agents[0]?.conversations[0]?.turns[0]?.stages);
  assert.throws(() => readAgentPlatformAction({ action: 'check', agentId: 'foreign/agent#103' }));
});
