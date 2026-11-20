import assert from 'node:assert/strict';
import test from 'node:test';
import { projectSystemTopology } from 'footprintjs-iac/system-topology';
import type { SystemTopologyObservations, TopologyNode, TopologyResourceObservation } from 'footprintjs-iac/system-topology';
import { defineSystemTopology } from 'footprintjs-iac/system-topology/node';
import { objectActivity } from '../web/features/system-topology/object-activity.ts';

const binding = { targetId: 'office', graphDigest: 'a'.repeat(64) };
const backend: TopologyNode = {
  id: 'api', label: 'Neo backend', category: 'compute', origin: 'existing',
  bindings: { resourceIds: ['systemd'], componentIds: ['api-unit'] },
};

function project(nodes: readonly TopologyNode[], observations: Partial<Pick<SystemTopologyObservations, 'resources' | 'components' | 'checks' | 'actions'>>) {
  const definition = defineSystemTopology({ id: 'neo', label: 'Neo', nodes, boundaries: [], connections: [] }, binding);
  return projectSystemTopology(definition, {
    ...binding, definitionDigest: definition.digest, configurationDigest: 'b'.repeat(64),
    resources: [], components: [], checks: [], ...observations,
  });
}

function receipt(id: string, action: TopologyResourceObservation['action'], status: TopologyResourceObservation['status'], complete = false): TopologyResourceObservation {
  return { id, action, status, evidence: { kind: 'deployment', runId: 'deployment', runtimeStageId: `reconcile-${id}#1`, complete } };
}

test('Neo group work reaches only the bound objects, with exact component scope when recorded', () => {
  const tools = { ...backend, id: 'tools', label: 'Python tools', bindings: { resourceIds: ['systemd'], componentIds: ['tools-unit'] } };
  const collector = { ...backend, id: 'collector', label: 'Collector database', bindings: { resourceIds: [], checkIds: ['readable'] } };
  const embedded = { ...backend, id: 'sessions', label: 'Embedded sessions', origin: 'embedded' as const };
  const nodes = [backend, tools, collector, embedded];
  const update = receipt('systemd', 'update', 'deploying');
  const before = project(nodes, {});
  const during = project(nodes, {
    resources: [update], actions: [{ resourceId: 'systemd', componentId: 'api-unit', phase: 'start', status: 'running',
      evidence: { kind: 'adapter', runId: 'native-deployment', runtimeStageId: 'start-api#1', complete: false } }],
  });
  const after = project(nodes, { resources: [receipt('systemd', 'update', 'ready', true)] });

  assert.equal(objectActivity(before.nodes[0]!, before.observations.resources), undefined);
  assert.deepEqual(objectActivity(during.nodes[0]!, during.observations.resources), {
    appearance: { activity: 'updating', progress: { completed: 0, total: 1, unit: 'checks verified' } }, shared: false,
  });
  assert.equal(objectActivity(during.nodes[1]!, during.observations.resources)?.shared, true);
  assert.equal(objectActivity(during.nodes[2]!, during.observations.resources), undefined);
  assert.equal(objectActivity(during.nodes[3]!, during.observations.resources), undefined);
  assert.equal(during.nodes[0]?.originLabel, 'Existing');
  assert.equal(during.nodes[1]?.originLabel, 'Existing');
  assert.equal(objectActivity(after.nodes[0]!, after.observations.resources), undefined);
});

test('create requires a native start for an object managed by this deployment', () => {
  const managed: TopologyNode = { ...backend, id: 'new-api', origin: 'deployment', bindings: { resourceIds: ['systemd'] } };
  const resource = receipt('systemd', 'create', 'deploying');
  const view = project([backend, managed], { resources: [resource] });
  assert.equal(objectActivity(view.nodes[0]!, view.observations.resources), undefined);
  assert.deepEqual(objectActivity(view.nodes[1]!, view.observations.resources), { appearance: { activity: 'creating' }, shared: true });

  const { runtimeStageId: _runtimeStageId, ...evidenceWithoutStage } = resource.evidence;
  for (const unproven of [receipt('systemd', 'create', 'pending'), { ...resource, evidence: evidenceWithoutStage },
    receipt('systemd', 'verify', 'deploying'), receipt('systemd', 'noop', 'deploying')]) {
    const other = project([managed], { resources: [unproven] });
    assert.equal(objectActivity(other.nodes[0]!, other.observations.resources), undefined);
  }
});

test('competing resource mutations and different runs do not imply one object activity', () => {
  const multiple = { ...backend, bindings: { resourceIds: ['systemd', 'proxy'] } };
  const service = receipt('systemd', 'update', 'deploying');
  const proxyDelete = receipt('proxy', 'delete', 'deploying');
  const proxyOtherRun = { ...receipt('proxy', 'update', 'deploying'), evidence: { ...proxyDelete.evidence, runId: 'older-deployment' } };
  for (const resources of [[service, proxyDelete], [service, proxyOtherRun]]) {
    const view = project([multiple], { resources });
    assert.equal(objectActivity(view.nodes[0]!, view.observations.resources), undefined);
  }
});

test('removing stays active until every bound resource has an admitted delete receipt', () => {
  const multiple = { ...backend, bindings: { resourceIds: ['systemd', 'proxy'] } };
  const remove = (resources: TopologyResourceObservation[]) => {
    const view = project([multiple], { resources });
    return objectActivity(view.nodes[0]!, view.observations.resources);
  };
  const serviceDeleted = receipt('systemd', 'delete', 'deleted', true);
  const proxyDeleted = receipt('proxy', 'delete', 'deleted', true);
  assert.deepEqual(remove([serviceDeleted, receipt('proxy', 'delete', 'deploying')]), { appearance: { activity: 'removing' }, shared: true });
  assert.equal(remove([serviceDeleted]), undefined);
  assert.equal(remove([serviceDeleted, { ...proxyDeleted, evidence: { ...proxyDeleted.evidence, complete: false } }]), undefined);
  assert.equal(remove([serviceDeleted, receipt('proxy', 'delete', 'failed', true)]), undefined);
  assert.equal(remove([serviceDeleted, { ...proxyDeleted, evidence: { ...proxyDeleted.evidence, runId: 'other-deployment' } }]), undefined);
  assert.deepEqual(remove([serviceDeleted, proxyDeleted]), { appearance: { presence: 'removed' }, shared: true });
});

test('the object progress count reports admitted verification, not completed resource operations', () => {
  const node = { ...backend, bindings: { resourceIds: ['systemd'], checkIds: ['login', 'health'] } };
  const update = receipt('systemd', 'update', 'deploying');
  const login = { id: 'login', status: 'passed' as const, evidence: { kind: 'check' as const, runId: 'checks', complete: true } };
  const health = { id: 'health', status: 'checking' as const, evidence: { ...login.evidence, complete: false } };
  const view = project([node], { resources: [update], checks: [login] });
  assert.deepEqual(objectActivity(view.nodes[0]!, view.observations.resources), {
    appearance: { activity: 'updating', progress: { completed: 1, total: 2, unit: 'checks verified' } }, shared: true,
  });
  const indeterminate = project([node], { resources: [update], checks: [login, health] });
  assert.deepEqual(objectActivity(indeterminate.nodes[0]!, indeterminate.observations.resources), { appearance: { activity: 'updating' }, shared: true });
});
