import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { projectTraceInvocation, toVisualizationSnapshots } from 'footprint-explainable-ui';
import { prepareEvidenceSnapshot } from '../web/lib/evidence-snapshot.ts';

type Row = Record<string, any>;
const node = (id: string, fields: Row = {}): Row => ({ id, name: id, runtimeStageId: id + '#0', logs: {}, errors: {}, metrics: {}, evals: {}, ...fields });
const commit = (id: string, idx: number, fields: Row = {}): Row => ({ idx, stage: id, stageId: id, runtimeStageId: id + '#0',
  trace: [{ path: id, verb: 'set' }], overwrite: { [id]: idx }, updates: {}, ...fields });
const visualize = (snapshot: Row) => toVisualizationSnapshots(snapshot as Parameters<typeof toVisualizationSnapshots>[0]);

function chainFixture() {
  return { runId: 'native-run', sharedState: { final: true }, initialState: {}, captureExtent: { status: 'unverified', limitations: ['resumed-segment'] },
    commitLog: ['seed', 'fork', 'left', 'left-next', 'right', 'mount'].map((id, index) => commit(id, index)),
    executionTree: [node('seed', { stageWrites: { config: 'seed' } }), node('fork', { isFork: true,
      branches: [[node('left', { stageReads: { config: 'seed' } }), node('left-next')], [node('right', { stageReads: { config: 'seed' } })]] }), node('mount', { subflowId: 'child' })],
    subflowResults: { 'mount#0': { subflowId: 'child', treeContext: { globalContext: { child: true },
      stageContexts: [node('child/read', { stageReads: { input: 'captured' } }), node('child/write')], history: [commit('child/read', 0), commit('child/write', 1)] } } },
  };
}

test('display adaptation preserves every chain stage, fork branch, subflow read and native provenance without changing the recording', () => {
  const input = chainFixture(), before = JSON.stringify(input), view = prepareEvidenceSnapshot(input);
  assert.equal(view.convertedChains, 4); assert.deepEqual(view.causalLimitations, []);
  assert.equal(JSON.stringify(input), before); assert.equal(view.snapshot.commitLog, input.commitLog); assert.equal(view.snapshot.captureExtent, input.captureExtent);
  const tree = view.snapshot.executionTree as Row;
  assert.equal(tree.id, 'seed'); assert.equal(tree.next.id, 'fork'); assert.equal(tree.next.children[0].id, 'left');
  assert.equal(tree.next.children[0].next.id, 'left-next'); assert.equal(tree.next.children[1].id, 'right'); assert.equal(tree.next.next.id, 'mount');
  assert.deepEqual(tree.next.children[0].stageReads, { config: 'seed' });
  const stages = visualize(view.snapshot); assert.deepEqual(stages.map(stage => stage.runtimeStageId), ['seed#0', 'fork#0', 'left#0', 'left-next#0', 'right#0', 'mount#0']);
  const child = projectTraceInvocation(view.snapshot, 'mount#0'); assert.equal(child.availability.ok, true);
  assert.equal((child.executionTree as Row).stageReads.input, true); assert.equal((child.executionTree as Row).next.runtimeStageId, 'child/write#0');
  assert.equal(((view.snapshot.subflowResults as Row)['mount#0'].treeContext.stageContexts as Row).stageReads.input, 'captured');
});

test('linked serial snapshots keep full tracing while empty chains add no invented execution node', () => {
  const input = { runId: 'serial', sharedState: { ready: true }, commitLog: [commit('seed', 0), commit('next', 1)],
    executionTree: node('seed', { next: node('next', { stageReads: { seed: 0 } }) }) };
  const view = prepareEvidenceSnapshot(input); assert.equal(view.convertedChains, 0); assert.deepEqual(view.causalLimitations, []);
  assert.deepEqual(visualize(view.snapshot).map(stage => stage.runtimeStageId), ['seed#0', 'next#0']);
  assert.deepEqual(visualize(prepareEvidenceSnapshot({ executionTree: [], sharedState: {}, commitLog: [] }).snapshot), []);
});

test('temporal windows and partial-write semantics are retained but select a presentation without the legacy causal resolver', () => {
  const input = chainFixture();
  Object.assign(input.commitLog[2]!, { beganAt: 1, sawUntil: 2 });
  Object.assign(input.commitLog[3]!, { viewAt: 1, trace: [{ path: 'config', verb: 'set', builtOnView: true }] });
  const view = prepareEvidenceSnapshot(input);
  assert.deepEqual(new Set(view.causalLimitations), new Set(['temporal-read-window', 'built-on-view']));
  assert.equal(view.snapshot.commitLog, input.commitLog); assert.equal((view.snapshot.commitLog as Row[])[2]!.beganAt, 1);
  for (const trace of [[{ path: 'config', verb: 'merge' }], [{ path: 'items', verb: 'append' }], [{ path: 'config\u001fregion', verb: 'set' }]]) {
    const serial = { executionTree: node('AddConfig'), sharedState: {}, commitLog: [commit('AddConfig', 0, { trace })] };
    assert.deepEqual(prepareEvidenceSnapshot(serial).causalLimitations, ['partial-write']);
  }
  const child = chainFixture(); child.subflowResults['mount#0'].treeContext.history[0]!.beganAt = 0;
  assert.deepEqual(prepareEvidenceSnapshot(child).causalLimitations, ['temporal-read-window']);
});

