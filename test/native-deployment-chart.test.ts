import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileStateStore, InfraEngine, SimulatorAdapter, type Resource } from 'footprintjs-iac';
import { compileGraph } from 'footprintjs-iac/graph';
import { createDeploymentRecorder, type DeploymentChart } from 'footprintjs-iac/progress';
import { projectNativeDeploymentChart } from '../src/core/native-deployment-chart.ts';
import { projectDeploymentFlow } from '../src/core/deployment-flow.ts';
import type { DashboardState } from '../src/core/types.ts';

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
  return { state, chart };
}

function reject(state: DashboardState, value: unknown) {
  const admitted = projectNativeDeploymentChart(state, value);
  assert.equal(admitted.chart, undefined);
  assert.equal(admitted.warnings.length, 1);
  assert.match(admitted.warnings[0]!, /native deployment chart.*unavailable/i);
}

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
  assert.ok(flow.edges.some(edge => edge.kind === 'native-schedule'));
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
