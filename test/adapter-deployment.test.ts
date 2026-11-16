import assert from 'node:assert/strict';
import test from 'node:test';
import { flowChart, FlowChartExecutor, decide, select, type CombinedRecorder } from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';
import { compileGraph } from 'footprintjs-iac/graph';
import type { DeploymentChart } from 'footprintjs-iac/progress';
import { projectAdapterDeployment } from '../src/core/adapter-deployment.ts';
import type { DashboardState, Recording } from '../src/core/types.ts';

type Row = Record<string, any>;
async function fixture(options: { noop?: boolean; uncertain?: boolean; hold?: boolean; parallel?: boolean; loop?: boolean } = {}) {
  let release!: () => void, entered!: () => void, effects = 0;
  const held = new Promise<void>(resolve => { release = resolve; }), waiting = new Promise<void>(resolve => { entered = resolve; });
  let provider = flowChart('Admit adapter operation', (scope: Row) => { scope.allowed = true; }, 'adapter-admit')
    .addDeciderFunction('May the effect run?', (scope: Row) => decide(scope, [{ when: { allowed: { eq: true } }, then: 'effect' }], 'unchanged'), 'effect-gate')
    .addFunctionBranch('effect', 'Update the existing service', async (scope: Row) => {
      effects++; entered(); if (options.hold) await held;
      scope.adapterFlowProgress = { status: options.uncertain ? 'unknown' : 'passed' };
      if (options.uncertain) { scope.adapterFlowOutcome = { status: 'unknown' }; scope.adapterFlowPassed = false; }
    })
    .addFunctionBranch('unchanged', 'Keep existing service unchanged', () => undefined).end()
    .addFunction('Observe the existing service', (scope: Row) => { scope.observed = true; }, 'observe').build();
  if (options.parallel) provider = flowChart('Admit adapter operation', (scope: Row) => { scope.allowed = true; }, 'adapter-admit')
    .addSelectorFunction('Observe both services', (scope: Row) => select(scope, [
      { when: { allowed: { eq: true } }, then: 'left' }, { when: { allowed: { eq: true } }, then: 'right' },
      { when: { allowed: { eq: false } }, then: 'unused' },
    ]), 'parallel')
    .addFunctionBranch('left', 'Observe backend', (scope: Row) => { scope.backend = true; })
    .addFunctionBranch('right', 'Observe tools', (scope: Row) => { scope.tools = true; })
    .addFunctionBranch('unused', 'Unselected observation', () => { throw Error('must not run'); }).end()
    .addFunction('Observe complete', (scope: Row) => { scope.observed = true; }, 'observe').build();
  if (options.loop) provider = flowChart('Admit adapter operation', (scope: Row) => { scope.iteration = 0; }, 'adapter-admit')
    .addFunction('Read fresh facts', (scope: Row) => { scope.iteration++; }, 'attempt')
    .addDeciderFunction('Retry with fresh facts?', (scope: Row) => decide(scope, [{ when: { iteration: { lt: 2 } }, then: 'retry' }], 'settled'), 'retry-gate')
    .addFunctionBranch('retry', 'Retry', () => undefined).loopTo('attempt')
    .addFunctionBranch('settled', 'Settled', () => undefined).end()
    .addFunction('Observe complete', (scope: Row) => { scope.observed = true; }, 'observe').build();
  const child = flowChart('Inspect resource', (scope: Row) => { scope.needsChange = !options.noop; }, 'inspect')
    .addDeciderFunction('Is a change required?', (scope: Row) => decide(scope, [{ when: { needsChange: { eq: true } }, then: 'provider' }], 'no-change'), 'change-gate')
    .addSubFlowChartBranch('provider', provider, 'Provider operation')
    .addFunctionBranch('no-change', 'No provider change required', () => undefined).end()
    .addFunction('Verify readiness', (scope: Row) => { scope.verified = true; }, 'verify').build();
  const native = flowChart('Load', (scope: Row) => { scope.failed = false; }, 'load')
    .addDeciderFunction('Can proceed?', (scope: Row) => decide(scope, [{ when: { failed: { eq: false } }, then: 'execute-app' }], 'skip-app'), 'gate-app')
    .addSubFlowChartBranch('execute-app', child, 'Reconcile app').addFunctionBranch('skip-app', 'Skip app', () => undefined).end().build();
  const graph = compileGraph({ name: 'adapter-view-test', resources: [{ id: 'app', provider: 'test', spec: { version: 1 } }], boundaries: [], memberships: [], relations: [] });
  const chart: DeploymentChart = { version: 1, runId: 'domain-deployment-run', stack: graph.name, graphDigest: graph.digest,
    structure: native.buildTimeStructure, resources: [{ resourceId: 'app', action: options.noop ? 'noop' : 'update', batchIndex: 0, gateStageId: 'gate-app', executeStageId: 'execute-app', skipStageId: 'skip-app' }] };
  const executor = new FlowChartExecutor(native), control = controlDepRecorder({ id: 'iac-internal-control-dependencies' });
  executor.enableNarrative(); executor.attachCombinedRecorder(control);
  const events: Row[] = []; let nativeRunId = '';
  const record = (type: string, event: Row) => { events.push({ sequence: events.length + 1, type, runtimeStageId: event.runtimeStageId, stageId: event.stageId, stageName: event.stageName, ...(event.chosen !== undefined ? { chosen: event.chosen } : {}) }); };
  const observer: CombinedRecorder = { id: 'iac-native-stage-progress', onRunStart(event) { nativeRunId = event.traversalContext!.runId; },
    onStageStart(event) { record('start', event); }, onStageEnd(event) { record('end', event); },
    onSelected(event) { if (event.evidence) record('decision', { ...event.traversalContext, chosen: event.evidence.selected }); },
    toSnapshot() { return { name: 'Observed native stages', data: { version: 1, runId: nativeRunId, events: [...events], droppedEvents: 0, observerFailures: 0 } }; } };
  executor.attachCombinedRecorder(observer);
  const run = executor.run();
  const snapshot = (running = false): DashboardState => ({ revision: 1, graph, busy: running,
    run: { id: chart.runId, status: running ? 'running' : 'passed', resources: [{ id: 'app', status: running ? 'deploying' : 'ready' }], events: [], chart,
      recording: JSON.parse(JSON.stringify({ snapshot: executor.getSnapshot(), structure: native.buildTimeStructure,
        provenance: { runId: chart.runId, stack: graph.name, graphDigest: graph.digest } })) as Recording } });
  if (options.hold) { await waiting; return { snapshot, release, run, effects: () => effects }; }
  await run; return { snapshot, release, run, effects: () => effects };
}
function states(state: DashboardState) { return new Map(projectAdapterDeployment(state).resources[0]!.stages.map(stage => [stage.id, stage])); }