test('unfamiliar topology, shared nodes, cycles, accessors and excess work are refused without executing input code', () => {
  const shared = node('shared'), cyclic = node('cycle'); cyclic.next = cyclic;
  for (const executionTree of [cyclic, [node('mixed', { next: node('next') })], [node('fork', { branches: [node('not-a-chain')] })],
    node('fork', { children: [shared, shared] }), { stages: [node('wrapped')] }, new Array(2), Array.from({ length: 20_001 }, () => node('many'))]) {
    assert.throws(() => prepareEvidenceSnapshot({ executionTree, commitLog: [], sharedState: {} }));
  }
  let invoked = false;
  const input = Object.defineProperty({}, 'executionTree', { enumerable: true, get() { invoked = true; return []; } });
  assert.throws(() => prepareEvidenceSnapshot(input)); assert.equal(invoked, false);
});

test('an actual native parallel reader retains its original source and activates the temporal compatibility guard', async () => {
  const require = createRequire(new URL('../../footprint-iac/package.json', import.meta.url));
  const { flowChart, FlowChartExecutor, select } = await import(pathToFileURL(require.resolve('footprintjs')).href);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  const chart = flowChart('Seed', (scope: Row) => { scope.source = 'initial'; }, 'seed')
    .addSelectorFunction('Run in parallel', (scope: Row) => select(scope, [
      { when: { source: { eq: 'initial' } }, then: 'reader' }, { when: { source: { eq: 'initial' } }, then: 'writer' },
    ]), 'parallel')
    .addFunctionBranch('reader', 'Reader', async (scope: Row) => { const read = scope.source; await held; scope.answer = read; })
    .addFunctionBranch('writer', 'Writer', (scope: Row) => { scope.source = 'new'; release(); })
    .end().build();
  const executor = new FlowChartExecutor(chart); await executor.run();
  const input = executor.getSnapshot(), view = prepareEvidenceSnapshot(input);
  assert.equal(input.sharedState.runs.reader.answer, 'initial'); assert.ok(view.causalLimitations.includes('temporal-read-window'));
  assert.equal(view.snapshot.commitLog, input.commitLog); assert.equal(view.snapshot.executionTree === undefined, false);
  const { findReadSources } = await import(pathToFileURL(require.resolve('foottrace')).href);
  const position = input.commitLog.findIndex((entry: Row) => entry.stageId === 'reader');
  const sources = findReadSources(input.commitLog, position, 'source');
  assert.equal(input.commitLog[sources.before].stageId, 'seed'); assert.deepEqual(sources.during, []);
});

test('actual native parent and subflow snapshots retain every recorded stage and read after JSON round-trip', async () => {
  const require = createRequire(new URL('../../footprint-iac/package.json', import.meta.url));
  const { flowChart, FlowChartExecutor } = await import(pathToFileURL(require.resolve('footprintjs')).href);
  const child = flowChart('Child seed', (scope: Row) => { scope.input = 'captured'; }, 'child-seed')
    .addFunction('Child read', (scope: Row) => { scope.output = scope.input; }, 'child-read').build();
  const parent = flowChart('Parent seed', (scope: Row) => { scope.started = true; }, 'parent-seed')
    .addSubFlowChartNext('child-mount', child, 'Child flow').addFunction('Parent done', (scope: Row) => { scope.done = true; }, 'parent-done').build();
  const executor = new FlowChartExecutor(parent); await executor.run();
  const input = JSON.parse(JSON.stringify(executor.getSnapshot())), before = JSON.stringify(input), view = prepareEvidenceSnapshot(input);
  assert.equal(view.convertedChains, 0, 'the exercised published runtime still serves linked trees');
  assert.equal(JSON.stringify(input), before); assert.equal(view.snapshot.commitLog, input.commitLog);
  assert.deepEqual(visualize(view.snapshot).map(stage => stage.runtimeStageId), visualize(input).map(stage => stage.runtimeStageId));
  const children = Object.values(input.subflowResults ?? {}) as Row[]; assert.ok(children.length > 0);
  const projected = view.snapshot.subflowResults as Row;
  for (const [id, result] of Object.entries(input.subflowResults ?? {}) as [string, Row][]) {
    assert.deepEqual(projected[id].treeContext.history, result.treeContext.history);
    assert.deepEqual(projected[id].treeContext.stageContexts, result.treeContext.stageContexts);
    const childSnapshots = visualize({ sharedState: result.treeContext.globalContext, executionTree: projected[id].treeContext.stageContexts, commitLog: result.treeContext.history });
    assert.equal(childSnapshots.length, 2); assert.ok(JSON.stringify(projected[id].treeContext.stageContexts).includes('captured'));
  }
});
