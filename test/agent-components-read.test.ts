import test from 'node:test';
import assert from 'node:assert/strict';
import { readAgentComponentGraphView } from '../src/core/agent-components-read.ts';
import type { AgentComponentGraphView } from '../src/core/agent-components.ts';

const proof = { id: 'native-proof', kind: 'readiness' as const, runId: 'native-run', complete: true, source: 'native' as const };
function sample(): AgentComponentGraphView {
  return { version: 1, id: 'runtime', label: 'Neo runtime', digest: 'a'.repeat(64), binding: { graphDigest: 'b'.repeat(64), deploymentDigest: 'c'.repeat(64), revisionDigest: 'd'.repeat(64), targetId: 'registered-target' },
    nodes: [{ id: 'memory', label: 'Session memory and history', kind: 'store', roles: ['session-state', 'conversation-history'], status: 'pending', required: true, selected: true, storage: 'memory', sharing: 'shared', boundaryId: 'runtime',
      progress: { completed: 0, total: 4, indeterminate: false, unit: 'stages' }, stages: ['acquire', 'details', 'connect', 'verify'].map(id => ({ id, label: id, status: 'pending' })) }],
    boundaries: [{ id: 'runtime', label: 'Runtime', kind: 'service', strategy: { id: 'systemd', label: 'systemd' }, status: 'pending', observed: false, progress: { completed: 0, total: 4, indeterminate: false, unit: 'stages' } }], relations: [], limitations: [] };
}
test('component observations preserve one shared memory node with both logical roles and native stage progress', () => {
  assert.deepEqual(readAgentComponentGraphView(sample()), sample());
});
test('component graph refuses raw credentials, malformed progress, unsupported ready claims and invented physical identity', () => {
  const base = sample();
  for (const patch of [{ token: 'private' }, { progress: { completed: 5, total: 4, indeterminate: false, unit: 'stages' } }, { status: 'ready' }, { storage: 'redis' }]) {
    const input = structuredClone(base); Object.assign(input.nodes[0]!, patch); assert.throws(() => readAgentComponentGraphView(input));
  }
  const boundary = structuredClone(base); Object.assign(boundary.boundaries[0]!, { status: 'ready', observed: false, recording: proof });
  assert.throws(() => readAgentComponentGraphView(boundary));
});
test('component containment is finite and references cannot escape the admitted graph', () => {
  for (const alter of [
    (view: AgentComponentGraphView) => { view.boundaries[0]!.parentId = 'runtime'; },
    (view: AgentComponentGraphView) => { view.nodes[0]!.boundaryId = 'foreign'; },
    (view: AgentComponentGraphView) => { view.relations = [{ id: 'one', from: 'memory', to: 'foreign', kind: 'supports' }]; },
  ]) { const input = sample(); alter(input); assert.throws(() => readAgentComponentGraphView(input)); }
});
test('connected required edges need their own measured connection component', () => {
  const input = sample(); input.relations = [{ id: 'wire', from: 'memory', to: 'memory', kind: 'communicatesWith', required: true, status: 'connected' }];
  assert.throws(() => readAgentComponentGraphView(input));
});
test('verified boundaries require all selected required descendants and native proof', () => {
  const input = sample(), node = input.nodes[0]!, boundary = input.boundaries[0]!;
  node.status = 'ready'; node.recording = { ...proof }; node.stages = node.stages!.map(stage => ({ ...stage, status: 'ready' })); node.progress.completed = 4;
  boundary.identityComponentId = node.id; boundary.status = 'ready'; boundary.observed = true; boundary.recording = proof; boundary.progress.completed = 4;
  assert.deepEqual(readAgentComponentGraphView(input), input);
  node.status = 'running'; node.stages = node.stages!.map((stage, i) => ({ ...stage, status: i < 2 ? 'ready' : 'running' })); node.progress.completed = 2;
  boundary.progress.completed = 2; assert.throws(() => readAgentComponentGraphView(input));
});

test('declared pending phases need no fabricated runtime stage IDs', () => {
  const input = sample(); delete input.nodes[0]!.stages;
  assert.equal(readAgentComponentGraphView(input).nodes[0]?.progress.total, 4);
  input.nodes[0]!.progress.completed = 1;
  assert.throws(() => readAgentComponentGraphView(input));
});
test('boundary work includes the native identity anchor and its required connection check without treating containment as order', () => {
  const input = sample(), memory = input.nodes[0]!; memory.boundaryId = 'storage';
  const worker = { ...structuredClone(memory), id: 'worker', label: 'Agent worker', kind: 'execution' as const, roles: ['worker'], boundaryId: 'runtime', status: 'ready' as const, recording: proof,
    progress: { completed: 4, total: 4, indeterminate: false, unit: 'stages' as const }, stages: memory.stages!.map(stage => ({ ...stage, status: 'ready' as const })) };
  const connection = { ...structuredClone(memory), id: 'link', label: 'Memory access', kind: 'connection' as const, roles: ['memory-access'], boundaryId: 'runtime' };
  input.nodes = [worker, memory, connection];
  input.relations = [{ id: 'memory-access', from: 'worker', to: 'memory', kind: 'communicatesWith', required: true, checkComponentId: 'link', status: 'untested' }];
  const progress = { completed: 4, total: 12, indeterminate: false, unit: 'stages' as const };
  Object.assign(input.boundaries[0]!, { observed: true, status: 'running', recording: proof, identityComponentId: 'worker', progress });
  input.boundaries = [...input.boundaries, { id: 'storage', parentId: 'runtime', identityComponentId: 'worker', label: 'Shared memory', kind: 'shared', observed: true, status: 'running', recording: proof, progress: { ...progress } }];
  assert.equal(readAgentComponentGraphView(input).boundaries[1]?.progress.total, 12);
  input.boundaries[1]!.status = 'ready'; assert.throws(() => readAgentComponentGraphView(input));
});
test('uncertain capture can retain its planned total without claiming a percentage or success', () => {
  const input = sample(); input.nodes[0]!.status = 'incomplete'; input.nodes[0]!.progress.indeterminate = true;
  input.boundaries[0]!.status = 'incomplete'; input.boundaries[0]!.progress.indeterminate = true;
  assert.deepEqual(readAgentComponentGraphView(input), input);
});

test('observed boundary identity proof belongs to its complete anchor component', () => {
  const valid = sample(), node = valid.nodes[0]!, boundary = valid.boundaries[0]!;
  node.status = 'ready'; node.recording = { ...proof }; node.stages = node.stages!.map(stage => ({ ...stage, status: 'ready' })); node.progress.completed = 4;
  Object.assign(boundary, { identityComponentId: node.id, status: 'ready', observed: true, recording: { ...proof }, progress: { completed: 4, total: 4, indeterminate: false, unit: 'stages' } });
  assert.deepEqual(readAgentComponentGraphView(valid), valid);
  const mutations: ((view: AgentComponentGraphView) => void)[] = [
    view => { delete view.boundaries[0]!.identityComponentId; },
    view => { view.boundaries[0]!.recording!.id = 'another-complete-proof'; },
    view => { view.boundaries[0]!.recording!.runId = 'another-native-run'; },
    view => { delete view.nodes[0]!.recording; },
    view => { view.nodes[0]!.recording!.complete = false; },
  ];
  for (const mutate of mutations) { const changed = structuredClone(valid); mutate(changed); assert.throws(() => readAgentComponentGraphView(changed)); }
});
