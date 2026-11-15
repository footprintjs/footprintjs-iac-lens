import assert from 'node:assert/strict';
import test from 'node:test';
import { progressPresentation, runtimeBoundaryLabel } from '../web/features/agents/components/model.ts';
import { layoutComponentGraph } from '../web/features/agents/components/layout.ts';

const progress = (completed: number, total?: number, indeterminate = false) => ({ completed, ...(total === undefined ? {} : { total }), indeterminate, unit: 'stages' as const });

test('the outline follows only measured stage counts and leaves unknown work indeterminate', () => {
  assert.deepEqual(progressPresentation(progress(2, 8)), { determinate: true, fraction: .25, label: '2 of 8 stages', completed: 2, total: 8 });
  assert.equal(progressPresentation(progress(2, undefined, true)).fraction, undefined);
  assert.equal(progressPresentation(progress(2, undefined, true)).label, '2 stages complete');
  assert.equal(progressPresentation(progress(0, 0)).fraction, undefined);
});

test('the strategy badge distinguishes selected platform from observed runtime and never invents a container', () => {
  assert.equal(runtimeBoundaryLabel({ label: 'Registered target', kind: 'platform', strategy: { id: 'systemd', label: 'systemd' }, observed: true }), 'Runtime · systemd');
  assert.equal(runtimeBoundaryLabel({ label: 'Registered target', kind: 'platform', strategy: { id: 'kubernetes', label: 'Kubernetes' }, observed: false }), 'Selected · Kubernetes');
  assert.equal(runtimeBoundaryLabel({ label: 'Neo service', kind: 'service', observed: true }), 'Neo service');
});

test('nested boundaries contain their supplied children while native order and parallel ranks remain separate', () => {
  const graph: any = { nodes: [
    { id: 'worker', kind: 'execution', boundaryId: 'service' }, { id: 'memory', kind: 'store', boundaryId: 'service' }, { id: 'history', kind: 'store', boundaryId: 'service' },
  ], boundaries: [{ id: 'host', kind: 'host' }, { id: 'service', kind: 'service', parentId: 'host' }], relations: [
    { id: 'first-memory', from: 'worker', to: 'memory', kind: 'order' }, { id: 'first-history', from: 'worker', to: 'history', kind: 'order' },
  ] };
  const result = layoutComponentGraph(graph, new Set());
  const host = result.boundaries.find(item => item.id === 'host')!, service = result.boundaries.find(item => item.id === 'service')!;
  for (const node of result.nodes) {
    assert.ok(node.x >= service.x && node.y >= service.y && node.x + node.width <= service.x + service.width && node.y + node.height <= service.y + service.height);
  }
  assert.ok(service.x >= host.x && service.x + service.width <= host.x + host.width);
  const worker = result.nodes.find(item => item.id === 'worker')!, memory = result.nodes.find(item => item.id === 'memory')!, history = result.nodes.find(item => item.id === 'history')!;
  assert.ok(worker.x < memory.x); assert.equal(memory.x, history.x);
  const collapsed = layoutComponentGraph(graph, new Set(['host']));
  assert.deepEqual(collapsed.nodes, []); assert.deepEqual(collapsed.boundaries.map(item => item.id), ['host']);
});

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentComponentGraphView } from '../src/core/agent-components.ts';
import { componentShape } from '../web/features/agents/components/model.ts';

