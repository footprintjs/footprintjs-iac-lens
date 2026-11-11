import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileStateStore, InfraEngine, SimulatorAdapter } from 'footprint-iac';
import { compileGraph } from 'footprint-iac/graph';
import { createDeploymentRecorder, type DeploymentSchedulePreview } from 'footprint-iac/progress';
import { previewDeploymentChart } from 'footprint-iac/progress/preview';
import { projectBuildScene, projectDeploymentFlow, projectDeploymentSchedulePreview, readDashboardState,
  type DashboardState } from '../src/core/index.ts';
import { DashboardController } from '../src/server/index.ts';

function sixResources() {
  return compileGraph({ name: 'neo-preview', boundaries: [], memberships: [], relations: [], resources: [
    { id: 'identity-directory', provider: 'simulator', spec: { role: 'directory' } },
    { id: 'identity-provider', provider: 'simulator', dependsOn: ['identity-directory'], spec: { role: 'provider' } },
    { id: 'neo-namespace', provider: 'simulator', spec: { kind: 'Namespace' } },
    { id: 'neo-access-policy', provider: 'simulator', dependsOn: ['neo-namespace'], spec: { kind: 'ConfigMap' } },
    { id: 'neo-app', provider: 'simulator', dependsOn: ['neo-namespace', 'identity-provider', 'neo-access-policy'], spec: { kind: 'Deployment' } },
    { id: 'neo-service', provider: 'simulator', dependsOn: ['neo-app'], spec: { kind: 'Service' } },
  ] });
}

async function fixture(t: { after(fn: () => Promise<void>): void }, maxConcurrency = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'iac-schedule-preview-'));
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const graph = sixResources(), recorder = createDeploymentRecorder();
  const adapter = new SimulatorAdapter({ file: join(directory, 'provider.json'), faults: {
    async afterEffect(resource) { if (resource.id === 'identity-provider') { enter(); await held; } },
  } });
  const engine = new InfraEngine({ adapters: [adapter], store: new FileStateStore(join(directory, 'state')),
    traceDirectory: join(directory, 'traces'), maxConcurrency, recorders: [recorder], chartObservers: [recorder] });
  const plan = await engine.plan(graph);
  const schedulePreview = previewDeploymentChart(plan, { maxConcurrency, graphDigest: graph.digest });
  assert.equal(adapter.calls.length, 0, 'planning and preview construction perform no resource effects');
  assert.equal(recorder.getSnapshot().runId, null);
  assert.deepEqual(recorder.getSnapshot().events, []);
  assert.equal(recorder.getSnapshot().chart, undefined, 'a preview is not published as an executed chart');
  let applies = 0;
  const managedReview = { graph, recorder, schedulePreview, target: { label: 'Neo' },
    apply: async () => { applies++; return engine.apply(graph); } };
  const controller = new DashboardController({ directory: join(directory, 'viewer'), managedReview });
  await controller.initialize();
  const updates: DashboardState[] = [controller.getSnapshot()];
  const unsubscribe = controller.subscribe(() => updates.push(controller.getSnapshot()));
  t.after(async () => { release(); await controller.whenIdle(); unsubscribe(); await rm(directory, { recursive: true, force: true }); });
  return { directory, graph, recorder, adapter, schedulePreview, controller, managedReview, updates,
    entered, release, applies: () => applies };
}

function positions(state: DashboardState) {
  return Object.fromEntries(projectBuildScene(state).nodes.map(node => [node.id, [node.column, node.row]]));
}

for (const maxConcurrency of [1, 2]) {
  test(`native schedule preview keeps all six positions through an actual ${maxConcurrency === 1 ? 'serial' : 'parallel'} apply without inventing progress`, { timeout: 10_000 }, async t => {
    const host = await fixture(t, maxConcurrency), initial = host.controller.getSnapshot();
    const preview = projectDeploymentSchedulePreview(initial);
    assert.ok(preview.chart);
    assert.equal('runId' in preview.chart, false);
    assert.equal('runId' in host.schedulePreview, false);
    assert.equal(initial.run?.id, '');
    assert.deepEqual(initial.run?.events, []);
    assert.equal(initial.run?.chart, undefined);
    assert.equal(initial.run?.recording, undefined);
    assert.equal(initial.run?.status, 'idle');
    assert.equal(projectDeploymentFlow(initial).layoutSource, 'schedule-preview');
    const grey = projectBuildScene(initial);
    assert.deepEqual(grey.counts, { ready: 0, total: 6 });
    assert.equal(grey.headline, 'Ready to build');
    assert.deepEqual(grey.activeIds, []);
    assert.ok(grey.nodes.every(node => node.status === 'pending' && node.step === undefined && node.action === undefined));
    assert.ok(projectDeploymentFlow(initial).nodes.every(node => node.observed === undefined));
    assert.equal(preview.chart.batches.some(batch => batch.scheduledParallel), maxConcurrency === 2);
    const before = positions(initial);
    host.controller.start('review');
    const starting = host.controller.getSnapshot();
    assert.equal(starting.run?.id, '');
    assert.deepEqual(starting.run?.events, []);
    assert.deepEqual(positions(starting), before);
    await Promise.race([host.entered, host.controller.whenIdle().then(() => assert.fail('provider gate was not reached'))]);
    const building = host.controller.getSnapshot();
    assert.equal(projectDeploymentFlow(building).layoutSource, 'native-chart');
    assert.equal(building.run?.resources.find(resource => resource.id === 'identity-provider')?.status, 'deploying');
    assert.deepEqual(positions(building), before);
    const chartOnly = host.updates.find(state => state.run?.chart && state.run.events.length === 0)!;
    assert.ok(chartOnly);
    assert.deepEqual(positions(chartOnly), before);
    assert.ok(projectBuildScene(chartOnly).nodes.every(node => node.status === 'pending' && node.step === undefined));
    host.release(); await host.controller.whenIdle();
    const ready = host.controller.getSnapshot();
    assert.equal(ready.run?.status, 'passed');
    assert.equal(host.applies(), 1);
    assert.equal(ready.run?.chart?.graphDigest, host.graph.digest);
    assert.deepEqual(ready.run?.chart?.resources, host.schedulePreview.resources);
    assert.deepEqual(ready.run?.chart?.structure, host.schedulePreview.structure);
    assert.ok(ready.run?.resources.every(resource => resource.status === 'ready' && resource.action === 'create'));
    assert.deepEqual(positions(ready), before);
    for (const state of host.updates) {
      assert.equal(state.graph?.digest, host.graph.digest);
      assert.deepEqual(positions(state), before);
      assert.equal(projectBuildScene(state).nodes.length, 6);
      assert.equal(projectBuildScene(state).warnings.length, 0);
      assert.equal(readDashboardState(JSON.parse(JSON.stringify(state))).graph?.digest, host.graph.digest);
    }
    assert.deepEqual(new Set(host.updates.map(state => state.run?.id).filter(Boolean)), new Set([ready.run!.id]));
  });
}

