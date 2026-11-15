import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileGraph, FileStateStore, InfraEngine, SimulatorAdapter, loadEvidence, type InfraGraph } from 'footprintjs-iac';
import { createDeploymentRecorder } from 'footprintjs-iac/progress';
import { FileResourceFlowStore, ResourceFlowWorkflow } from 'footprintjs-iac/resource-flow/workflow';
import type { ResourceFlowState } from 'footprintjs-iac/resource-flow';
import { readDashboardState } from '../src/core/client.ts';
import { projectBuildScene } from '../src/core/build-scene.ts';
import { projectDeploymentFlow } from '../src/core/deployment-flow.ts';
import { projectResourceEvidence } from '../src/core/resource-evidence.ts';
import { resourceProgress } from '../src/core/model.ts';
import { projectRevisionReview } from '../src/core/revision-review.ts';
import { readResourceFlowWorkspace, type ResourceFlowWorkspaceFrame, type ResourceFlowChildRun } from '../src/core/resource-flow-workspace.ts';
import type { DashboardRun, DashboardState } from '../src/core/types.ts';
import { DashboardController, RequestError } from '../src/server/controller.ts';
import type { ResourceFlowWorkspaceOptions } from '../src/server/resource-flow.ts';

async function fixture(t: { after(fn: () => unknown): void }, mode: 'create' | 'existing' = 'create', human = false) {
  const directory = await mkdtemp(join(tmpdir(), 'lens-workspace-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = [
    { id: 'directory', provider: 'simulator', spec: { kind: 'Directory' } },
    { id: 'provider', provider: 'simulator', dependsOn: ['directory'], spec: { kind: 'Provider' } },
  ];
  const consumer = [
    { id: 'namespace', provider: 'simulator', spec: { kind: 'Namespace' } },
    { id: 'policy', provider: 'simulator', dependsOn: ['namespace'], spec: { kind: 'ConfigMap' } },
    { id: 'app', provider: 'simulator', dependsOn: ['namespace', 'policy'], spec: { kind: 'Deployment' } },
    { id: 'service', provider: 'simulator', dependsOn: ['app'], spec: { kind: 'Service' } },
  ];
  const compile = (resources: InfraGraph['resources']) => compileGraph({ name: 'workspace-native', resources,
    boundaries: [], memberships: [], relations: [] });
  const graph = compile([...source, ...consumer.map(resource => resource.id === 'app' ? { ...resource, dependsOn: [...resource.dependsOn!, 'provider'] } : resource)]);
  const acquire = compile(source), connect = compile(consumer);
  let parent!: ResourceFlowState, sequence = 0, sourceFound = false, connectionCalls = 0, identityCalls = 0;
  let children: ResourceFlowChildRun[] = [];
  const listeners = new Set<(frame: ResourceFlowWorkspaceFrame) => void>();
  const frame = (): ResourceFlowWorkspaceFrame => ({ flowId: parent.id, executionId: parent.executionId,
    definitionDigest: parent.definitionDigest, targetId: parent.target.id, graphDigest: graph.digest, sequence,
    children: structuredClone(children), ...(sourceFound && mode === 'existing' ? { found: source.map(resource => ({
      resourceId: resource.id, physicalId: 'existing-' + resource.id, timestamp: 1000,
      runtimeStageId: parent.events.find(event => event.stageId === 'acquire')!.runtimeStageId,
    })) } : {}) });
  const publish = () => { sequence++; for (const listener of listeners) listener(frame()); };
  const provider = new SimulatorAdapter({ file: join(directory, 'provider.json') });
  const store = new FileStateStore(join(directory, 'infra-state'));
  async function apply(phase: 'acquire' | 'connect', childGraph: InfraGraph) {
    const recorder = createDeploymentRecorder();
    let run: DashboardRun = { id: '', status: 'idle', mode: 'managed', resources: [], events: [] };
    const sync = () => {
      const snapshot = recorder.getSnapshot();
      run = { ...run, id: snapshot.runId ?? '', status: snapshot.runId ? 'running' : 'idle',
        resources: Object.values(snapshot.resources).map(event => ({ ...event, id: event.resourceId })),
        events: [...snapshot.events], ...(snapshot.chart ? { chart: snapshot.chart } : {}) };
      children = [...children.filter(child => child.phase !== phase), { phase, graphDigest: childGraph.digest, run, origin: 'live' }]; publish();
    };
    const offChart = recorder.subscribeChart(sync), off = recorder.subscribe(sync);
    const engine = new InfraEngine({ adapters: [provider], store, recorders: [recorder], chartObservers: [recorder],
      traceDirectory: join(directory, phase + '-traces') });
    try {
      const result = await engine.apply(childGraph); assert.equal(result.ok, true);
      const evidence = await loadEvidence(result.evidencePath);
      sync(); run = { ...run, status: 'passed', report: { evidencePath: result.evidencePath },
        recording: { snapshot: evidence.snapshot, structure: evidence.structure,
          provenance: { runId: result.runId, stack: childGraph.name, graphDigest: childGraph.digest } } };
      children = [...children.filter(child => child.phase !== phase), { phase, graphDigest: childGraph.digest, run, origin: 'live' }]; publish();
      return { id: phase + '-receipt', runId: result.runId, evidencePath: result.evidencePath };
    } finally { off(); offChart(); }
  }
  const handle = { id: 'source', kind: 'directory', physicalId: 'source-42', scope: 'owned-scope' };
  const workflow = new ResourceFlowWorkflow({ definition: { id: 'native-workspace', resourceId: 'source', label: 'Connect a real native fixture',
    mode, target: { id: 'owned-target', scope: handle.scope }, configurationDigest: graph.digest },
    store: new FileResourceFlowStore(join(directory, 'workflow')), profiles: [{ id: 'approved', label: 'Approved source' }],
    adapters: {
      async create() { const receipt = await apply('acquire', acquire); return { ...handle, receipt }; },
      async find() { sourceFound = true; publish(); return handle; },
      async validate() {},
      async resolveDetails(_handle, profileId) { return human && !profileId ? undefined : { resourceId: handle.id,
        profileId: 'approved', endpoint: 'https://identity.example.test', protocol: 'oidc' }; },
      async connect() { return apply('connect', connect); },
      async verify() { return { ok: true, checks: [{ id: 'measured-fixture', passed: true }] }; },
    } });
  parent = await workflow.snapshot();
  const offParent = workflow.subscribe(state => { parent = state; publish(); }); t.after(offParent);
  const workspace: ResourceFlowWorkspaceOptions = { graph, phaseGraphs: { acquire, connect },
    snapshot: async () => frame(), subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async recheckConnections() { connectionCalls++; publish(); }, async recheckIdentity() { identityCalls++; publish(); } };
  const controller = new DashboardController({ directory: join(directory, 'lens'), resourceFlow: { workflow, workspace,
    artifacts: async () => [{ id: 'host-status', path: 'host-status.txt', content: parent.status },
      { id: 'intent-graph', path: 'host/infra-graph.json', content: JSON.stringify(graph), target: 'Host canonical graph' }],
    recording: async state => state.segments.length ? { snapshot: { runId: 'parent-runtime' }, structure: {} } : undefined } });
  await controller.initialize(); t.after(() => controller.dispose());
  return { controller, graph, acquire, connect, workflow, workspace, frame, publish, counts: () => ({ connectionCalls, identityCalls }),
    emit(value: ResourceFlowWorkspaceFrame) { for (const listener of listeners) listener(value); },
    mutate(fn: (children: ResourceFlowChildRun[]) => void) { fn(children); publish(); } };
}

test('one canonical workspace follows real native acquisition and connection children without manufacturing a six-resource apply run', async t => {
  const host = await fixture(t), idle = host.controller.getSnapshot();
  assert.equal(idle.graph!.resources.length, 6); assert.equal(idle.run, undefined);
  assert.ok(idle.artifacts?.some(artifact => artifact.target?.startsWith('CloudFormation example')));
  assert.equal(idle.artifacts?.find(artifact => artifact.id === 'intent-graph')?.path, 'host/infra-graph.json', 'the latest host artifact wins a duplicate ID');
  assert.equal(idle.artifacts?.find(artifact => artifact.id === 'host-status')?.content, 'idle');
  assert.equal(projectBuildScene(idle).counts.ready, 0); assert.equal(projectBuildScene(idle).nodes.length, 6);
  const positions = (state: DashboardState) => projectDeploymentFlow(state).nodes.map(node => [node.id, node.column, node.row]);
  const planned = positions(idle); assert.equal(projectDeploymentFlow(idle).layoutSource, 'phase-plan');
  assert.ok(projectDeploymentFlow(idle).nodes.every(node => !node.observed));
  const observed: DashboardState[] = [];
  host.controller.subscribe(() => observed.push(host.controller.getSnapshot()));
  host.controller.startResourceFlow({ action: 'start' }); await host.controller.whenIdle();
  const state = readDashboardState(host.controller.getSnapshot()), workspace = state.resourceFlowWorkspace!;
  assert.equal(state.resourceFlow?.status, 'passed'); assert.equal(state.busy, false);
  assert.ok(state.artifacts?.some(artifact => artifact.target?.startsWith('CloudFormation example')), 'host output refresh preserves fixed workspace export examples');
  assert.deepEqual(JSON.parse(state.artifacts!.find(artifact => artifact.id === 'intent-graph')!.content), host.graph);
  assert.equal(state.artifacts?.find(artifact => artifact.id === 'host-status')?.content, 'passed', 'host outputs refresh after the native build');
  assert.equal(new Set(state.artifacts!.map(artifact => artifact.id)).size, state.artifacts!.length);
  assert.deepEqual(workspace.children.map(child => child.phase), ['acquire', 'connect']);
  assert.equal(new Set(workspace.children.map(child => child.run.id)).size, 2);
  assert.deepEqual(workspace.children.map(child => child.graph.resources.length), [2, 4]);
  assert.notEqual(workspace.children[1]!.graph.digest, state.graph!.digest, 'Connect has the exact known external-dependency variant');
  assert.equal(state.run!.id, workspace.children[1]!.run.id); assert.equal(state.run!.chart!.graphDigest, host.connect.digest);
  assert.equal(state.run!.chart!.resources.length, 4); assert.equal(state.run!.resources.length, 4);
  assert.equal(state.resourceFlowRecording?.snapshot && (state.resourceFlowRecording.snapshot as { runId: string }).runId, 'parent-runtime');
  assert.notEqual((state.run!.recording!.snapshot as { runId: string }).runId, state.run!.id, 'domain and FootPrint runtime IDs remain distinct');
  assert.ok(observed.some(snapshot => resourceProgress(snapshot, 'directory').status === 'deploying' && resourceProgress(snapshot, 'app').status === 'pending'));
  assert.ok(observed.some(snapshot => resourceProgress(snapshot, 'provider').status === 'ready' && resourceProgress(snapshot, 'app').status === 'deploying'));
  for (const snapshot of observed) assert.deepEqual(positions(snapshot), planned, 'phase positions stay fixed before traversal and through each native child');
  const flow = projectDeploymentFlow(state), scene = projectBuildScene(state);
  assert.equal(flow.layoutSource, 'native-children'); assert.deepEqual(flow.warnings, []);
  assert.equal(scene.counts.ready, 6); assert.equal(scene.phase, 'ready');
  assert.ok(flow.nodes.every(node => !!node.observed?.runId));
  const directory = projectResourceEvidence(state, 'directory')!, app = projectResourceEvidence(state, 'app')!;
  assert.equal(directory.deployment.runId, workspace.children[0]!.run.id); assert.equal(directory.deployment.phase, 'acquire');
  assert.equal(app.deployment.runId, workspace.children[1]!.run.id); assert.equal(app.deployment.phase, 'connect');
  assert.ok(directory.deployment.recordingAvailable && app.deployment.recordingAvailable);
  assert.deepEqual(directory.deployment.events, workspace.children[0]!.run.events.filter(event => event.resourceId === 'directory'));
  assert.equal(host.counts().connectionCalls, 0);
});

test('Find is a measured read with no acquisition apply run or invented start, and paused workflows cannot run rechecks', async t => {
  const host = await fixture(t, 'existing', true);
  const positions = (state: DashboardState) => projectDeploymentFlow(state).nodes.map(node => [node.id, node.column, node.row]);
  const initial = positions(host.controller.getSnapshot());
  assert.equal(projectDeploymentFlow(host.controller.getSnapshot()).nodes.find(node => node.id === 'directory')!.column,
    projectDeploymentFlow(host.controller.getSnapshot()).nodes.find(node => node.id === 'provider')!.column);
  host.controller.startResourceFlow({ action: 'start' }); await host.controller.whenIdle();
  let state = host.controller.getSnapshot();
  assert.equal(state.resourceFlow?.status, 'paused'); assert.equal(state.resourceFlowWorkspace?.children.length, 0);
  assert.deepEqual(positions(state), initial, 'Find does not move source objects when lookup completes');
  const scene = projectBuildScene(state), source = scene.nodes.find(node => node.id === 'directory')!;
  assert.equal(source.status, 'ready'); assert.equal(source.action, 'find'); assert.equal(source.step, undefined); assert.equal(source.uncertain, false);
  assert.deepEqual(scene.activeIds, []); assert.deepEqual(scene.warnings, []);
  const evidence = projectResourceEvidence(state, 'directory')!.deployment;
  assert.equal(evidence.runId, undefined); assert.equal(evidence.nativeStages, undefined); assert.equal(evidence.events.length, 0);
  assert.equal(evidence.found?.physicalId, 'existing-directory');
  assert.throws(() => host.controller.start('connections'), error => error instanceof RequestError && error.status === 409);
  assert.throws(() => host.controller.start('identity'), error => error instanceof RequestError && error.status === 409);
  assert.deepEqual(host.counts(), { connectionCalls: 0, identityCalls: 0 });
  host.controller.startResourceFlow({ action: 'resume', pauseToken: state.resourceFlow!.pause!.token, profileId: 'approved' });
  await host.controller.whenIdle(); state = host.controller.getSnapshot();
  assert.equal(state.resourceFlow?.status, 'passed'); assert.deepEqual(state.resourceFlowWorkspace!.children.map(child => child.phase), ['connect']);
  assert.deepEqual(positions(state), initial, 'consumer native chart confirms the phase-aware planned positions');
  assert.equal(projectBuildScene(state).counts.ready, 6); assert.deepEqual(projectBuildScene(state).warnings, []);
  assert.equal(state.connectionReviewAvailable, true); assert.equal(state.identityReviewAvailable, true);
  host.controller.start('connections'); await host.controller.whenIdle();
  host.controller.start('identity'); await host.controller.whenIdle();
  assert.deepEqual(host.counts(), { connectionCalls: 1, identityCalls: 1 });
  const history = projectRevisionReview({ ...state, revisionReview: { status: 'ready', canApply: true,
    reviewId: 'f'.repeat(64), current: { id: 'old', digest: 'd'.repeat(64), graphDigest: host.graph.digest },
    candidate: { id: 'new', digest: 'e'.repeat(64), graphDigest: host.graph.digest }, resources: [] } })!;
  assert.equal(history.canApply, false); assert.equal(history.canReview, false, 'history cannot expose a competing workflow mutator');
  for (const scenario of ['demo', 'review', 'neo', 'revision-review', 'revision-apply'] as const) assert.throws(() => host.controller.start(scenario), RequestError);
});

test('foreign phase graphs, event runs, parent executions and decreasing observations cannot alter admitted physical progress', async t => {
  const host = await fixture(t); host.controller.startResourceFlow({ action: 'start' }); await host.controller.whenIdle();
  const before = host.controller.getSnapshot(), frame = host.frame();
  for (const change of [
    (copy: ResourceFlowWorkspaceFrame) => { copy.executionId = 'foreign-execution'; },
    (copy: ResourceFlowWorkspaceFrame) => { copy.targetId = 'foreign-target'; },
    (copy: ResourceFlowWorkspaceFrame) => { copy.graphDigest = 'f'.repeat(64); },
    (copy: ResourceFlowWorkspaceFrame) => { copy.children[1]!.graphDigest = host.graph.digest; },
    (copy: ResourceFlowWorkspaceFrame) => { Object.assign(copy.children[1]!.run.events[0]!, { runId: 'foreign-child' }); },
    (copy: ResourceFlowWorkspaceFrame) => { copy.children[1]!.run.recording!.provenance!.graphDigest = host.graph.digest; },
  ]) {
    const copy = structuredClone(frame); change(copy);
    const value = { ...copy, children: copy.children.map(child => ({ ...child, graph: child.phase === 'acquire' ? host.acquire : host.connect })) };
    assert.throws(() => readResourceFlowWorkspace(value, host.graph, before.resourceFlow));
  }
  const malicious = structuredClone(before); malicious.resourceFlowWorkspace!.children[0]!.run.events[0]!.sequence = 999;
  assert.ok(projectBuildScene(malicious).nodes.every(node => node.status === 'pending'));
  assert.ok(projectBuildScene(malicious).warnings.length > 0);
  host.emit({ ...frame, sequence: frame.sequence - 1 });
  assert.equal(host.controller.getSnapshot().resourceFlowWorkspace!.sequence, before.resourceFlowWorkspace!.sequence);
  assert.match(host.controller.getSnapshot().resourceFlowError!, /could not be matched/);
  host.mutate(children => { children[1]!.graphDigest = host.graph.digest; });
  const rejected = host.controller.getSnapshot();
  assert.equal(rejected.resourceFlowWorkspace!.sequence, before.resourceFlowWorkspace!.sequence);
  assert.match(rejected.resourceFlowError!, /could not be matched/);
  assert.throws(() => host.controller.start('connections'), error => error instanceof RequestError && error.status === 409);
});