test('actual mounted native captures expand operations and explicit unselected branches without inventing resources', async () => {
  const capture = await fixture(), state = capture.snapshot(), before = JSON.stringify(state);
  const view = projectAdapterDeployment(state), resource = view.resources[0]!;
  assert.equal(view.available, true); assert.deepEqual(view.warnings, []);
  assert.equal(view.resources.length, 1); assert.equal(state.graph!.resources.length, 1);
  assert.equal(resource.adapterScope, 'execute-app/provider');
  assert.equal(resource.scopes.find(scope => scope.id === 'execute-app/provider')!.mountStageId, 'execute-app/provider');
  assert.equal(resource.stages.find(stage => stage.id === 'execute-app/provider')!.childScope, 'execute-app/provider');
  const steps = states(state);
  assert.equal(steps.get('execute-app/provider/effect')!.status, 'completed');
  assert.equal(steps.get('execute-app/provider/unchanged')!.status, 'skipped');
  assert.equal(steps.get('execute-app/no-change')!.status, 'skipped');
  assert.equal(steps.get('execute-app/verify')!.status, 'completed');
  assert(resource.edges.some(edge => edge.source === 'execute-app/change-gate' && edge.target === 'execute-app/provider' && edge.selected === true));
  assert.equal(capture.effects(), 1); assert.equal(JSON.stringify(state), before, 'projection cannot mutate native evidence');
  assert.deepEqual(projectAdapterDeployment(JSON.parse(JSON.stringify(state))), view);
});

test('an actual native no-op marks the entire provider mount skipped while preserving verification', async () => {
  const capture = await fixture({ noop: true }), state = capture.snapshot(), resource = projectAdapterDeployment(state).resources[0]!;
  assert.equal(capture.effects(), 0); assert.equal(resource.action, 'noop'); assert.equal(resource.adapterScope, 'execute-app/provider');
  assert(resource.stages.filter(stage => stage.scope === 'execute-app/provider').every(stage => stage.status === 'skipped'));
  assert.equal(resource.stages.find(stage => stage.id === 'execute-app/no-change')!.status, 'completed');
  assert.equal(resource.stages.find(stage => stage.id === 'execute-app/verify')!.status, 'completed');
});

