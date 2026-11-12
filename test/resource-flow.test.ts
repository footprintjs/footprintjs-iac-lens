import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDashboardClient, readDashboardState } from '../src/core/client.ts';
import { projectResourceFlow, readResourceFlowAction, resourceFlowRecordings, type ResourceFlowState } from '../src/core/resource-flow.ts';
import { DashboardController, RequestError, startDashboard } from '../src/server/index.ts';
import { FileResourceFlowStore, ResourceFlowWorkflow } from 'footprint-iac/resource-flow/workflow';
import type { ResourceFlowAdapters } from 'footprint-iac/resource-flow';

function idle(mode: 'create' | 'existing' = 'create'): ResourceFlowState {
  return { version: 1, kind: 'resource-flow-state', definitionDigest: 'a'.repeat(64), configurationDigest: 'c'.repeat(64),
    id: 'database-connection', resourceId: 'database', label: 'Connect application storage', mode, target: { id: 'owned-target', scope: 'scope-one' },
    executionId: null, status: 'idle', stages: [
      { id: 'acquire', label: mode === 'create' ? 'Create resource' : 'Find existing', status: 'pending' },
      { id: 'details', label: 'Connection details', status: 'pending' },
      { id: 'connect', label: 'Connect', status: 'pending' }, { id: 'verify', label: 'Verify', status: 'pending' },
    ], events: [], segments: [] };
}

