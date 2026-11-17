import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, type Metafile } from 'esbuild';
import { createElement } from 'react';
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import { Writable } from 'node:stream';
import test from 'node:test';
import type { DashboardState } from '../src/core/types.ts';

const root = resolve(import.meta.dirname, '..');
const feature = 'web/features/agents/AgentWorkspace.tsx';
function staticInputs(meta: Metafile, entry: string): Set<string> {
  const seen = new Set<string>(), inputs = new Set<string>();
  function visit(path: string) {
    if (seen.has(path)) return;
    seen.add(path);
    const output = meta.outputs[path];
    if (!output) throw Error(`Missing output ${path}`);
    for (const input of Object.keys(output.inputs)) inputs.add(input);
    for (const imported of output.imports) if (!imported.external && imported.kind === 'import-statement') visit(imported.path);
  }
  visit(entry); return inputs;
}

test('the dashboard keeps agent code and styles behind its dynamic feature boundary', async () => {
  const result = await build({ absWorkingDir: root, entryPoints: { app: 'web/main.tsx' }, outdir: 'out-agents-shell',
    bundle: true, format: 'esm', splitting: true, platform: 'browser', target: 'es2022', jsx: 'automatic',
    write: false, metafile: true, minify: true, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' } });
  const meta = result.metafile!;
  const entry = Object.entries(meta.outputs).find(([, output]) => output.entryPoint === 'web/main.tsx')![0];
  assert.ok(!staticInputs(meta, entry).has(feature), 'The initial infrastructure bundle must not contain the Agents workspace');
  const lazy = Object.entries(meta.outputs).find(([, output]) => output.entryPoint === feature);
  assert.ok(lazy, 'Agents needs a separate dynamic entry');
  assert.ok(staticInputs(meta, lazy[0]).has(feature));
  const initialCss = meta.outputs[entry]!.cssBundle;
  const css = result.outputFiles.find(file => file.path === resolve(root, initialCss!))!.text;
  assert.doesNotMatch(css, /\.agents-workspace|agents-breath/, 'Agent-specific styles must not enter initial dashboard CSS');
});

test('the public Agents entry is independent of the dashboard shell and browser transport', async () => {
  const result = await build({ absWorkingDir: root, entryPoints: { index: 'src/react/index.ts', agents: 'src/react/agents.ts' }, outdir: 'out-agents-react',
    bundle: true, format: 'esm', splitting: true, platform: 'browser', target: 'es2022', jsx: 'automatic', write: false, metafile: true,
    external: ['react', 'react-dom', 'react/jsx-runtime', '@xyflow/react', 'footprint-explainable-ui', 'footprint-explainable-ui/*'], logLevel: 'silent' });
  const meta = result.metafile!;
  const index = Object.entries(meta.outputs).find(([, output]) => output.entryPoint === 'src/react/index.ts')![0];
  const agents = Object.entries(meta.outputs).find(([, output]) => output.entryPoint === 'src/react/agents.ts')![0];
  assert.ok(!staticInputs(meta, index).has(feature));
  const inputs = staticInputs(meta, agents);
  assert.ok(inputs.has(feature));
  assert.ok(!inputs.has('web/App.tsx'));
  assert.ok(!inputs.has('web/lib/use-dashboard.ts'));
  assert.ok(!inputs.has('src/core/client.ts'));
  const stylesheet = result.outputFiles.find(file => file.path === resolve(root, meta.outputs[agents]!.cssBundle!))!.text;
  assert.match(stylesheet, /\.agents-workspace/);
});

test('an available catalog adds agent navigation to the lazy run landing without opening the agent workspace', async () => {
  const result = await build({ stdin: { contents: "export { IacLens } from './web/App.tsx'; export { setDashboard } from './web/lib/use-dashboard.ts';", loader: 'ts', resolveDir: root },
    bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent',
    plugins: [{ name: 'admitted-shell-state', setup(builder) {
      builder.onLoad({ filter: /web\/lib\/use-dashboard\.ts$/ }, () => ({ contents: 'let dashboard; export function setDashboard(value) { dashboard = value; } export function useDashboard() { return dashboard; }', loader: 'js' }));
    } }] });
  const cache = resolve(root, '.artifacts'); await mkdir(cache, { recursive: true });
  const folder = await mkdtemp(join(cache, 'agent-shell-'));
  try {
    const file = join(folder, 'render.mjs'); await writeFile(file, result.outputFiles[0]!.text);
    const { IacLens, setDashboard } = await import(pathToFileURL(file).href);
    let opened = 0;
    const state: DashboardState = { revision: 1, busy: false, mode: 'managed', graph: null };
    const render = (current: DashboardState) => {
      setDashboard({ state: current, connected: true, posting: false, agentPlatform: () => { opened++; } });
      return renderToStaticMarkup(createElement(IacLens));
    };
    const base = render(state);
    assert.match(base, /Opening runs/);
    assert.doesNotMatch(base, /aria-label="Workspace"|>Agents<|Agents workspace/);
    // Resolve the lazy landing before checking its navigation. Availability must
    // add an entry, without selecting or opening that optional feature.
    setDashboard({ state: { ...state, agentPlatformAvailable: true, agentPlatform: {
      version: 1, id: 'admitted', label: 'Private admitted agent catalog', busy: false, agents: [], limitations: [],
    } }, connected: true, posting: false, agentPlatform: () => { opened++; } });
    const available = await new Promise<string>((resolveMarkup, reject) => {
      let markup = '';
      const stream = renderToPipeableStream(createElement(IacLens), {
        onAllReady() { stream.pipe(new Writable({
          write(chunk, _encoding, next) { markup += chunk.toString(); next(); },
          final(done) { resolveMarkup(markup); done(); },
        })); },
        onError: reject,
      });
    });
    assert.match(available, /aria-label="Lens navigation"/);
    assert.match(available, /aria-current="page"[^>]*>.*?<span>Runs<\/span>/);
    assert.match(available, /<span>Agents<\/span>/);
    assert.doesNotMatch(available, /aria-label="Workspace"|>Infrastructure<|Private admitted agent catalog|Agents workspace|Reading agent records/);
    assert.equal(opened, 0);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
