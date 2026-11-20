import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileStateStore, InfraEngine, SimulatorAdapter, loadEvidence, type Resource } from 'footprintjs-iac';
import { compileGraph } from 'footprintjs-iac/graph';
import { createDeploymentRecorder, type DeploymentChart } from 'footprintjs-iac/progress';
import { projectNativeDeploymentChart } from '../src/core/native-deployment-chart.ts';
import { projectDeploymentFlow } from '../src/core/deployment-flow.ts';
import { projectAdapterDeployment } from '../src/core/adapter-deployment.ts';
import type { DashboardState } from '../src/core/types.ts';
import { runFrameDeployment } from '../src/server/run-frame-deployment.ts';
import { runFrameState } from '../src/server/run-frame-state.ts';
import { buildDeploymentFlowView } from '../web/lib/deployment-flow-view.ts';
import { createDeploymentTraceGraph } from '../web/lib/create-deployment-trace-graph.ts';
import { FileRunRepository } from '../src/server/run-repository.ts';
import { selectRunMoment } from '../web/features/runs/select-run-moment.ts';

const resource = (id: string, dependsOn?: string[]): Resource => ({ id, provider: 'simulator', spec: { version: 1 }, ...(dependsOn && { dependsOn }) });
async function fixture(t: { after(fn: () => Promise<void>): void }, resources: Resource[], maxConcurrency = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'iac-native-topology-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const graph = compileGraph({ name: 'native-layout', resources, boundaries: [], memberships: [], relations: [] });
  const recorder = createDeploymentRecorder();
  const engine = new InfraEngine({ adapters: [new SimulatorAdapter({ file: join(directory, 'provider.json') })],
    store: new FileStateStore(join(directory, 'state')), recorders: [recorder], chartObservers: [recorder], maxConcurrency });
  const result = await engine.apply(graph);
  assert.equal(result.ok, true);
  const snapshot = recorder.getSnapshot(), chart = snapshot.chart;
  assert.ok(chart);
  const state: DashboardState = { revision: 1, graph, busy: false, run: { id: result.runId, status: 'passed',
    resources: Object.values(snapshot.resources).map(event => ({ ...event, id: event.resourceId })), events: [...snapshot.events] } };
  return { state, chart, engine, recorder };
}

function reject(state: DashboardState, value: unknown) {
  const admitted = projectNativeDeploymentChart(state, value);
  assert.equal(admitted.chart, undefined);
  assert.equal(admitted.warnings.length, 1);
  assert.match(admitted.warnings[0]!, /native deployment chart.*unavailable/i);
}

