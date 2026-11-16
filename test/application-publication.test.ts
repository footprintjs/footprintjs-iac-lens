import assert from 'node:assert/strict';
import test from 'node:test';
import { bindSystem, simulationProfile, system } from 'footprintjs-iac';
import { createDeploymentRecorder } from 'footprintjs-iac/progress';
import { readApplicationPublication } from '../src/server/application-publication.ts';
import { readDashboardState } from '../src/core/client.ts';
import type { ApplicationSourceView } from '../src/core/application-source.ts';
import type { ApplicationView } from '../src/core/application.ts';
import { DashboardController } from '../src/server/controller.ts';
import type { ApplicationHost } from '../src/server/application-host.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('native declaration and binding readers admit a complete portable system projection', () => {
  const design = system('publication-shape').addStorage('data', storage => storage.addDataStore('history', store => store.retainOnRemoval())).build();
  const binding = bindSystem(design, simulationProfile({ artifacts: {} }));
  const input = { design, binding, graph: binding.graph, artifacts: [{ id: 'graph', path: 'graph.json', content: JSON.stringify(binding.graph) }],
    recording: { snapshot: { runId: 'native-recording', commitLog: [] }, structure: { stages: [] } } };
  const admitted = readApplicationPublication(input);
  assert.deepEqual(admitted, input); assert.notEqual(admitted, input); assert.notEqual(admitted.artifacts, input.artifacts);
  assert.equal(input.binding.graph.digest, binding.graph.digest);
});
test('every optional application publication field rejects malformed data before it can replace viewer state', () => {
  const invalid: unknown[] = [
    { graph: {} }, { design: {} }, { binding: {} }, { artifacts: 'bad' }, { artifacts: [{ id: 'one', path: 'one.json', content: 7 }] },
    { recording: { snapshot: {}, structure: {} } }, { recording: { snapshot: { runId: 'run' }, structure: 'bad' } },
    { run: { id: 'run', status: 'passed', resources: 'bad', events: [] } },
    { connections: { id: 'connection-run', status: 'passed', checks: 'bad', events: [] } },
    { identity: { id: 'identity-run', status: 'passed', checks: [{ checkId: 'login', status: 'passed', password: 'private' }], events: [] } },
    { target: { id: 'one', command: 'execute' } }, { systemView: {} }, { schedulePreview: {} }, { changeAssessment: {} },
    { neoUrl: 'javascript:unexpected()' }, { appAccess: { status: 'ready', password: 'private' } }, { phase: 'ready' },
  ];
  for (const input of invalid) assert.throws(() => readApplicationPublication(input), Error, JSON.stringify(input));
  let accessed = false; const input = Object.defineProperty({}, 'artifacts', { enumerable: true, get() { accessed = true; return []; } });
  assert.throws(() => readApplicationPublication(input)); assert.equal(accessed, false);
});

test('Neo native progress retains recorded provenance and rejects another run before publication', () => {
  const graph = bindSystem(system('native-publication').addStorage('data', storage => storage.addDataStore('history', store => store.retainOnRemoval())).build(), simulationProfile({ artifacts: {} })).graph;
  const resourceId = graph.resources[0]!.id, recorder = createDeploymentRecorder();
  recorder.onEmit!({ name: 'iac.resource.progress', payload: { version: 1, runId: 'native-run', resourceId, status: 'deploying', action: 'create' },
    timestamp: 123, runtimeStageId: 'resource-stage' } as Parameters<NonNullable<typeof recorder.onEmit>>[0]);
  // Neo's public projector retains the recorder fields, adding only the viewer resource ID.
  const snapshot = recorder.getSnapshot();
  const publication = { graph, run: { id: snapshot.runId!, status: 'running' as const,
    resources: graph.resources.map(resource => ({ ...(snapshot.resources[resource.id] ?? { status: 'pending' as const }), id: resource.id })), events: [...snapshot.events] } };
  const admitted = readApplicationPublication(publication);
  assert.deepEqual(admitted.run?.events, publication.run.events);
  assert.deepEqual(admitted.run?.resources, publication.run.resources);
  assert.equal((admitted.run?.events[0] as { runId: string }).runId, 'native-run');
  for (const collection of ['resources', 'events'] as const) {
    for (const patch of [{ runId: 'other-run' }, { version: 2 }, { privateToken: 'PRIVATE-PROVIDER-TOKEN' }, { sequence: 0 }, { runtimeStageId: undefined }, { status: undefined }]) {
      const invalid = structuredClone(publication);
      Object.assign(invalid.run[collection][0] as unknown as Record<string, unknown>, patch);
      assert.throws(() => readApplicationPublication(invalid));
    }
  }
});

