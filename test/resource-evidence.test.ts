import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileGraph, FileStateStore, InfraEngine, loadEvidence, SimulatorAdapter } from 'footprintjs-iac';
import { createDeploymentRecorder } from 'footprintjs-iac/progress';
import { projectDeploymentFlow } from '../src/core/deployment-flow.ts';
import { untestedConnections } from '../src/core/connections.ts';
import { layoutResources } from '../src/core/layout.ts';
import { projectResourceEvidence } from '../src/core/resource-evidence.ts';
import type { DashboardState } from '../src/core/types.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }): Promise<DashboardState> {
  const directory = await mkdtemp(join(tmpdir(), 'iac-resource-evidence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const graph = compileGraph({ name: 'resource-evidence', boundaries: [], memberships: [], resources: [
    { id: 'space', provider: 'simulator', spec: { kind: 'Namespace' } },
    { id: 'app', provider: 'simulator', dependsOn: ['space'], spec: { kind: 'Deployment', metadata: { name: 'neo' } } },
    { id: 'endpoint', provider: 'simulator', dependsOn: ['app'], spec: { kind: 'Service' } },
  ], relations: [{ from: 'endpoint', to: 'app', kind: 'communicatesWith' }] });
  const recorder = createDeploymentRecorder();
  const engine = new InfraEngine({ adapters: [new SimulatorAdapter()], recorders: [recorder], chartObservers: [recorder],
    store: new FileStateStore(join(directory, 'state')) });
  const result = await engine.apply(graph);
  assert.equal(result.ok, true);
  const snapshot = recorder.getSnapshot(), evidence = await loadEvidence(result.evidencePath);
  return { revision: 1, busy: false, graph, systemView: { blocks: [
    { id: 'compute', label: 'Compute', family: 'compute', units: [{ id: 'execution', label: 'Neo app', resourceIds: ['app'], mode: 'embedded' }] },
    { id: 'storage', label: 'Storage', family: 'storage', units: [{ id: 'state', label: 'Embedded SQLite', resourceIds: ['app'], mode: 'embedded' }] },
  ] }, run: { id: result.runId, status: 'passed', chart: snapshot.chart!,
    resources: Object.values(snapshot.resources).map(progress => ({ ...progress, id: progress.resourceId })),
    events: [...snapshot.events], report: { results: result.results },
    recording: { snapshot: evidence.snapshot, structure: evidence.structure } } };
}

test('one resource selection links both views to its actual native operation and shared capabilities', async t => {
  const state = await fixture(t), before = structuredClone(state);
  const deployment = projectDeploymentFlow(state).nodes.find(node => node.id === 'app')!;
  const running = layoutResources(state, 'running-system').nodes.find(node => node.id === 'app')!;
  const evidence = projectResourceEvidence(state, running.id)!;
  assert.equal(deployment.id, running.id);
  assert.equal(evidence.resource.id, deployment.id);
  assert.equal(evidence.resource.provider, 'simulator');
  assert.deepEqual(evidence.declaredDependencies, ['space']);
  assert.deepEqual(evidence.capabilities.map(unit => [unit.family, unit.label, unit.mode]), [
    ['compute', 'Neo app', 'embedded'], ['storage', 'Embedded SQLite', 'embedded'],
  ]);
  assert.equal(evidence.progress.status, 'ready');
  assert.equal(evidence.deployment.runId, state.run!.id);
  assert.equal(evidence.deployment.nativeStages!.resourceId, 'app');
  assert.equal(evidence.deployment.nativeStages!.action, 'create');
  assert.ok(evidence.deployment.events.some(event => event.status === 'deploying'
    && event.runtimeStageId?.startsWith(evidence.deployment.nativeStages!.executeStageId)));
  assert.deepEqual(evidence.deployment.observed, deployment.observed);
  assert.equal((evidence.deployment.result as { status: string }).status, 'complete');
  assert.equal(evidence.deployment.recordingAvailable, true);
  assert.deepEqual(evidence.deployment.warnings, []);
  assert.deepEqual(state, before, 'selection only projects the supplied declarations and recordings');
  assert.equal(projectResourceEvidence(state, 'missing'), undefined);
});

