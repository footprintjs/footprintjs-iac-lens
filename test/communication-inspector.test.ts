import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { infra } from 'footprintjs-iac/graph';
import { declaredConnection, untestedConnections } from '../src/core/connections.ts';

const root = join(import.meta.dirname, '..');
const bundle = await build({ stdin: { contents: "export {ConnectionChecks} from './web/components/ConnectionChecks.tsx';", resolveDir: root },
  platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', bundle: true, write: false });
const artifacts = join(root, '.artifacts');
await mkdir(artifacts, { recursive: true });
const directory = await mkdtemp(join(artifacts, 'communication-inspector-'));
let Component: typeof import('../web/components/ConnectionChecks.tsx').ConnectionChecks;
try {
  const entry = join(directory, 'render.mjs');
  await writeFile(entry, bundle.outputFiles[0]!.text);
  Component = (await import(pathToFileURL(entry).href)).ConnectionChecks;
} finally { await rm(directory, { recursive: true, force: true }); }
const graph = infra('demo').resource('app','host',{}).resource('bucket','fixture',{})
  .connect('app','bucket','communicatesWith','Read reports',{ operation:'GetObject', protocol:{ application:'HTTPS',transport:'TCP',port:443 },route:{network:'IPv4',via:['Gateway endpoint']} }).build();
const connections = untestedConnections(graph);
const check = connections.checks[0]!;

test('OSI and configured route appear only after selection, with independent check state', () => {
  const state = { revision:1, busy:false, graph, connections };
  const props = { state, onSelect() {}, onCheck() {}, onEvidence() {} };
  const closed = renderToStaticMarkup(createElement(Component, props));
  assert.doesNotMatch(closed, /GetObject|OSI|Gateway endpoint/);
  const opened = renderToStaticMarkup(createElement(Component, { ...props,selected:check.connectionId }));
  for (const term of ['GetObject','OSI 7','OSI 4','OSI 3','Gateway endpoint','No recorded check yet']) assert(opened.includes(term));
  assert.equal(declaredConnection(graph, {...check,from:'bucket'}),undefined);
  assert.equal(declaredConnection(graph, {...check,connectionId:'communication:00'}),undefined);
});