test('final native commit replay replaces running progress without inventing missing timestamps', () => {
  const graph = bindSystem(system('replayed-native-publication').addStorage('data', storage => storage.addDataStore('history', store => store.retainOnRemoval())).build(), simulationProfile({ artifacts: {} })).graph;
  // This is the exact final projection shape from Neo's retained real deployment:
  // progress writes contain no time; replay adds the recorded stage and sequence.
  const events = graph.resources.map((resource, index) => ({ version: 1 as const, runId: 'retained-native-run', resourceId: resource.id,
    status: 'ready' as const, action: 'noop', runtimeStageId: `execute-resource#${index}`, sequence: index + 1 }));
  const publication = { graph, run: { id: 'retained-native-run', status: 'passed' as const,
    resources: events.map(event => ({ ...event, id: event.resourceId })), events } };
  const current = { revision: 1, busy: true, graph, run: { ...publication.run, status: 'running' as const } };
  const admitted = readApplicationPublication(publication, current);
  assert.equal(admitted.run?.status, 'passed');
  assert.deepEqual(admitted.run?.events, events);
  assert.equal(admitted.run?.events.some(event => 'timestamp' in event), false);
  for (const timestamp of ['not-a-native-time', Infinity, null]) {
    const invalid = structuredClone(publication);
    Object.assign(invalid.run.events[0]!, { timestamp });
    assert.throws(() => readApplicationPublication(invalid, current));
  }
});

test('a retained source and native deployment publication is a partial projection until attached to its exact application selection', async t => {
  const graph = bindSystem(system('retained-source-publication').addStorage('data', storage => storage.addDataStore('history', store => store.retainOnRemoval())).build(), simulationProfile({ artifacts: {} })).graph;
  const selection = { strategyId: 'systemd', targetId: 'office' };
  const source: ApplicationSourceView = { version: 1, id: 'source', label: 'Code', providerId: 'git-source', binding: selection,
    definitionDigest: 'a'.repeat(64), receiptDigest: 'b'.repeat(64), recipeDigest: 'c'.repeat(64), configurationDigest: 'd'.repeat(64), repository: 'https://github.com/company/app.git', ref: 'main', commit: 'e'.repeat(40), tree: 'f'.repeat(40), status: 'ready',
    stages: ['resolve', 'fetch', 'build', 'publish'].map(id => ({ id: id as ApplicationSourceView['stages'][number]['id'], label: id, status: 'passed' })),
    recording: { id: 'source-proof', kind: 'release-build', source: 'native', complete: true, runId: 'native-source' } };
  const publication = { source, graph, target: { id: selection.targetId }, recording: { snapshot: { runId: 'native-deploy', commitLog: [] }, structure: { stages: [] } },
    run: { id: 'native-deploy', status: 'failed' as const, resources: graph.resources.map(resource => ({ id: resource.id, status: 'failed' as const })), events: [] } };
  assert.deepEqual(readApplicationPublication(publication), publication);
  const application: ApplicationView = { id: 'app', label: 'App', selection, phase: 'incomplete', busy: false, canInspect: false, canReview: false, canDeploy: false,
    strategies: [{ id: 'systemd', label: 'Server', targets: ['office', 'other'].map(id => ({ id, label: id, requiresProfile: false, requiresSource: true, requiredInspectionCheckIds: ['host'], requiredVerificationCheckIds: ['health'] })) }] };
  const current = { revision: 1, busy: false, graph, application };
  assert.deepEqual(readApplicationPublication(publication, current), publication);
  assert.throws(() => readApplicationPublication({ ...publication, source: { ...source, binding: { ...selection, targetId: 'other' } } }, current), /different selection/);
  assert.throws(() => readDashboardState({ revision: 1, busy: false, ...publication }), /different selection/);
  assert.throws(() => readDashboardState({ ...current, ...publication, application: { ...application, selection: { ...selection, targetId: 'other' } } }), /different selection/);
  const directory = await mkdtemp(join(tmpdir(), 'lens-retained-source-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let effects = 0;
  const host: ApplicationHost = { version: 1, id: 'app', label: 'App', strategies: application.strategies,
    async inspect() { effects++; throw Error('must not inspect'); }, async plan() { effects++; throw Error('must not plan'); }, async apply() { effects++; throw Error('must not apply'); }, async reconcile() { effects++; },
    async snapshot() { return { selection, publication, incomplete: true, deployment: { ok: false, promoted: false, status: 'incomplete' }, reconciliation: { reviewId: 'old-review', status: 'available' } }; } };
  const controller = new DashboardController({ directory, applicationHost: host }); t.after(() => controller.dispose()); await controller.initialize();
  const restored = readDashboardState(controller.getSnapshot());
  assert.equal(restored.application?.reconciliation?.status, 'available'); assert.deepEqual(restored.application?.selection, selection); assert.equal(restored.application?.error, undefined);
  assert.equal(restored.graph?.digest, graph.digest); assert.deepEqual(restored.source, source); assert.equal(restored.run?.status, 'failed'); assert.equal(effects, 0);
});