const built = await build({ stdin: { contents: "export { default as ComponentScene } from './web/features/agents/components/ComponentScene.tsx'; export { BoundaryOutline } from './web/features/agents/components/BoundaryOutline.tsx';", resolveDir: import.meta.dirname + '/..', loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent' });
const artifacts = join(import.meta.dirname, '../.artifacts'); await mkdir(artifacts, { recursive: true });
const folder = await mkdtemp(join(artifacts, 'agent-components-ui-')); let components;
try { const file = join(folder, 'render.mjs'); await writeFile(file, built.outputFiles[0]!.text); components = await import(pathToFileURL(file).href); }
finally { await rm(folder, { recursive: true, force: true }); }

function view(): AgentComponentGraphView {
  return { version: 1, id: 'native-neo-components', label: 'Neo runtime', digest: 'a'.repeat(64), binding: { graphDigest: 'b'.repeat(64), revisionDigest: 'c'.repeat(64), deploymentDigest: 'd'.repeat(64), targetId: 'neo-target' }, limitations: [],
    boundaries: [{ id: 'runtime', kind: 'platform', label: 'Registered cluster', strategy: { id: 'kubernetes', label: 'Kubernetes' }, observed: true, status: 'running', progress: progress(2, 8) },
      { id: 'pod', kind: 'pod', parentId: 'runtime', label: 'Neo Pod', observed: true, status: 'running', progress: progress(2, 8) }],
    nodes: [{ id: 'worker', label: 'Agent worker', kind: 'execution', roles: ['agent-worker'], boundaryId: 'pod', required: true, selected: true, status: 'ready', progress: progress(4, 4) },
      { id: 'state', label: 'Session memory and history', kind: 'store', roles: ['session-state', 'conversation-history'], storage: 'memory', sharing: 'shared', physicalBindingId: 'neo-memory', boundaryId: 'pod', required: true, selected: true, status: 'running', progress: progress(2, 4) }],
    relations: [{ id: 'after-worker', from: 'worker', to: 'state', kind: 'order' }, { id: 'state-connection', from: 'worker', to: 'state', kind: 'communicatesWith', status: 'checking', checkComponentId: 'state', required: true }] };
}
const render = (graph = view()) => renderToStaticMarkup(createElement(components.ComponentScene, { view: graph, status: 'running', technical: false }));

test('the runtime graph renders observed hierarchy, native border counts and separate live connection edges', () => {
  const html = render();
  assert.match(html, /Runtime · Kubernetes/); assert.doesNotMatch(html, /Neo Pod/); assert.match(html, /stroke-dasharray="25 100"/);
  const detailed = renderToStaticMarkup(createElement(components.ComponentScene, { view: view(), status: 'running', technical: true })); assert.match(detailed, /Neo Pod/);
  assert.match(html, /aria-valuenow="2"/); assert.match(html, /aria-valuemax="8"/);
  assert.match(html, /data-kind="order"/); assert.match(html, /data-kind="communicatesWith" data-status="checking"/);
  assert.match(html, /aria-label="Collapse Runtime · Kubernetes"/); assert.match(html, /data-component-id="worker"/);
  assert.doesNotMatch(html, /Sandbox|25%|seconds|Remaining time|Progress simulation/);
});

test('shared volatile session/history state appears once as memory rather than a made-up second database', () => {
  const html = render();
  assert.equal((html.match(/data-component-id="state"/g) ?? []).length, 1);
  assert.match(html, /data-shape="memory"/); assert.doesNotMatch(html, /data-shape="database"/);
  assert.equal(componentShape({ kind: 'store' }), 'store');
  const persistent = view(); persistent.nodes = persistent.nodes.map(node => node.id === 'state' ? { ...node, storage: 'persistent' } : node);
  assert.match(render(persistent), /data-shape="database"/);
});

test('a systemd observation keeps service/process boundaries and does not manufacture Kubernetes containers', () => {
  const graph = view(); graph.boundaries = [{ ...graph.boundaries[0]!, label: 'Registered Linux host', kind: 'host', strategy: { id: 'systemd', label: 'systemd' } },
    { ...graph.boundaries[1]!, label: 'Neo service', kind: 'service' }];
  const html = render(graph);
  assert.match(html, /Runtime · systemd/); assert.match(html, /Neo service/);
  assert.doesNotMatch(html, /Kubernetes|Neo Pod|Container|Sandbox/);
});

test('unknown work has no numeric percentage and a full outline does not override an incomplete native outcome', () => {
  const boundary = { ...view().boundaries[0]!, progress: progress(2, undefined, true) }, box = { id: boundary.id, x: 0, y: 0, width: 300, height: 180, depth: 0 };
  const draw = (value: typeof boundary) => renderToStaticMarkup(createElement(components.BoundaryOutline, { boundary: value, box, onInspect() {}, onToggle() {} }));
  const unknown = draw(boundary); assert.match(unknown, /agent-boundary-indeterminate/); assert.doesNotMatch(unknown, /aria-valuenow|aria-valuemax|NaN|undefined/);
  const incomplete = draw({ ...boundary, status: 'incomplete', progress: progress(8, 8) });
  assert.match(incomplete, /data-status="incomplete"/); assert.match(incomplete, /Not confirmed/); assert.doesNotMatch(incomplete, /data-status="ready"/);
});

test('Simple represents checker-only components on live edges while Details retains their native order', () => {
  const graph = view();
  graph.nodes = [...graph.nodes, { id: 'check-state', label: 'Memory connection check', kind: 'connection', roles: ['connection-check'], boundaryId: 'pod', selected: true, required: true, status: 'running', progress: progress(1, 4) }];
  graph.relations = graph.relations.map(edge => edge.kind === 'communicatesWith' ? { ...edge, checkComponentId: 'check-state' } : edge);
  const simple = render(graph); assert.doesNotMatch(simple, /data-component-id="check-state"/);
  assert.match(simple, /role="button"[^>]*aria-label="Inspect Connection: worker to state, checking"/);
  const detailed = renderToStaticMarkup(createElement(components.ComponentScene, { view: graph, status: 'running', technical: true }));
  assert.match(detailed, /data-component-id="check-state"/); assert.match(detailed, /Memory connection/);
});

test('an empty observed boundary can confirm identity without inventing a percentage or a child process', () => {
  const graph = view(); graph.nodes = []; graph.relations = []; graph.boundaries = [{ ...graph.boundaries[0]!, id: 'sidecar', label: 'Tools HTTP container', kind: 'container', strategy: undefined, status: 'ready', observed: true, progress: progress(0, 0),
    recording: { id: 'native-boundary-proof', kind: 'readiness', runId: 'worker-native-identity', complete: true, source: 'native' } }];
  const html = render(graph).replace(/<style>[\s\S]*?<\/style>/g, '');
  assert.match(html, /Identity checked/); assert.match(html, /stroke-dasharray="100 100"/);
  assert.doesNotMatch(html, /0 of 0|100%|aria-label="Expand|aria-label="Collapse|data-component-id=/);
  const waiting = { ...graph, boundaries: graph.boundaries.map(boundary => ({ ...boundary, observed: false, status: 'pending' as const, recording: undefined })) };
  const unobserved = render(waiting); assert.match(unobserved, /Identity not confirmed/); assert.doesNotMatch(unobserved, /stroke-dasharray="100 100"|Identity checked/);
});

test('Simple removes placement-only wrappers but retains real ancestor relationships, execution edges and proofs', async () => {
  const { visibleComponentView } = await import('../web/features/agents/components/model.ts');
  const graph = view(), proof = { id: 'scope-proof', kind: 'readiness' as const, runId: 'native-identity', source: 'native' as const, complete: true };
  graph.boundaries = [{ ...graph.boundaries[0]!, recording: proof },
    { id: 'namespace', label: 'Actual namespace', kind: 'namespace', parentId: 'runtime', observed: true, status: 'ready', progress: progress(4, 4), recording: proof },
    { id: 'pod', label: 'Actual Pod', kind: 'pod', parentId: 'namespace', observed: true, status: 'ready', progress: progress(4, 4), recording: proof },
    { id: 'service', label: 'Actual agent container', kind: 'container', parentId: 'pod', observed: true, status: 'ready', progress: progress(4, 4), recording: proof }];
  graph.nodes = graph.nodes.map(node => ({ ...node, boundaryId: 'service', recording: proof }));
  graph.relations = [...graph.relations, { id: 'real-containment', from: 'pod', to: 'service', kind: 'contains' }];
  const simple = visibleComponentView(graph, false), details = visibleComponentView(graph, true);
  assert.deepEqual(simple.boundaries.map(boundary => boundary.id), ['runtime', 'service']);
  assert.equal(simple.boundaries[1]?.parentId, 'runtime'); assert.equal(simple.boundaries[1]?.recording, proof);
  assert.equal(simple.nodes[0]?.recording, proof); assert.equal(simple.binding, graph.binding); assert.equal(simple.digest, graph.digest);
  assert.deepEqual(simple.relations.filter(edge => edge.kind !== 'contains'), graph.relations.filter(edge => edge.kind !== 'contains'));
  assert.ok(simple.relations.some(edge => edge.kind === 'contains' && edge.from === 'runtime' && edge.to === 'service'));
  assert.equal(details, graph); assert.equal(graph.boundaries[3]?.parentId, 'pod');
});