test('older event-only recordings remain inspectable without fabricating native stage bindings or execution order', async t => {
  const state = await fixture(t);
  delete state.run!.chart;
  delete state.run!.recording;
  state.run!.events = state.run!.events.map(({ sequence, seq, ...event }) => event);
  const evidence = projectResourceEvidence(state, 'app')!;
  assert.equal(evidence.deployment.nativeStages, undefined);
  assert.equal(evidence.deployment.observed, undefined);
  assert.equal(evidence.deployment.events.length, 3);
  assert.ok(evidence.deployment.events.some(event => event.runtimeStageId && event.status === 'ready'));
  assert.equal(evidence.deployment.recordingAvailable, false);
  assert.ok(evidence.deployment.warnings.some(warning => /sequence/.test(warning)));
});

test('foreign charts and events cannot link a resource to another recorded run', async t => {
  const state = await fixture(t);
  state.run!.chart = { ...state.run!.chart!, runId: 'another-run' };
  state.run!.events = state.run!.events.map(event => ({ ...event, runId: 'another-run' }));
  const evidence = projectResourceEvidence(state, 'app')!;
  assert.equal(evidence.deployment.nativeStages, undefined);
  assert.equal(evidence.deployment.observed, undefined);
  assert.deepEqual(evidence.deployment.events, []);
  assert.ok(evidence.deployment.warnings.some(warning => /another run/.test(warning)));
  assert.ok(evidence.deployment.warnings.some(warning => /native deployment chart/.test(warning)));
});

test('resource readiness stays independent of scoped connection and identity verification', async t => {
  const state = await fixture(t);
  const communication = untestedConnections(state.graph!).checks[0]!;
  state.connections = { id: 'connections', status: 'failed', events: [], checks: [
    { ...communication, status: 'failed', message: 'HTTP path unavailable' },
    { connectionId: 'unrelated', from: 'space', to: 'endpoint', status: 'connected' },
  ] };
  state.identity = { id: 'identity', label: 'Identity', status: 'passed', events: [], checks: [
    { checkId: 'reader', label: 'Reader allowed', kind: 'access', expected: 'allowed', status: 'passed', resourceIds: ['app'],
      observation: { verdict: 'allowed', observedAt: 1000, latencyMs: 2 } },
    { checkId: 'unbound', label: 'Unbound login', kind: 'login', expected: 'authenticated', status: 'passed',
      observation: { verdict: 'authenticated', observedAt: 1000, latencyMs: 2 } },
    { checkId: 'foreign', label: 'Other resource', kind: 'access', expected: 'denied', status: 'passed', resourceIds: ['endpoint'],
      observation: { verdict: 'denied', observedAt: 1000, latencyMs: 2 } },
  ] };
  const evidence = projectResourceEvidence(state, 'app')!;
  assert.equal(evidence.progress.status, 'ready');
  assert.deepEqual(evidence.verification.connections.map(check => [check.connectionId, check.status]), [[communication.connectionId, 'failed']]);
  assert.deepEqual(evidence.verification.identity.map(check => check.checkId), ['reader']);
  assert.deepEqual(projectResourceEvidence(state, 'space')!.verification, { connections: [], identity: [] });
  delete state.connections;
  assert.equal(projectResourceEvidence(state, 'app')!.verification.connections[0]!.status, 'untested');
});

test('adapter bindings and capability descriptions require matching design and graph commitments', async t => {
  const state = await fixture(t);
  delete state.systemView;
  state.design = { kind: 'system-design', version: 1, name: 'logical', digest: 'a'.repeat(64), principals: [], boundaries: [], memberships: [], relations: [],
    capabilities: [{ id: 'execution', path: 'application.execution', family: 'compute', kind: 'service', properties: {}, defaults: {} }] };
  state.binding = { kind: 'system-binding', version: 1, profileId: 'local', targetId: 'local', target: { id: 'local' },
    designDigest: state.design.digest, graph: state.graph!, decisions: [], digest: 'b'.repeat(64), mappings: [
      { capabilityId: 'execution', capabilityPath: 'application.execution', adapterId: 'local-process', targetId: 'local', mode: 'real',
        resourceIds: ['app'], entryPoints: ['app'], exitPoints: ['app'], groupId: 'execution' },
    ] };
  let evidence = projectResourceEvidence(state, 'app')!;
  assert.equal(evidence.bindings[0]!.adapterId, 'local-process');
  assert.equal(evidence.description.capability, 'application.execution');
  assert.equal(evidence.capabilities[0]!.label, 'application.execution');
  state.binding = { ...state.binding, graph: { ...state.graph!, digest: 'f'.repeat(64) } };
  evidence = projectResourceEvidence(state, 'app')!;
  assert.deepEqual(evidence.bindings, []);
  assert.equal(evidence.description.capability, undefined);
  assert.deepEqual(evidence.capabilities, []);
});
