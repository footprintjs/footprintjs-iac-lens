import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { ONBOARDING_STAGE_IDS, ONBOARDING_STAGE_LABELS } from 'footprintjs-iac/onboarding';
import { onboardingNextAction, type OnboardingSnapshot } from '../src/core/onboarding.ts';
import type { DashboardState } from '../src/core/types.ts';

const compiled = await build({ stdin: { contents: "export {default as OnboardingPanel} from './web/features/onboarding/OnboardingPanel.tsx'; export {SimpleDashboard} from './web/components/SimpleDashboard.tsx';", resolveDir: import.meta.dirname + '/..', loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent' });
const cache = join(import.meta.dirname, '../.artifacts'); await mkdir(cache, { recursive: true });
const directory = await mkdtemp(join(cache, 'onboarding-ui-')); let components: { OnboardingPanel: import('react').ComponentType<any>; SimpleDashboard: import('react').ComponentType<any> };
try { const path = join(directory, 'render.mjs'); await writeFile(path, compiled.outputFiles[0]!.text); components = await import(pathToFileURL(path).href); }
finally { await rm(directory, { recursive: true, force: true }); }
const noop = () => {};
function snapshot(): OnboardingSnapshot { return { id: 'registered-app', label: 'Research application', strategyId: 'systemd', targetId: 'office-server', configurationDigest: 'a'.repeat(64), status: 'idle', busy: false,
  stages: ONBOARDING_STAGE_IDS.map(id => ({ id, label: ONBOARDING_STAGE_LABELS[id], status: 'pending' })), checks: [], canDiscover: true, canConfigure: false, canVerify: false, canReview: false, canDeploy: false, canReconcile: false }; }
function state(view = snapshot()): DashboardState { return { revision: 1, graph: null, mode: 'managed', busy: view.busy, onboarding: view }; }
function render(view = snapshot(), posting = false) { return renderToStaticMarkup(createElement(components.OnboardingPanel, { state: state(view), posting, onAction: noop })); }

test('onboarding begins with every declared stage grey and one native action', () => {
  const html = render();
  for (const label of Object.values(ONBOARDING_STAGE_LABELS)) assert.ok(html.includes(label));
  assert.equal((html.match(/class="onboarding-stage-pending"/g) ?? []).length, 5);
  assert.match(html, />Discover setup<\/button>/); assert.doesNotMatch(html, />Deploy reviewed changes<\/button>|Your app is ready|Open app|Simulation/);
  assert.deepEqual(onboardingNextAction(snapshot()).action, { action: 'discover' });
});
test('simple and detailed workspaces do not offer the legacy simulator alongside onboarding', () => {
  const html = renderToStaticMarkup(createElement(components.SimpleDashboard, { state: state(), posting: false, onRun: noop, onResourceFlow: noop, onDismissError: noop, onDetails: noop, onOnboarding: noop }));
  assert.match(html, /Research application/); assert.doesNotMatch(html, />Build system<|0<span> \/ 0 ready|Local simulator/);
  const view = snapshot(); view.status = 'ready'; view.stages = view.stages.map(stage => ({ ...stage, status: 'passed' })); view.deployment = { ok: true, promoted: true, status: 'promoted' };
  const ready = renderToStaticMarkup(createElement(components.SimpleDashboard, { state: state(view), neoUrl: 'http://127.0.0.1:55330', posting: false, onRun: noop, onResourceFlow: noop, onDismissError: noop, onDetails: noop, onOnboarding: noop }));
  assert.match(ready, /Open app/); assert.doesNotMatch(ready, /Open Neo/);
});
test('only the native running stage lights up and controls wait for the workflow', () => {
  const view = snapshot(); view.status = 'configured'; view.busy = true; view.canDiscover = false;
  view.stages = view.stages.map(stage => ({ ...stage, status: stage.id === 'verify' ? 'running' : ['discover', 'configure'].includes(stage.id) ? 'passed' : 'pending' }));
  const html = render(view); assert.equal((html.match(/class="onboarding-stage-running"/g) ?? []).length, 1);
  assert.equal((html.match(/class="onboarding-stage-passed"/g) ?? []).length, 2);
  assert.match(html, /Verify connections…/); assert.match(html, /disabled=""[^>]*>Working…<\/button>/);
  assert.doesNotMatch(html, /Your app is ready|>Deploy reviewed changes<\/button>/);
});
test('unknown or failed observations remain visible and cannot imply readiness', () => {
  const view = snapshot(); view.status = 'failed'; view.canDiscover = true;
  view.checks = [{ id: 'identity-connection', label: 'Sign-in connection', status: 'unknown' }];
  view.stages = view.stages.map(stage => ({ ...stage, status: stage.id === 'verify' ? 'unknown' : stage.status }));
  const html = render(view); assert.match(html, /Not confirmed/); assert.match(html, /Setup needs attention/);
  assert.doesNotMatch(html, /Your app is ready|Deployment and application checks passed|>Deploy reviewed changes<\/button>/);
});
test('the reviewed action carries its complete exact review id and a failed deployment offers no direct retry', () => {
  const view = snapshot(); view.status = 'reviewed'; view.canReview = true; view.canDeploy = true; view.canConfigure = true; view.canVerify = true;
  view.stages = view.stages.map(stage => ({ ...stage, status: stage.id === 'deploy' ? 'pending' : 'passed' }));
  const reviewId = 'native-review-complete-identity-0123456789'; view.review = { ok: true, reviewId, changes: [{ resourceId: 'app-service', label: 'App service', action: 'update' }, { resourceId: 'data', label: 'Storage', action: 'noop' }] };
  assert.deepEqual(onboardingNextAction(view).action, { action: 'deploy', reviewId }); assert.match(render(view), /1 change/); assert.match(render(view), /1 unchanged/);
  view.status = 'incomplete'; view.canDiscover = false; view.canConfigure = false; view.canVerify = false; view.canReview = false; view.canDeploy = false; view.canReconcile = true;
  view.deployment = { ok: false, promoted: false, status: 'incomplete' };
  assert.deepEqual(onboardingNextAction(view).action, { action: 'reconcile', reviewId });
  const html = render(view); assert.match(html, />Inspect outcome<\/button>/); assert.doesNotMatch(html, /Your app is ready|>Deploy reviewed changes<\/button>/);
});
test('completed onboarding shows a terminal result and offers a fresh inspection instead of another review', () => {
  const view = snapshot(); view.status = 'ready'; view.stages = view.stages.map(stage => ({ ...stage, status: 'passed' }));
  view.canConfigure = true; view.canVerify = true; view.canReview = true; view.deployment = { ok: true, promoted: true, status: 'promoted' };
  assert.deepEqual(onboardingNextAction(view).action, { action: 'discover' });
  const html = render(view); assert.match(html, /Your app is ready/); assert.match(html, />Check setup again<\/button>/); assert.doesNotMatch(html, />Review changes<\/button>|>Deploy reviewed changes<\/button>/);
  view.busy = true; view.canDiscover = false; view.canConfigure = false; view.canVerify = false; view.canReview = false;
  const reading = render(view); assert.match(reading, /Reading setup…/); assert.doesNotMatch(reading, /Your app is ready|Deployment and application checks passed/);
});
test('post-deployment health and access checks retain their native IDs and failures never become readiness', () => {
  const view = snapshot(); view.status = 'ready'; view.stages = view.stages.map(stage => ({ ...stage, status: 'passed' }));
  const checks = [{ id: 'health', label: 'App health', status: 'passed' as const }, { id: 'login', label: 'Sign in', status: 'passed' as const },
    { id: 'allowed', label: 'Owned access allowed', status: 'passed' as const }, { id: 'denied', label: 'Foreign access denied', status: 'passed' as const }];
  view.checks = checks; view.deployment = { ok: true, promoted: true, status: 'promoted', checks };
  const ready = render(view); assert.match(ready, /aria-label="Recorded application checks"/); assert.doesNotMatch(ready, /aria-label="Recorded setup checks"/);
  for (const check of checks) { assert.ok(ready.includes(`data-check-id="${check.id}"`)); assert.ok(ready.includes(check.label)); }
  assert.equal((ready.match(/data-check-id=/g) ?? []).length, 4);
  view.status = 'failed'; view.stages = view.stages.map(stage => stage.id === 'deploy' ? { ...stage, status: 'failed' } : stage);
  const failure = checks.map(check => check.id === 'login' ? { ...check, status: 'failed' as const } : check.id === 'denied' ? { ...check, status: 'unknown' as const } : check);
  view.checks = failure; view.deployment = { ok: false, promoted: false, status: 'verification-failed', checks: failure };
  const failed = render(view); assert.match(failed, /data-check-id="login" class="onboarding-check-failed"/); assert.match(failed, /data-check-id="denied" class="onboarding-check-unknown"/);
  assert.doesNotMatch(failed, /Your app is ready|Deployment and application checks passed/); assert.match(failed, /Not confirmed/);
});
test('setup verification does not invent post-deployment login or access checks', () => {
  const view = snapshot(); view.status = 'verified'; view.checks = [{ id: 'directory-reachable', label: 'Sign-in connection', status: 'passed' }];
  const html = render(view); assert.match(html, /aria-label="Recorded setup checks"/); assert.doesNotMatch(html, /aria-label="Recorded application checks"|data-check-id="login"|data-check-id="allowed"|data-check-id="denied"|Your app is ready/);
});
test('onboarding UI is a separate dynamic chunk in the regular dashboard build', async () => {
  const result = await build({ entryPoints: ['web/App.tsx'], absWorkingDir: join(import.meta.dirname, '..'), outdir: '/virtual-onboarding-test', bundle: true, write: false, format: 'esm', splitting: true, platform: 'browser', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, metafile: true, logLevel: 'silent' });
  const entry = Object.entries(result.metafile!.outputs).find(([, output]) => output.entryPoint === 'web/App.tsx');
  assert.ok(entry); assert.equal(Object.keys(entry[1].inputs).some(path => path.endsWith('/OnboardingPanel.tsx')), false);
  const feature = Object.entries(result.metafile!.outputs).find(([, output]) => output.entryPoint?.endsWith('/OnboardingPanel.tsx'));
  assert.ok(feature, 'the optional onboarding panel has a separate dynamic entrypoint');
});
