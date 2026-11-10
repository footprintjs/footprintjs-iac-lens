import assert from 'node:assert/strict';
import test from 'node:test';
import { infra, resource } from 'footprint-iac';
import { projectSystemBlocks, readSystemViewDefinition, unmappedSystemResources, type SystemViewDefinition } from '../src/core/capabilities.ts';
import type { DashboardState } from '../src/core/types.ts';

const graph = infra('generic-system').resource(resource('runtime', 'fixture', { kind: 'Deployment', metadata: { name: 'application' } }))
  .resource(resource('route', 'fixture', { kind: 'Service' })).synth();
const view: SystemViewDefinition = { blocks: [
  { id: 'execution', label: 'Compute', family: 'compute', units: [
    { id: 'runtime', label: 'Application runtime', resourceIds: ['runtime'] },
    { id: 'hardware', label: 'Existing cluster', mode: 'existing', resourceIds: [] },
  ] },
  { id: 'state', label: 'Storage', family: 'storage', units: [
    { id: 'local-state', label: 'Embedded state', mode: 'embedded', resourceIds: ['runtime'], description: 'Initialized with the runtime before its readiness check.' },
  ] },
  { id: 'communication', label: 'Network', family: 'network', units: [{ id: 'route', label: 'Application route', resourceIds: ['route'] }] },
] };
function state(): DashboardState {
  return { revision: 0, busy: false, graph, systemView: structuredClone(view), run: { id: '', status: 'idle', resources: [], events: [] } };
}

test('capabilities start pending; an existing prerequisite never counts as provisioned', () => {
  const input = state(), before = structuredClone(input), blocks = projectSystemBlocks(input);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0]!.status, 'pending');
  assert.equal(blocks[0]!.counts.total, 1);
  assert.equal(blocks[0]!.counts.existing, 1);
  assert.equal(blocks[0]!.counts.ready, 0);
  assert.equal(blocks[0]!.units[1]!.status, 'existing');
  assert.deepEqual(input, before, 'projection cannot mutate desired state or native progress');
});

test('embedded state follows its actual runtime readiness and is never a separate provider resource', () => {
  const input = state();
  input.run!.resources = [{ id: 'runtime', status: 'deploying' }, { id: 'route', status: 'pending' }];
  let blocks = projectSystemBlocks(input);
  assert.equal(blocks[0]!.status, 'deploying'); assert.equal(blocks[1]!.status, 'deploying');
  assert.equal(blocks[1]!.counts.ready, 0); assert.equal(blocks[2]!.status, 'pending');
  input.run!.resources[0] = { id: 'runtime', status: 'ready', action: 'create' };
  blocks = projectSystemBlocks(input);
  assert.equal(blocks[1]!.status, 'ready'); assert.equal(blocks[1]!.units[0]!.mode, 'embedded');
  assert.deepEqual(blocks[1]!.units[0]!.resources.map(r => r.id), ['runtime']);
  assert.equal(input.graph!.resources.length, 2, 'a logical embedded unit never creates a graph resource');
  assert.equal(blocks[2]!.counts.ready, 0);
});

test('partial and failed mappings cannot claim a ready block; undeclared progress cannot fill missing work', () => {
  const input = state();
  input.systemView = { blocks: [{ id: 'mixed', label: 'Mixed', family: 'other', units: [
    { id: 'pair', label: 'Two managed dependencies', resourceIds: ['runtime', 'route'] },
    { id: 'unknown', label: 'Unmapped dependency', resourceIds: ['not-in-graph'] },
  ] }] };
  input.run!.resources = [{ id: 'runtime', status: 'ready' }, { id: 'not-in-graph', status: 'ready' }];
  let block = projectSystemBlocks(input)[0]!;
  assert.notEqual(block.status, 'ready'); assert.equal(block.counts.ready, 0);
  assert.equal(block.units[1]!.status, 'unmapped');
  assert.deepEqual(block.units[1]!.unmappedResourceIds, ['not-in-graph']);
  input.run!.resources.push({ id: 'route', status: 'failed' });
  block = projectSystemBlocks(input)[0]!;
  assert.equal(block.status, 'failed'); assert.equal(block.counts.failed, 1);
});

