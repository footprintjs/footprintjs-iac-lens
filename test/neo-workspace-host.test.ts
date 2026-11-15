import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileGraph } from 'footprintjs-iac/graph';
import type { IdentityTarget } from 'footprintjs-iac/integration/identity';
import type { NeoResourceFlowObservation } from 'footprintjs-iac/integration/identity/resource-flow-view';
import { projectNeoWorkspace } from '../examples/neo-resource-flow/workspace.ts';
import { neoWorkspaceHistory } from '../examples/neo-resource-flow/workspace-history.ts';

function fixture() {
  const ids = ['identity-directory', 'identity-provider', 'neo-namespace', 'neo-access-policy', 'neo-app', 'neo-service'];
  const graph = compileGraph({ name: 'neo-identity-test', resources: ids.map(id => ({ id, provider: 'test', spec: {} })),
    boundaries: [], memberships: [], relations: [
      { kind: 'communicatesWith', from: 'identity-provider', to: 'identity-directory' },
      { kind: 'communicatesWith', from: 'neo-app', to: 'identity-provider' },
      { kind: 'communicatesWith', from: 'neo-service', to: 'neo-app' },
    ] });
  const make = (resources: typeof graph.resources) => compileGraph({ name: graph.name, resources, boundaries: [], memberships: [], relations: [] });
  const phases = { acquisitionGraph: make(graph.resources.slice(0, 2)), consumerGraph: make(graph.resources.slice(2)) };
  const feed: NeoResourceFlowObservation = { version: 1, kind: 'neo-resource-flow-observation', targetId: 'test-target', sequence: 0,
    parent: { version: 1, kind: 'resource-flow-state', id: 'create-test', resourceId: graph.name, label: 'Test', mode: 'create',
      target: { id: 'test-target', scope: 'scope' }, definitionDigest: 'a'.repeat(64), configurationDigest: 'b'.repeat(64),
      executionId: null, status: 'idle', stages: [
        { id: 'acquire', label: 'Create', status: 'pending' }, { id: 'details', label: 'Details', status: 'pending' },
        { id: 'connect', label: 'Connect', status: 'pending' }, { id: 'verify', label: 'Verify', status: 'pending' },
      ], events: [], segments: [] }, deployments: [], connections: [], identities: [], retainedEvidence: 'none', subscriberFailures: 0 };
  return { graph, phases, feed };
}

test('Neo host exposes the complete declared check catalog before any effects and never invents readiness', () => {
  const { graph, phases, feed } = fixture(), frame = projectNeoWorkspace(feed, graph, phases);
  assert.equal(graph.resources.length, 6);
  assert.equal(frame.children.length, 0); assert.equal(frame.found, undefined);
  assert.equal(frame.connections?.checks.length, 3); assert.equal(frame.identity?.checks.length, 7);
  assert.ok(frame.connections!.checks.every(check => check.status === 'untested'));
  assert.ok(frame.identity!.checks.every(check => check.status === 'untested'));
  assert.equal(frame.executionId, null);
});

test('host refuses foreign child, check and source execution correlation before the workspace can use it', () => {
  const { graph, phases, feed } = fixture();
  feed.parent.executionId = 'this-execution';
  feed.source = { mode: 'existing', executionId: 'another-execution', definitionDigest: feed.parent.definitionDigest,
    physicalId: 'physical-source', observedAt: 100, resources: [] };
  assert.throws(() => projectNeoWorkspace(feed, graph, phases), /another workflow execution/);
  delete feed.source;
  feed.connections.push({ executionId: 'another-execution', definitionDigest: feed.parent.definitionDigest, purpose: 'recheck', origin: 'live',
    snapshot: { version: 1, runId: null, sequence: 0, connections: {}, events: [], ignoredEvents: 0, subscriberFailures: 0 } });
  assert.throws(() => projectNeoWorkspace(feed, graph, phases), /another workflow execution/);
  feed.connections = [];
  feed.deployments.push({ phase: 'acquire', executionId: 'another-execution', definitionDigest: feed.parent.definitionDigest, origin: 'live',
    snapshot: { version: 1, runId: null, sequence: 0, resources: {}, events: [], ignoredCharts: 0, ignoredEvents: 0, subscriberFailures: 0 } });
  assert.throws(() => projectNeoWorkspace(feed, graph, phases), /another workflow execution/);
});

test('Find projects measured source identities without constructing a deployment run or start event', () => {
  const { graph, phases, feed } = fixture();
  feed.parent.executionId = 'find-execution'; feed.parent.mode = 'existing';
  feed.source = { mode: 'existing', executionId: feed.parent.executionId, definitionDigest: feed.parent.definitionDigest,
    physicalId: 'combined-reference', observedAt: 12345,
    resources: [{ resourceId: 'identity-directory', physicalId: 'directory-42', running: true },
      { resourceId: 'identity-provider', physicalId: 'provider-43', running: true }],
    parentAcquire: { runId: 'parent-find', runtimeStageId: 'actual-acquire#0' } };
  const before = structuredClone(feed), frame = projectNeoWorkspace(feed, graph, phases);
  assert.equal(frame.children.length, 0);
  assert.deepEqual(frame.found?.map(resource => [resource.resourceId, resource.physicalId, resource.timestamp]), [
    ['identity-directory', 'directory-42', 12345], ['identity-provider', 'provider-43', 12345],
  ]);
  assert.deepEqual(feed, before, 'Projection never mutates the native feed');
});

test('opening a target without master history does not create, adopt or stage a version', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'neo-workspace-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { graph } = fixture();
  const history = await neoWorkspaceHistory({ directory } as IdentityTarget, graph);
  assert.deepEqual(history, { artifacts: [] });
  assert.deepEqual(await readdir(directory), []);
});