/** This controlled host tests the transport boundary; the core and Neo suites exercise native effects. */
function controlledHost(mode: 'create' | 'existing' = 'create') {
  let state = idle(mode), startCalls = 0, resumeCalls = 0;
  const listeners = new Set<(state: ResourceFlowState) => void>();
  const publish = () => { for (const listener of listeners) listener(structuredClone(state)); };
  function stage(id: ResourceFlowState['stages'][number]['id'], status: ResourceFlowState['events'][number]['status']) {
    state.stages.find(item => item.id === id)!.status = status;
    state.events.push({ sequence: state.events.length + 1, executionId: state.executionId!, stageId: id, status,
      timestamp: Date.now(), runtimeStageId: id + '#0' });
    publish();
  }
  const workflow = {
    async snapshot() { return structuredClone(state); },
    subscribe(listener: (state: ResourceFlowState) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async start() {
      startCalls++; state.executionId = 'native-execution-one'; state.status = 'running';
      stage('acquire', 'running');
      state.resource = { id: 'database', kind: 'storage', physicalId: 'db-42', scope: 'scope-one' };
      stage('acquire', 'passed'); stage('details', 'running');
      stage('details', 'waiting'); state.status = 'paused';
      state.pause = { token: 'b'.repeat(64), prompt: 'Choose the database connection', profiles: [{ id: 'office-storage', label: 'Office storage' }] };
      state.segments.push({ runId: 'paused-run', status: 'paused', evidencePath: '/trusted/paused.json', tracePath: '/trusted/paused.jsonl' });
      publish(); return structuredClone(state);
    },
    async resume(input: { pauseToken: string; profileId: string }) {
      resumeCalls++;
      assert.equal(input.pauseToken, state.pause?.token); assert.equal(input.profileId, 'office-storage');
      delete state.pause; state.status = 'running'; stage('details', 'running');
      state.details = { resourceId: 'database', profileId: input.profileId, protocol: 'postgres', endpoint: 'postgres://db.internal:5432/history', credentialRef: 'storage-reader' };
      stage('details', 'passed'); stage('connect', 'running'); state.connection = { id: 'bound-application', runId: 'connection-run' };
      stage('connect', 'passed'); stage('verify', 'running'); state.verification = { ok: true, checks: [{ id: 'real-app-access', passed: true }] };
      stage('verify', 'passed'); state.status = 'passed';
      state.segments.push({ runId: 'resumed-run', resumedFromRunId: 'paused-run', status: 'passed', evidencePath: '/trusted/resumed.json', tracePath: '/trusted/resumed.jsonl' });
      publish(); return structuredClone(state);
    },
  };
  return { workflow, counts: () => ({ startCalls, resumeCalls, subscribers: listeners.size }),
    changeTarget() { state.target.scope = 'scope-two'; publish(); } };
}

test('headless resource flow preserves the four native stages and distinguishes Find from Create readiness', async () => {
  for (const mode of ['create', 'existing'] as const) {
    const host = controlledHost(mode), original = await host.workflow.snapshot();
    let view = projectResourceFlow({ resourceFlow: original, busy: false })!;
    assert.equal(view.completed, 0); assert.equal(view.stages.length, 4); assert.equal(view.canStart, true);
    assert.equal(view.stages[0]!.caption, 'Waiting');
    const paused = await host.workflow.start();
    view = projectResourceFlow({ resourceFlow: paused, busy: false })!;
    assert.equal(view.canResume, true); assert.equal(view.canStart, false); assert.equal(view.completed, 1);
    assert.equal(view.stages[0]!.caption, mode === 'create' ? 'Ready' : 'Found');
    assert.equal(view.stages[1]!.caption, 'Waiting for you');
    assert.equal(view.stages[2]!.status, 'pending'); assert.equal(view.stages[3]!.status, 'pending');
    assert.equal(projectResourceFlow({ resourceFlow: paused, busy: true })!.canResume, false);
    const before = structuredClone(paused);
    projectResourceFlow({ resourceFlow: paused, busy: false }); assert.deepEqual(paused, before);
    const resumed = await host.workflow.resume({ pauseToken: paused.pause!.token, profileId: paused.pause!.profiles[0]!.id });
    view = projectResourceFlow({ resourceFlow: resumed, busy: false })!;
    assert.equal(view.headline, 'Connected and verified'); assert.equal(view.completed, 4); assert.equal(view.canResume, false);
    assert.equal(view.state.segments[1]?.resumedFromRunId, view.state.segments[0]?.runId);
    assert.deepEqual(host.counts(), { startCalls: 1, resumeCalls: 1, subscribers: 0 });
  }
});

test('resource action admission refuses supplied secrets, endpoints, targets, accessors and missing tokens', () => {
  assert.deepEqual(readResourceFlowAction({ action: 'start' }), { action: 'start' });
  const accepted = { action: 'resume', pauseToken: 'a'.repeat(64), profileId: 'office-storage' };
  assert.deepEqual(readResourceFlowAction(accepted), accepted);
  for (const input of [null, [], { action: 'resume', profileId: 'office-storage' }, { ...accepted, pauseToken: 'old' },
    { ...accepted, endpoint: 'http://example.test' }, { ...accepted, password: 'do-not-record' },
    { action: 'start', target: '/other/cluster' }, { action: 'start', command: 'run' }, { ...accepted, profileId: 'bad profile' }]) {
    assert.throws(() => readResourceFlowAction(input));
  }
  let invoked = false;
  assert.throws(() => readResourceFlowAction(Object.defineProperty({}, 'action', { enumerable: true, get() { invoked = true; return 'start'; } })));
  assert.equal(invoked, false);
});

test('a dedicated controller has no simulator graph, pauses without holding busy, and refuses foreign workflow updates', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lens-resource-flow-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const host = controlledHost('existing');
  const controller = new DashboardController({ directory, resourceFlow: { workflow: host.workflow, neoUrl: 'http://127.0.0.1:5555/?test' } });
  await controller.initialize(); t.after(() => controller.dispose());
  let snapshot = controller.getSnapshot();
  assert.equal(snapshot.graph, null); assert.equal(snapshot.mode, 'managed'); assert.equal(snapshot.run, undefined);
  assert.equal(snapshot.neoUrl, undefined); assert.equal(snapshot.artifacts?.some(item => item.target?.includes('synthetic')), false);
  assert.equal(readDashboardState(snapshot).resourceFlow?.status, 'idle');
  assert.throws(() => controller.start('demo'), error => error instanceof RequestError && error.status === 409);
  controller.startResourceFlow({ action: 'start' }); await controller.whenIdle();
  snapshot = controller.getSnapshot(); assert.equal(snapshot.busy, false); assert.equal(snapshot.resourceFlow?.status, 'paused');
  assert.equal(snapshot.neoUrl, undefined); assert.equal(snapshot.resourceFlow?.stages[2]?.status, 'pending');
  assert.equal(JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8')).resourceFlow.status, 'paused');
  assert.throws(() => controller.startResourceFlow({ action: 'resume', pauseToken: 'e'.repeat(64), profileId: 'office-storage' }),
    error => error instanceof RequestError && error.status === 409);
  host.changeTarget();
  assert.match(controller.getSnapshot().resourceFlowError ?? '', /target|recording/);
  assert.throws(() => controller.startResourceFlow({ action: 'resume', pauseToken: 'b'.repeat(64), profileId: 'office-storage' }),
    error => error instanceof RequestError && error.status === 409);
  assert.equal(host.counts().resumeCalls, 0);
});

test('HTTP and framework-neutral client accept only fixed workflow actions and the exact current pause/profile', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lens-resource-http-')); const staticDirectory = join(directory, 'static');
  await mkdir(staticDirectory); await writeFile(join(staticDirectory, 'index.html'), '<!doctype html>Resource workflow');
  const host = controlledHost();
  const app = await startDashboard({ directory, staticDirectory, resourceFlow: { workflow: host.workflow, neoUrl: 'http://127.0.0.1:5555/?test' }, port: 0 });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const post = (value: unknown, headers: Record<string,string> = {}) => fetch(app.url + '/api/resource-flow', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value),
  });
  assert.equal((await post({ action: 'start', graph: {} })).status, 400);
  assert.equal((await post({ action: 'start' }, { Origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await post({ action: 'start' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post({ action: 'start', padding: 'x'.repeat(2000) })).status, 413);
  const client = createDashboardClient({ baseUrl: app.url });
  await client.resourceFlow({ action: 'start' }); await app.controller.whenIdle();
  const paused = await client.getState(); assert.equal(paused.resourceFlow?.status, 'paused');
  assert.equal((await post({ action: 'resume', pauseToken: 'e'.repeat(64), profileId: 'office-storage' })).status, 409);
  assert.equal((await post({ action: 'resume', pauseToken: paused.resourceFlow!.pause!.token, profileId: 'unconfigured-profile' })).status, 409);
  assert.equal(host.counts().resumeCalls, 0);
  await client.resourceFlow({ action: 'resume', pauseToken: paused.resourceFlow!.pause!.token, profileId: 'office-storage' });
  await app.controller.whenIdle();
  const passed = await client.getState(); assert.equal(passed.resourceFlow?.status, 'passed'); assert.equal(passed.neoUrl, 'http://127.0.0.1:5555/?test');
  assert.equal(passed.resourceFlow?.verification?.ok, true); assert.equal(passed.resourceFlow?.segments.length, 2);
  assert.equal((await post({ action: 'resume', pauseToken: paused.resourceFlow!.pause!.token, profileId: 'office-storage' })).status, 409);
  assert.deepEqual(host.counts(), { startCalls: 1, resumeCalls: 1, subscribers: 1 });
});

test('Lens follows a real native pause and fresh-host resume without repeating Create, and exposes both native segments', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lens-native-resource-flow-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const handle = { id: 'database', kind: 'storage', physicalId: 'db-native', scope: 'native-owned-scope' };
  const effects: string[] = [];
  const adapters: ResourceFlowAdapters = {
    async create() { effects.push('create'); return handle; },
    async find() { effects.push('find'); return handle; },
    async resolveDetails(_resource, profileId) { return profileId ? { profileId, resourceId: handle.id,
      protocol: 'postgres', endpoint: 'postgres://database.internal:5432/history', credentialRef: 'history-access' } : undefined; },
    async validate(resource) { assert.deepEqual(resource, handle); },
    async connect() { effects.push('connect'); return { id: 'application-binding', runId: 'owned-application-config' }; },
    async verify() { effects.push('verify'); return { ok: true, checks: [{ id: 'application-access', passed: true }] }; },
  };
  const createWorkflow = () => new ResourceFlowWorkflow({
    definition: { id: 'native-storage', resourceId: 'database', label: 'Application storage', mode: 'create', target: { id: 'native-target', scope: 'native-owned-scope' }, configurationDigest: 'd'.repeat(64) },
    store: new FileResourceFlowStore(join(directory, 'native')), profiles: [{ id: 'owned-storage', label: 'Approved storage' }], adapters,
  });
  const createController = async () => {
    const workflow = createWorkflow();
    const controller = new DashboardController({ directory: join(directory, 'viewer'), resourceFlow: { workflow,
      async artifacts() {
        const state = await workflow.snapshot();
        return Promise.all(state.segments.map(async segment => ({ id: segment.runId, path: segment.runId + '.json', mediaType: 'application/json', content: await readFile(segment.evidencePath, 'utf8') })));
      },
      async recording(state) {
        const segment = state.segments.at(-1); if (!segment) return;
        const record = JSON.parse(await readFile(segment.evidencePath, 'utf8'));
        assert.equal(record.runId, segment.runId);
        return { snapshot: record.snapshot, structure: record.structure, narrativeEntries: record.narrative };
      },
    } });
    await controller.initialize(); return controller;
  };
  const first = await createController(); first.startResourceFlow({ action: 'start' }); await first.whenIdle();
  const paused = first.getSnapshot();
  assert.equal(paused.resourceFlow?.status, 'paused'); assert.equal(paused.busy, false);
  assert.ok(paused.recording?.snapshot && paused.recording.structure);
  assert.equal(effects.filter(effect => effect === 'create').length, 1);
  assert.equal(effects.includes('connect'), false); assert.equal(effects.includes('verify'), false);
  first.dispose();
  const second = await createController(); t.after(() => second.dispose());
  assert.equal(second.getSnapshot().resourceFlow?.pause?.token, paused.resourceFlow?.pause?.token);
  second.startResourceFlow({ action: 'resume', pauseToken: paused.resourceFlow!.pause!.token, profileId: 'owned-storage' }); await second.whenIdle();
  const resumed = second.getSnapshot(), flow = resumed.resourceFlow!;
  assert.equal(flow.status, 'passed'); assert.equal(flow.executionId, paused.resourceFlow!.executionId);
  assert.equal(flow.segments.length, 2); assert.notEqual(flow.segments[0]!.runId, flow.segments[1]!.runId);
  assert.equal(flow.segments[1]!.resumedFromRunId, flow.segments[0]!.runId);
  assert.equal(effects.filter(effect => effect === 'create').length, 1);
  assert.equal(effects.filter(effect => effect === 'connect').length, 1); assert.equal(effects.filter(effect => effect === 'verify').length, 1);
  assert.ok(resumed.recording?.snapshot && resumed.recording.structure);
  assert.equal((resumed.recording!.snapshot as { runId: string }).runId, flow.segments[1]!.runId);
  const recordings = resourceFlowRecordings(resumed);
  assert.equal(recordings.length, 2); assert.ok(recordings.every(item => item.recording?.structure && item.recording.snapshot));
  assert.deepEqual(recordings.map(item => (item.recording!.snapshot as { runId: string }).runId), flow.segments.map(segment => segment.runId));
  const unrelated = structuredClone(resumed); unrelated.recording = undefined;
  unrelated.artifacts = unrelated.artifacts!.map(artifact => {
    const value = JSON.parse(artifact.content);
    return { ...artifact, content: JSON.stringify({ ...value, definitionDigest: 'e'.repeat(64) }) };
  });
  assert.ok(resourceFlowRecordings(unrelated).every(item => !item.recording), 'an unrelated recording cannot be selected merely by copying its run ID');
  const latestOnly = { ...resumed, artifacts: [] };
  assert.ok(resourceFlowRecordings(latestOnly).at(-1)?.recording, 'the host latest recording is admitted against its native shared-state binding');
  assert.deepEqual(flow.events.filter(event => event.stageId === 'acquire').map(event => event.status), ['running', 'passed']);
  assert.deepEqual(flow.stages.map(stage => stage.status), ['passed', 'passed', 'passed', 'passed']);
  assert.throws(() => second.startResourceFlow({ action: 'resume', pauseToken: paused.resourceFlow!.pause!.token, profileId: 'owned-storage' }),
    error => error instanceof RequestError && error.status === 409);
});