test('empty mapping remains unproven and unmapped physical resources remain visible', () => {
  const input = state();
  input.systemView = { blocks: [{ id: 'state', label: 'Storage', family: 'storage', units: [{ id: 'unbound', label: 'Unbound state', resourceIds: [] }] }] };
  const blocks = projectSystemBlocks(input);
  assert.equal(blocks[0]!.status, 'unmapped'); assert.equal(blocks[0]!.counts.ready, 0);
  assert.deepEqual(unmappedSystemResources(input, blocks), graph.resources.map(resource => resource.id));
});

test('an incomplete mapping cannot hide an actually failed mapped resource', () => {
  const input = state();
  input.systemView = { blocks: [{ id: 'service', label: 'Service', family: 'compute', units: [
    { id: 'partially-bound', label: 'Partially bound service', resourceIds: ['runtime', 'unknown'] },
  ] }] };
  input.run!.resources = [{ id: 'runtime', status: 'failed' }];
  const block = projectSystemBlocks(input)[0]!;
  assert.equal(block.status, 'failed'); assert.equal(block.units[0]!.status, 'failed');
  assert.deepEqual(block.units[0]!.unmappedResourceIds, ['unknown']);
});

test('trusted block definitions reject status fabrication, duplicate units, executable properties and false existing mappings', () => {
  assert.deepEqual(readSystemViewDefinition(view), view);
  for (const bad of [
    { blocks: [{ ...view.blocks[0], status: 'ready' }] },
    { blocks: [{ ...view.blocks[0], units: [view.blocks[0]!.units[0], view.blocks[0]!.units[0]] }] },
    { blocks: [{ ...view.blocks[0], units: [{ id: 'existing', label: 'Existing', resourceIds: ['runtime'], mode: 'existing' }] }] },
    { blocks: [{ ...view.blocks[0], units: [{ id: 'bad', label: 'Bad', resourceIds: ['runtime'], mode: 'pretend' }] }] },
  ]) assert.throws(() => readSystemViewDefinition(bad), /system|unit|existing|mode/i);
  let invoked = false;
  const accessor = { get blocks() { invoked = true; return []; } };
  assert.throws(() => readSystemViewDefinition(accessor), /data|property|system/i);
  assert.equal(invoked, false, 'admission must not execute a property while reading a declared mapping');
});

test('SystemDesign blocks use only a matching binding and retain unbound capabilities', () => {
  const input = state(); delete input.systemView;
  input.design = { kind: 'system-design', version: 1, name: 'academic', digest: 'a'.repeat(64),
    capabilities: [
      { id: 'execution', path: 'application.execution', family: 'compute', kind: 'service', properties: {}, defaults: {} },
      { id: 'sessions', path: 'application.sessions', family: 'storage', kind: 'store', properties: {}, defaults: {} },
    ], boundaries: [], memberships: [], relations: [], principals: [] };
  input.binding = { kind: 'system-binding', version: 1, profileId: 'fixture', targetId: 'local', target: { id: 'local' },
    designDigest: input.design.digest, graph, decisions: [], digest: 'b'.repeat(64), mappings: [
      { capabilityId: 'execution', capabilityPath: 'application.execution', adapterId: 'fixture', targetId: 'local', mode: 'real',
        resourceIds: ['runtime'], entryPoints: ['runtime'], exitPoints: ['runtime'], groupId: 'execution' },
    ] } as DashboardState['binding'];
  input.run!.resources = [{ id: 'runtime', status: 'ready' }];
  let blocks = projectSystemBlocks(input);
  assert.equal(blocks[0]!.label, 'Compute'); assert.equal(blocks[0]!.status, 'ready');
  assert.equal(blocks[1]!.label, 'Storage'); assert.equal(blocks[1]!.status, 'unmapped');
  input.binding = { ...input.binding!, designDigest: 'c'.repeat(64) };
  blocks = projectSystemBlocks(input);
  assert.ok(blocks.every(block => block.status === 'unmapped'), 'stale binding IDs cannot establish current readiness');
});
