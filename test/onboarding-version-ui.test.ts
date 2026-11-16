import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build, type Metafile } from 'esbuild';
import type { OnboardingVersionSnapshot } from '../src/core/onboarding-versions.ts';
import { versionComposition } from './helpers/onboarding-versions.ts';

const root = join(import.meta.dirname, '..');
const result = await build({ stdin: { contents: "export {VersionReview} from './web/features/onboarding/versions/VersionReview.tsx'; export {VersionHistory} from './web/features/onboarding/versions/VersionHistory.tsx';", loader: 'ts', resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', logLevel: 'silent', plugins: [{ name: 'public-node-ui-dependencies', setup(builder) {
  builder.onResolve({ filter: /^[^./]/ }, args => ({ path: import.meta.resolve(args.path), external: true }));
} }] });
const directory = await mkdtemp(join(tmpdir(), 'lens-version-ui-module-')); let components: { VersionReview: ComponentType<any>; VersionHistory: ComponentType<any> };
try { const path = join(directory, 'render.mjs'); await writeFile(path, result.outputFiles[0]!.text); components = await import(pathToFileURL(path).href); }
finally { await rm(directory, { recursive: true, force: true }); }
function render(view: OnboardingVersionSnapshot, selected = 'v2', technical = true) { return renderToStaticMarkup(createElement(components.VersionReview, { view, selected, setSelected() {}, disabled: view.busy, technical, onTechnical() {}, onAction() {} })); }
async function fixture(t: test.TestContext) { const directory = await mkdtemp(join(tmpdir(), 'lens-version-ui-')); t.after(() => rm(directory, { recursive: true, force: true })); return versionComposition(directory); }
test('review shows registered setup selection, exact native digests and impact before an explicit activation', async t => {
  const f = await fixture(t), view = await f.registry.dispatch({ action: 'review-version', versionId: 'v2' }), html = render(view);
  assert.match(html, /Available setup version/); assert.match(html, /Stricter readiness/); assert.match(html, /Readiness checks/); assert.match(html, /Connection settings or policy/);
  for (const change of view.review!.changes) { assert.ok(html.includes(change.before)); assert.ok(html.includes(change.after)); }
  assert.ok(html.includes(view.review!.reviewId)); assert.ok(html.includes(view.review!.recording!.runId));
  assert.match(html, /does not create, replace, restart or delete resources/); assert.match(html, />Activate reviewed setup<\/button>/);
  const other = render(view, 'v1'); assert.match(other, /already active/); assert.match(other, /disabled=""[^>]*>Activate reviewed setup/);
  assert.equal(f.calls.plan, 0); assert.equal(f.calls.apply, 0);
});
test('settled unknown owners show native blocker IDs without offering activation', async t => {
  const f = await fixture(t); f.modes.host = 'unknown'; const view = await f.registry.dispatch({ action: 'review-version', versionId: 'v2' }), html = render(view);
  assert.match(html, /Update blocked/); assert.match(html, /earlier outcome could not be confirmed/); assert.match(html, /host-observation-v1/); assert.match(html, /host-v1/);
  assert.match(html, /disabled=""[^>]*>Activate reviewed setup/); assert.doesNotMatch(html, /Your app is ready/);
});
test('a real in-flight registry frame shows recording progress rather than provisional blocked or incomplete errors', async t => {
  const f = await fixture(t), frames: OnboardingVersionSnapshot[] = []; const stop = f.registry.subscribe(view => { if (view.busy) frames.push(view); });
  try { await f.registry.dispatch({ action: 'review-version', versionId: 'v2' }); } finally { stop(); }
  assert.ok(frames.length > 0); const html = render(frames[0]!);
  assert.match(html, /Recording the setup update/); assert.doesNotMatch(html, /Update blocked|Update blockers|retained configuration intent is incomplete|earlier outcome could not be confirmed/);
  assert.match(html, /disabled=""[^>]*>Activate reviewed setup/);
});
test('version history keeps complete source digests and old native run identities without promoting historical readiness', async t => {
  const f = await fixture(t); for (const action of ['discover', 'configure', 'verify', 'review'] as const) await f.registry.activeWorkflow.dispatch({ action });
  await f.registry.activeWorkflow.dispatch({ action: 'deploy', reviewId: (await f.registry.activeWorkflow.snapshot()).review!.reviewId! });
  const review = await f.registry.dispatch({ action: 'review-version', versionId: 'v2' }), view = await f.registry.dispatch({ action: 'activate-version', reviewId: review.review!.reviewId });
  const html = renderToStaticMarkup(createElement(components.VersionHistory, { view }));
  assert.match(html, /Historical version · Recorded ready/); assert.match(html, /Current version · Recorded idle/); assert.ok(html.includes(view.history[0]!.workflow.recording!.runId)); assert.ok(html.includes(view.versions[0]!.releaseDigest));
  assert.match(html, /Historical readiness does not promote the current setup/); assert.doesNotMatch(html, /Activate reviewed setup|Your app is ready/);
});
test('configuration version UI and styles remain behind their separate dynamic boundary', async () => {
  const output = await build({ absWorkingDir: root, entryPoints: ['web/App.tsx'], outdir: '/virtual-versioned-lens', write: false, bundle: true, format: 'esm', splitting: true, platform: 'browser', jsx: 'automatic', metafile: true, logLevel: 'silent' });
  const meta = output.metafile!, target = 'web/features/onboarding/versions/OnboardingVersionPanel.tsx';
  function inputs(path: string, seen = new Set<string>()): Set<string> { if (seen.has(path)) return new Set(); seen.add(path); const item = meta.outputs[path]!, result = new Set(Object.keys(item.inputs)); for (const child of item.imports) if (!child.external && child.kind === 'import-statement') for (const value of inputs(child.path, seen)) result.add(value); return result; }
  const main = Object.entries(meta.outputs).find(([, item]) => item.entryPoint === 'web/App.tsx')!;
  const legacy = Object.entries(meta.outputs).find(([, item]) => item.entryPoint === 'web/features/onboarding/OnboardingPanel.tsx')!;
  assert.equal(inputs(main[0]).has(target), false); assert.equal(inputs(legacy[0]).has(target), false); assert.ok(Object.values(meta.outputs).some(item => item.entryPoint === target));
  const css = output.outputFiles.find(file => file.path.endsWith('/' + meta.outputs[main[0]]!.cssBundle!.split('/').at(-1)))!.text; assert.doesNotMatch(css, /setup-version-strip|setup-version-panel/);
});
