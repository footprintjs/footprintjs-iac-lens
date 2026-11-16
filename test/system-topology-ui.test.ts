import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import type { SystemTopologyView } from 'footprintjs-iac/system-topology';
import { layoutSystemTopology } from '../web/features/system-topology/topology-layout.ts';

const root = join(import.meta.dirname, '..');
const compiled = await build({ stdin: { contents: "export {default as Graph} from './web/features/system-topology/SystemTopologyGraph.tsx';export {TechnologyMark} from './web/features/system-topology/TechnologyMark.tsx';", resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent' });
await mkdir(join(root, '.artifacts'), { recursive: true }); const directory = await mkdtemp(join(root, '.artifacts/system-topology-ui-'));
let components: { Graph: import('react').ComponentType<any>; TechnologyMark: import('react').ComponentType<any> };
try { const path = join(directory, 'render.mjs'); await writeFile(path, compiled.outputFiles[0]!.text); components = await import(pathToFileURL(path).href); }
finally { await rm(directory, { recursive: true, force: true }); }
function topology(): SystemTopologyView {
  const nodes: SystemTopologyView['nodes'] = [
    { id: 'api', label: 'Application', category: 'compute', origin: 'deployment', boundaryId: 'runtime', technology: { id: 'nodejs', label: 'Node.js' }, bindings: { resourceIds: ['services'] }, status: 'starting', statusLabel: 'Starting', originLabel: 'Installed by deployment', facts: { installed: 'unknown', running: 'unknown', connected: 'unknown' }, evidenceScope: 'shared-resource', progress: { completed: 0, total: 1, indeterminate: true }, evidence: [{ kind: 'deployment', runId: 'run', complete: true }], limitations: ['One shared service operation.'] },
    { id: 'files', label: 'Application data', category: 'storage', origin: 'embedded', boundaryId: 'runtime', technology: { id: 'sqlite', label: 'SQLite' }, bindings: { resourceIds: [] }, status: 'unknown', statusLabel: 'Unconfirmed', originLabel: 'Embedded in app', facts: { installed: 'unknown', running: 'unknown', connected: 'unknown' }, evidenceScope: 'none', progress: { completed: 0, total: 1, indeterminate: true }, evidence: [], limitations: [] },
    { id: 'identity', label: 'Company sign-in', category: 'identity', origin: 'existing', bindings: { resourceIds: [], checkIds: ['login'] }, status: 'connected', statusLabel: 'Connected', originLabel: 'Existing', facts: { installed: 'unknown', running: 'unknown', connected: 'confirmed' }, evidenceScope: 'checks', progress: { completed: 1, total: 1, indeterminate: false }, evidence: [{ kind: 'check', runId: 'checks', complete: true }], limitations: [] },
  ];
  const boundaries: SystemTopologyView['boundaries'] = [{ id: 'host', label: 'Office server', kind: 'server', status: 'unknown', observed: false, progress: { completed: 0, total: 1, indeterminate: true }, evidence: [] }, { id: 'runtime', label: 'Service runtime', kind: 'runtime', parentId: 'host', technology: { id: 'systemd', label: 'systemd' }, status: 'starting', observed: true, progress: { completed: 0, total: 1, indeterminate: true }, evidence: [] }];
  const connections: SystemTopologyView['connections'] = [{ id: 'signin', from: 'api', to: 'identity', kind: 'communicatesWith', label: 'Sign-in service', status: 'checking', evidence: [{ kind: 'check', runId: 'checks', complete: true }] }];
  return { version: 1, kind: 'system-topology-view', definition: { version: 1, kind: 'system-topology', id: 'app', label: 'Application placement', digest: 'a'.repeat(64), binding: { targetId: 'office', graphDigest: 'b'.repeat(64) }, nodes, boundaries, connections }, observations: { targetId: 'office', graphDigest: 'b'.repeat(64), definitionDigest: 'a'.repeat(64), configurationDigest: 'c'.repeat(64), resources: [], components: [], checks: [] }, nodes, boundaries, connections, limitations: [] };
}
const render = (view = topology(), simple = false) => renderToStaticMarkup(createElement(components.Graph, { view, simple }));

test('system graph exposes host, runtime, categories, origin and declared products in readable HTML cards', () => {
  const html = render(); assert.match(html, /data-boundary-id="host"/); assert.match(html, /data-boundary-id="runtime" data-parent-id="host"/);
  assert.match(html, /Office server/); assert.match(html, /systemd/); assert.match(html, /Node.js/); assert.match(html, /SQLite/); assert.match(html, /Storage/); assert.match(html, /Identity &amp; access/);
  for (const origin of ['Existing', 'Installed by deployment', 'Embedded in app']) assert(html.includes(origin));
  assert.doesNotMatch(html, /foreignObject/); assert.match(html, /width:184px;height:104px/); assert.match(html, /arrows show communication, not deployment order/);
  assert.match(html, /role="progressbar"[^>]*aria-valuetext="Not fully verified"/);
});
test('simple and system design retain the same component IDs, connections and truthful evidence scope', () => {
  const simple = render(topology(), true), detailed = render();
  for (const html of [simple, detailed]) { assert.match(html, /data-component-id="api"/); assert.match(html, /Sign-in service: Checking/); assert.match(html, /shared operation/); assert.match(html, /Unconfirmed/); }
  assert.match(simple, /What runs where, and what is connected/);
});
test('connection failures and recovery use only supplied check states', () => {
  const view = topology(); (view.connections[0] as {status: string}).status = 'failed'; assert.match(render(view), /class="topology-edge-label edge-failed"[^>]*>Failed/);
  (view.connections[0] as {status: string}).status = 'connected'; assert.match(render(view), /class="topology-edge-label edge-connected"[^>]*aria-label="Sign-in service: Connected"/);
  (view.connections[0] as {status: string}).status = 'untested'; const html = render(view); assert.match(html, /class="topology-edge-label edge-untested"[^>]*>Not checked/); assert.doesNotMatch(html, /class="topology-edge-label edge-connected"/);
});
test('live arrows use explicit-size status-coloured heads and a separate crossing halo', () => {
  const html = render();
  assert.match(html, /markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8"/);
  assert.match(html, /fill="#b67a18"/);
  assert.match(html, /class="topology-wire-halo"/);
  assert.match(html, /class="topology-wire-line"[^>]+marker-end="url\(#[^)]+-checking\)"/);
  assert.doesNotMatch(html, /context-stroke/);
});
test('layout physically contains nested runtime and components without implying a compute/storage deployment order', () => {
  const view = topology(), result = layoutSystemTopology(view), map = new Map(result.boxes.map(box => [box.id, box]));
  const host = map.get('host')!, runtime = map.get('runtime')!, node = map.get('api')!;
  assert(runtime.x > host.x && runtime.y > host.y); assert(runtime.x + runtime.width < host.x + host.width); assert(node.x > runtime.x && node.y > runtime.y); assert(node.x + node.width < runtime.x + runtime.width); assert.equal(map.get('files')!.y, node.y);
});
test('unknown technology remains local generic glyph plus declared label, never an arbitrary image request', () => {
  const html = renderToStaticMarkup(createElement(components.TechnologyMark, { technology: { id: 'https://untrusted.invalid/icon.svg', label: 'Custom runtime' }, category: 'compute' }));
  assert.match(html, /Custom runtime/); assert.doesNotMatch(html, /https:|<img|<image|<script/);
});
test('the optional topology UI is a separate browser chunk with no architecture renderer in the entry', async () => {
  const result = await build({ absWorkingDir: root, entryPoints: ['web/features/system-topology/SystemTopologySlot.tsx'], outdir: '/not-written', bundle: true, write: false, splitting: true, platform: 'browser', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent' });
  const entry = result.outputFiles.find(file => file.path.endsWith('/SystemTopologySlot.js'))!.text;
  assert.match(entry, /import\(/); assert.doesNotMatch(entry, /topology-node-category|Placement declared/);
  assert(result.outputFiles.some(file => file.path.includes('/SystemTopologyGraph-') && file.text.includes('topology-node-category')));
});

test('known technologies use the pinned bundled brand subset on nodes and boundaries', () => {
  const html = render(); assert.match(html, /src="data:image\/svg\+xml,/);
  for (const id of ['kubernetes', 'nodejs', 'nodedotjs', 'python', 'sqlite']) {
    const mark = renderToStaticMarkup(createElement(components.TechnologyMark, { technology: { id, label: id }, category: 'compute' }));
    assert.match(mark, /<img src="data:image\/svg\+xml,/); assert.doesNotMatch(mark, /src="https?:/);
  }
  const systemd = renderToStaticMarkup(createElement(components.TechnologyMark, { technology: { id: 'systemd', label: 'systemd' } }));
  assert.doesNotMatch(systemd, /<img/); assert.match(systemd, /systemd/);
});

test('failed and checking boundary evidence remains visible even before host identity is verified', () => {
  const view = topology(); Object.assign(view.boundaries[0]!, { status: 'failed', observed: false });
  assert.match(render(view), /<small>Needs attention<\/small>/);
  Object.assign(view.boundaries[0]!, { status: 'checking', observed: false });
  assert.match(render(view), /<small>Checking<\/small>/);
});

test('a seven-component host, runtime and external directory fit a normal laptop graph without shrinking text', () => {
  const base=topology(),template=base.nodes[0]!;
  const view={...base,boundaries:[{...base.boundaries[0]!,id:'host'},{...base.boundaries[1]!,id:'runtime',parentId:'host'},{...base.boundaries[0]!,id:'directory'}],nodes:[
    ...['api','tools','sessions'].map(id=>({...template,id,boundaryId:'runtime'})),
    ...['collectors','fleet','endpoint'].map(id=>({...template,id,boundaryId:'host'})),
    {...template,id:'identity',boundaryId:'directory'},
  ]};
  const geometry=layoutSystemTopology(view);assert(geometry.width<=1020);assert(geometry.height<=400);
  assert(geometry.boxes.filter(box=>box.kind==='node').every(box=>box.width===184&&box.height===104));
});

test('Neo placement connections use orthogonal free corridors and labels never cover cards or boundary titles',async () => {
  const {routeTopologyConnection}=await import('../web/features/system-topology/topology-routing.ts');
  const base=topology(),template=base.nodes[0]!;
  const view={...base,boundaries:[{...base.boundaries[0]!,id:'host'},{...base.boundaries[1]!,id:'runtime',parentId:'host'},{...base.boundaries[0]!,id:'directory'}],nodes:[
    ...['api','tools','sessions'].map(id=>({...template,id,boundaryId:'runtime'})),
    ...['collectors','fleet','endpoint'].map(id=>({...template,id,boundaryId:'host'})),{...template,id:'identity',boundaryId:'directory'},
  ]};
  const geometry=layoutSystemTopology(view),boxes=new Map(geometry.boxes.map(box=>[box.id,box])),routes:import('../web/features/system-topology/topology-routing.ts').TopologyRoute[]=[];
  const obstacles=geometry.boxes.map(box=>({...box,height:box.kind==='boundary'?28:box.height}));
  for(const[from,to]of [['endpoint','api'],['endpoint','tools'],['tools','collectors'],['api','identity'],['api','sessions'],['api','fleet']]){
    const route=routeTopologyConnection(boxes.get(from!)!,boxes.get(to!)!,boxes,routes);assert(route.path,`${from} → ${to} has a path`);
    for(let index=1;index<route.points.length;index++){const a=route.points[index-1]!,b=route.points[index]!;assert(a.x===b.x||a.y===b.y);for(const rect of obstacles){const intersects=a.x===b.x?a.x>rect.x&&a.x<rect.x+rect.width&&Math.max(a.y,b.y)>rect.y&&Math.min(a.y,b.y)<rect.y+rect.height:a.y>rect.y&&a.y<rect.y+rect.height&&Math.max(a.x,b.x)>rect.x&&Math.min(a.x,b.x)<rect.x+rect.width;assert(!intersects,`${from} → ${to} stays outside ${rect.id}`);}}
    if(to==='sessions'){routes.push({...route,labelHidden:true});continue;}
    assert(!route.labelHidden,`${from} → ${to} retains its live status label`);
    const label={x:route.x-31,y:route.y-8,width:62,height:16};for(const rect of obstacles)assert(!(label.x<rect.x+rect.width&&label.x+label.width>rect.x&&label.y<rect.y+rect.height&&label.y+label.height>rect.y),`${from} → ${to} label stays outside ${rect.id}`);
    routes.push(route);
  }
});