test('live native hook events expose an in-flight nested operation before child snapshots are completed', async () => {
  const capture = await fixture({ hold: true });
  try {
    const state = capture.snapshot(true), steps = states(state);
    assert.equal(steps.get('execute-app/provider/effect')!.status, 'running');
    assert.equal(steps.get('execute-app/provider/observe')!.status, 'pending');
    assert.equal(steps.get('execute-app/verify')!.status, 'pending');
    const runtime = steps.get('execute-app/provider/effect')!.runtimeStageIds[0]!; assert.match(runtime, /^execute-app\/provider\/effect#\d+$/);
  } finally { capture.release(); await capture.run; }
  assert.equal(states(capture.snapshot()).get('execute-app/provider/effect')!.status, 'completed');
});

test('native uncertainty stays unconfirmed, missing branch decisions never manufacture skipped nodes', async () => {
  const uncertain = await fixture({ uncertain: true });
  assert.equal(states(uncertain.snapshot()).get('execute-app/provider/effect')!.status, 'unknown');
  const complete = await fixture(), state = complete.snapshot(), snapshot = state.run!.recording!.snapshot as Row;
  snapshot.recorders = snapshot.recorders.filter((recorder: Row) => recorder.id !== 'iac-internal-control-dependencies');
  assert.equal(states(state).get('execute-app/provider/unchanged')!.status, 'unknown');
});

test('foreign, malformed, incomplete or ambiguously sequenced captures cannot confirm adapter completion', async () => {
  const capture = await fixture();
  for (const change of [
    (state: DashboardState) => { state.run!.recording!.provenance!.runId = 'old-run'; },
    (state: DashboardState) => { (state.run!.recording!.snapshot as Row).executionTree = { id: 'execute-app/provider/effect', runtimeStageId: 'execute-app/provider/effect#99' }; },
    (state: DashboardState) => { (state.run!.recording!.snapshot as Row).recorders.find((recorder: Row) => recorder.id === 'iac-native-stage-progress').data.runId = 'other-native-run'; },
    (state: DashboardState) => { const events = (state.run!.recording!.snapshot as Row).recorders.find((recorder: Row) => recorder.id === 'iac-native-stage-progress').data.events; events[1].sequence = events[0].sequence; },
    (state: DashboardState) => { (state.run!.recording!.snapshot as Row).recorders.find((recorder: Row) => recorder.id === 'iac-native-stage-progress').data.droppedEvents = 1; },
  ]) {
    const state = capture.snapshot(); change(state); const view = projectAdapterDeployment(state);
    assert(view.warnings.length); assert(!view.resources[0]!.stages.some(stage => stage.status === 'completed'));
  }
  const absent = capture.snapshot(); delete absent.run!.recording;
  assert(projectAdapterDeployment(absent).resources[0]!.stages.every(stage => stage.status === 'unknown'));
  let invoked = false; const accessor = capture.snapshot();
  Object.defineProperty(accessor.run!.recording!.snapshot, 'executionTree', { enumerable: true, get() { invoked = true; return {}; } });
  assert(projectAdapterDeployment(accessor).warnings.length); assert.equal(invoked, false);
});

test('native parallel branches preserve distinct lanes and individual evidence without inventing serial order', async () => {
  const capture = await fixture({ parallel: true }), resource = projectAdapterDeployment(capture.snapshot()).resources[0]!;
  const left = resource.stages.find(stage => stage.id === 'execute-app/provider/left')!, right = resource.stages.find(stage => stage.id === 'execute-app/provider/right')!;
  assert.equal(left.status, 'completed'); assert.equal(right.status, 'completed'); assert.equal(left.column, right.column); assert.notEqual(left.row, right.row);
  assert.notDeepEqual(left.runtimeStageIds, right.runtimeStageIds);
  assert.equal(resource.stages.find(stage => stage.id === 'execute-app/provider/unused')!.status, 'skipped');
  assert(!resource.edges.some(edge => edge.source === left.id && edge.target === right.id || edge.source === right.id && edge.target === left.id));
});

test('actual native loops retain repeated runtime identities and a back-edge without false continuation from its target', async () => {
  const capture = await fixture({ loop: true }), resource = projectAdapterDeployment(capture.snapshot()).resources[0]!;
  const attempt = resource.stages.find(stage => stage.id === 'execute-app/provider/attempt')!;
  assert.equal(attempt.status, 'completed'); assert.equal(attempt.executions, 2); assert.equal(attempt.runtimeStageIds.length, 2);
  assert(resource.edges.some(edge => edge.kind === 'loop' && edge.source === 'execute-app/provider/retry' && edge.target === attempt.id));
  assert(!resource.edges.some(edge => edge.source === attempt.id && edge.target === 'execute-app/provider/observe'));
  assert(resource.edges.some(edge => edge.source === 'execute-app/provider/settled' && edge.target === 'execute-app/provider/observe'));
});