test('controller and client refuse foreign, incomplete or executable preview metadata before any apply', async t => {
  const host = await fixture(t);
  const valid = host.controller.getSnapshot();
  const { digest: _digest, ...body } = host.graph;
  const foreign = compileGraph({ ...body, resources: host.graph.resources.map(resource => ({ ...resource, spec: { ...resource.spec, version: 2 } })) });
  const bad: unknown[] = [
    { ...host.schedulePreview, graphDigest: foreign.digest },
    { ...host.schedulePreview, stack: 'foreign-stack' },
    { ...host.schedulePreview, resources: host.schedulePreview.resources.slice(1) },
    { ...host.schedulePreview, resources: host.schedulePreview.resources.map((binding, index) => index ? binding : { ...binding, executeStageId: 'absent-stage' }) },
    { ...host.schedulePreview, runId: 'fabricated-run' },
  ];
  let accessorReads = 0;
  const accessor = { ...host.schedulePreview };
  Object.defineProperty(accessor, 'resources', { enumerable: true, get() { accessorReads++; throw Error('preview accessor executed'); } });
  bad.push(accessor);
  for (const schedulePreview of bad) {
    assert.throws(() => new DashboardController({ directory: host.directory,
      managedReview: { ...host.managedReview, schedulePreview: schedulePreview as DeploymentSchedulePreview } }), /preview|stage|mapping/i);
    assert.throws(() => readDashboardState({ ...valid, schedulePreview }), /schedule preview/i);
  }
  assert.throws(() => new DashboardController({ directory: host.directory,
    managedReview: { ...host.managedReview, graph: foreign } }), /schedule preview/i);
  assert.throws(() => readDashboardState({ ...valid, graph: foreign }), /schedule preview/i);
  assert.equal(accessorReads, 0, 'preview admission must not execute property accessors');
  assert.equal(host.applies(), 0);
  assert.equal(host.adapter.calls.length, 0);
  assert.deepEqual(host.recorder.getSnapshot().events, []);
});

test('a valid preview never masks an invalid native chart or replaces captured event order', { timeout: 10_000 }, async t => {
  const host = await fixture(t);
  host.controller.start('review');
  await Promise.race([host.entered, host.controller.whenIdle().then(() => assert.fail('provider gate was not reached'))]);
  host.release(); await host.controller.whenIdle();
  const completed = host.controller.getSnapshot();
  const broken = structuredClone(completed);
  broken.run!.chart = { ...broken.run!.chart!, runId: 'foreign-native-run' };
  broken.run!.events = [];
  const flow = projectDeploymentFlow(broken), scene = projectBuildScene(broken);
  assert.equal(flow.layoutSource, 'prerequisites', 'invalid native capture must not be relabelled as a valid planned preview');
  assert.ok(flow.warnings.some(warning => /native deployment chart could not be matched/i.test(warning)));
  assert.ok(flow.warnings.some(warning => /No start event was captured/.test(warning)));
  assert.equal(scene.phase, 'incomplete');
  assert.ok(scene.nodes.every(node => node.uncertain));
  assert.deepEqual(scene.activeIds, []);
  assert.notDeepEqual(positions(broken), positions(completed), 'the rejected chart does not inherit the serial preview positions');
  const eventsOnly = structuredClone(completed);
  delete eventsOnly.run!.chart;
  const observed = projectDeploymentFlow(eventsOnly);
  assert.equal(observed.layoutSource, 'native-events');
  assert.equal(observed.basis, 'recorded');
  assert.ok(observed.nodes.every(node => !!node.observed));
  assert.equal(projectBuildScene(eventsOnly).phase, 'ready');
});