test('recorded waits separate the one attribute dependency, capacity, barrier and failure gate', async t => {
  const { state, chart } = await fixture(t, [resource('dlq'), resource('docs'), resource('items'), resource('jobs', ['dlq'])], 2);
  const schedule = {
    dlq: { dependencies: [] }, docs: { dependencies: [] },
    items: { dependencies: [], capacity: { fromBatch: 0, throughBatch: 0, limit: 2 }, batchBarrier: 0 },
    jobs: { dependencies: [{ resourceId: 'dlq', attributes: ['Arn'] }], batchBarrier: 0 },
  };
  state.run!.chart = { ...chart, resources: chart.resources.map(row => ({ ...row, schedule: schedule[row.resourceId as keyof typeof schedule] })) };
  const fresh = buildDeploymentFlowView(state, 'items');
  assert.deepEqual(fresh.edges.filter(edge => !edge.style?.strokeDasharray).map(edge => [edge.source, edge.target, edge.label]),
    [['dlq', 'jobs', 'Needs dlq.Arn']]);
  assert.equal(fresh.edges.filter(edge => edge.data?.wait === 'capacity').length, 2);
  assert.equal(fresh.edges.filter(edge => edge.data?.wait === 'batch-barrier').length, 1);
  assert.equal(createDeploymentTraceGraph(fresh).edges.find(edge => edge.label === 'Needs dlq.Arn')?.type, 'default');
  const legacyChart = { ...chart, resources: chart.resources.map(({ schedule: _schedule, ...row }) => row) };
  assert.equal(projectDeploymentFlow({ ...state, run: { ...state.run!, chart: legacyChart } }).nodes.find(node => node.id === 'items')?.schedule, undefined);
  const forged = structuredClone(state.run!.chart);
  Object.assign(forged.resources.find(row => row.resourceId === 'items')!, { schedule: { ...schedule.items, capacity: { ...schedule.items.capacity, limit: 1 } } });
  reject(state, forged);

  const directory = await mkdtemp(join(tmpdir(), 'lens-schedule-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new FileRunRepository(directory);
  await repository.initialize();
  const run = state.run!;
  const events = run.events.map(event => event.resourceId === 'items' && event.status === 'ready'
    ? { ...event, status: 'skipped' as const, message: 'A preceding operation failed' } : event);
  const resources = run.resources.map(row => row.id === 'items'
    ? { ...row, status: 'skipped' as const, message: 'A preceding operation failed' } : row);
  const failed = { ...state, run: { ...run, status: 'failed' as const, resources, events } };
  const first = { ...state, run: { ...run, chart: undefined, status: 'running' as const,
    resources: run.resources.map(row => ({ id: row.id, status: 'pending' as const })), events: run.events.filter(event => event.status === 'pending') } };
  repository.observe(first);
  repository.observe(failed);
  await repository.whenIdle();
  const record = await repository.read((await repository.list()).runs[0]!.id);
  assert.ok(record?.deploymentSchedule);
  assert.equal(record.frames.length, 2);
  assert.equal(selectRunMoment(record, 0, failed, false).state?.run?.chart, undefined);
  const replayed = selectRunMoment(record, 1, failed, false).state!;
  assert.deepEqual(projectDeploymentFlow(replayed).nodes.find(node => node.id === 'items')?.failureGate, {});
});

test('native next-spine owns columns despite reordered declarations, mappings and misleading human names', async t => {
  const { state, chart } = await fixture(t, [resource('application', ['database']), resource('database'), resource('network')]);
  const expected = projectNativeDeploymentChart(state, chart);
  assert.deepEqual(expected.warnings, []);
  assert.deepEqual(expected.chart!.batches.map(batch => batch.resourceIds), [['database'], ['application'], ['network']]);
  assert.deepEqual(expected.chart!.nodes.map(node => [node.resourceId, node.column, node.row]), [
    ['database', 0, 0], ['application', 1, 0], ['network', 2, 0],
  ]);
  const rearranged = structuredClone(chart);
  Object.assign(rearranged, { resources: [...rearranged.resources].reverse() });
  let current: DeploymentChart['structure'] | undefined = rearranged.structure;
  while (current) { current.name = 'Misleading Compute Storage Network'; current = current.next; }
  const reversedState = { ...state, graph: { ...state.graph!, resources: [...state.graph!.resources].reverse() } };
  assert.deepEqual(projectNativeDeploymentChart(reversedState, rearranged), expected);
});

test('actual native selector branches share a column and its native join precedes the next scheduled batch', async t => {
  const { state, chart } = await fixture(t, [resource('finish', ['a', 'b']), resource('b', ['root']), resource('root'), resource('a', ['root'])], 2);
  const before = structuredClone(state);
  const view = projectNativeDeploymentChart(state, chart).chart!;
  assert.deepEqual(view.batches.map(batch => [batch.resourceIds, batch.scheduledParallel]), [
    [['root'], false], [['a', 'b'], true], [['finish'], false],
  ]);
  assert.ok(view.batches[1]!.joinStageId);
  assert.deepEqual(view.nodes.filter(node => node.column === 1).map(node => [node.resourceId, node.row]), [['a', 0], ['b', 1]]);
  assert.deepEqual(view.edges.map(edge => [edge.source, edge.target, edge.kind]), [
    ['root', 'a', 'native-schedule'], ['root', 'b', 'native-schedule'], ['a', 'finish', 'native-schedule'], ['b', 'finish', 'native-schedule'],
  ]);
  assert.deepEqual(state, before, 'native topology admission cannot change resource progress or observed ordinals');
  const pending = structuredClone(state);
  pending.run!.events = []; pending.run!.status = 'running'; pending.busy = true;
  pending.run!.resources = pending.graph!.resources.map(row => ({ id: row.id, status: 'pending' }));
  assert.deepEqual(projectNativeDeploymentChart(pending, chart).chart, view, 'scheduled branches do not depend on an invented observation');
  assert.ok(!('observed' in view.nodes[1]!), 'scheduled parallelism is not proof of actual overlap');
  pending.run!.chart = chart;
  const flow = projectDeploymentFlow(pending);
  assert.equal(flow.layoutSource, 'native-chart');
  assert.equal(new Set(flow.nodes.map(node => node.id)).size, pending.graph!.resources.length);
  assert.ok(flow.nodes.every(node => node.progress.status === 'pending' && node.observed === undefined));
  assert.deepEqual(flow.nodes.filter(node => node.column === 1).map(node => node.id).sort(), ['a', 'b']);
  assert.deepEqual(flow.edges.filter(edge => edge.wait === 'dependency').map(edge => [edge.source,edge.target]).sort(),
    [['a','finish'],['b','finish'],['root','a'],['root','b']]);
});

test('foreign identity, missing graph commitment and absent resource bindings cannot supply planned positions', async t => {
  const { state, chart } = await fixture(t, [resource('database'), resource('application', ['database'])]);
  for (const mutate of [
    (copy: Record<string, unknown>) => { copy.runId = 'foreign-run'; },
    (copy: Record<string, unknown>) => { copy.stack = 'foreign-stack'; },
    (copy: Record<string, unknown>) => { copy.graphDigest = 'f'.repeat(64); },
    (copy: Record<string, unknown>) => { delete copy.graphDigest; },
    (copy: Record<string, unknown>) => { (copy.resources as unknown[]).pop(); },
  ]) {
    const copy = structuredClone(chart) as unknown as Record<string, unknown>; mutate(copy); reject(state, copy);
  }
  reject({ ...state, graph: null }, chart);
  reject({ ...state, run: { ...state.run!, id: 'other-run' } }, chart);
  assert.deepEqual(projectNativeDeploymentChart(state), { warnings: [] }, 'an older recording without a native chart remains an honest fallback');
});

test('bindings must be witnessed by native gates, branches and joins, not merely point at existing IDs', async t => {
  const { state, chart } = await fixture(t, [resource('finish', ['a', 'b']), resource('a', ['root']), resource('b', ['root']), resource('root')], 2);
  for (const mutate of [
    (copy: DeploymentChart) => { Object.assign(copy.resources[0]!, { batchIndex: 2 }); },
    (copy: DeploymentChart) => { Object.assign(copy.resources[0]!, { executeStageId: copy.resources[0]!.gateStageId }); },
    (copy: DeploymentChart) => { Object.assign(copy.resources[1]!, { gateStageId: copy.resources[0]!.gateStageId }); },
    (copy: DeploymentChart) => { Object.assign(copy.resources.find(row => row.joinStageId)!, { joinStageId: copy.structure.id }); },
    (copy: DeploymentChart) => {
      const gate = copy.structure.next!;
      gate.children!.push({ name: 'Unbound work', id: 'unbound-branch', type: 'stage' });
    },
  ]) { const copy = structuredClone(chart); mutate(copy); reject(state, copy); }
});

test('malformed cyclic or accessor-bearing native input is rejected without executing it', { timeout: 2_000 }, async t => {
  const { state, chart } = await fixture(t, [resource('database')]);
  const cyclic = structuredClone(chart); cyclic.structure.next = cyclic.structure;
  reject(state, cyclic);
  let invoked = false;
  const accessor = { ...chart };
  Object.defineProperty(accessor, 'structure', { enumerable: true, get() { invoked = true; return chart.structure; } });
  reject(state, accessor);
  assert.equal(invoked, false);
});

test('native adapter mounts keep independent stage namespaces without changing outer resource bindings', async t => {
  const { state, chart } = await fixture(t, [resource('api'), resource('tools')], 2);
  const mounted = structuredClone(chart);
  const pending = [mounted.structure];
  while (pending.length) {
    const stage = pending.pop()!;
    if (mounted.resources.some(row => row.executeStageId === stage.id)) Object.assign(stage, { isSubflowRoot: true, subflowStructure: { id: 'unit-inspect', name: 'Inspect unit', type: 'stage', next: { id: 'unit-inspect', name: 'Inspect unit', type: 'stage', isLoopReference: true } } });
    if (stage.next) pending.push(stage.next); if (stage.children) pending.push(...stage.children);
  }
  const expected = projectNativeDeploymentChart(state, chart);
  assert.deepEqual(projectNativeDeploymentChart(state, mounted), expected, 'repeated unit-chart mounts do not alias each other or reorder resource deployment');
  const forged = structuredClone(mounted); Object.assign(forged.resources[0]!, { executeStageId: 'unit-inspect' });
  reject(state, forged);
});

test('native prune stages remain replayable outside the desired graph', async t => {
  const { state: original, engine, recorder } = await fixture(t, [resource('application')]);
  const graph = compileGraph({ name: original.graph!.name, resources: [], boundaries: [], memberships: [], relations: [] });
  assert.ok(recorder.clear);
  recorder.clear();
  const result = await engine.apply(graph, { prune: true });
  assert.ok(result.ok);
  const capture = recorder.getSnapshot();
  const evidence = await loadEvidence(result.evidencePath);
  const state: DashboardState = { graph, revision: 1, busy: false, run: {
    id: result.runId, status: 'passed', mode: 'kubernetes', chart: capture.chart,
    resources: Object.values(capture.resources).map(row => ({ ...row, id: row.resourceId })),
    events: [...capture.events],
    recording: { snapshot: evidence.snapshot, structure: evidence.structure,
      provenance: { runId: result.runId, stack: graph.name, graphDigest: graph.digest } },
  } };
  assert.deepEqual(projectNativeDeploymentChart(state).chart?.nodes.map(row => [row.resourceId, row.action]), [['application', 'delete']]);
  assert.equal(projectDeploymentFlow(state).nodes.length, 0, 'the removed object does not return to the desired graph');
  const deployment = projectAdapterDeployment(state);
  assert.deepEqual(deployment.warnings, []);
  assert.deepEqual(deployment.resources.flatMap(row => row.stages.map(stage => [stage.id, stage.status])), [['execute-application', 'completed']]);
  const recorded = runFrameState(state, { appVerified: false });
  assert.equal(recorded.run?.chart, undefined);
  assert.deepEqual(runFrameDeployment(state, recorded), deployment);
  recorded.run!.events = [];
  assert.equal(runFrameDeployment(state, recorded).available, false, 'an archive needs matching native delete progress');
});
