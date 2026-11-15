import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import test from 'node:test';
import type { ApplicationView } from '../src/core/application.ts';
import type { DashboardState } from '../src/core/types.ts';
import type { ConnectionProfilesView } from '../src/core/connection-profiles.ts';
import { compileGraph } from 'footprintjs-iac/graph';

const compiled = await build({ stdin: { contents: "export { ApplicationSetupPanel, ApplicationSetupDetails } from './web/components/ApplicationSetupPanel.tsx'; export { applicationSelectionAction, applicationSetupSteps } from './web/lib/application-setup.ts'; export { SimpleDashboard } from './web/components/SimpleDashboard.tsx';", resolveDir: import.meta.dirname + '/..', loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent' });
const cache = join(import.meta.dirname, '../.artifacts'); await mkdir(cache, { recursive: true });
const folder = await mkdtemp(join(cache, 'application-ui-')); let components;
try { const path = join(folder, 'render.mjs'); await writeFile(path, compiled.outputFiles[0]!.text); components = await import(pathToFileURL(path).href); }
finally { await rm(folder, { recursive: true, force: true }); }
const noop = () => {};
const application = (): ApplicationView => ({ id: 'research', label: 'Research portal', phase: 'choose', busy: false,
  canInspect: false, canReview: false, canDeploy: false, strategies: [
    { id: 'process', label: 'Existing server', targets: [{ id: 'office', label: 'Office server', requiresProfile: true, profileAdapterIds: ['office-access'], requiredInspectionCheckIds: ['host'], requiredVerificationCheckIds: ['health', 'login', 'allowed', 'denied'] }] },
    { id: 'cluster', label: 'Kubernetes', targets: [{ id: 'lab', label: 'Development cluster', requiresProfile: false, requiredInspectionCheckIds: ['cluster'], requiredVerificationCheckIds: ['health', 'login', 'allowed', 'denied'] }] },
  ] });
const profiles: ConnectionProfilesView = { requiredAtStart: true, busy: false, schemas: [
  { id: 'office-access', label: 'Office access', fields: [{ name: 'endpoint', label: 'Server address', kind: 'url', required: true }, { name: 'token', label: 'Access token', kind: 'password', required: true }] },
  { id: 'other-access', label: 'Unrelated access', fields: [] },
], profiles: [
  { id: 'saved-office', label: 'My office connection', adapterId: 'office-access', revision: 1, config: { endpoint: 'https://office.example' } },
  { id: 'saved-other', label: 'Unrelated connection', adapterId: 'other-access', revision: 1, config: {} },
] };
const state = (view = application()): DashboardState => ({ revision: 1, mode: 'managed', busy: view.busy, graph: null, application: view, connectionProfiles: profiles });
const render = (view = application(), posting = false) => renderToStaticMarkup(createElement(components.ApplicationSetupPanel, { state: state(view), posting, onAction: noop }));

test('application setup presents host choices without a simulator button or empty resource scene', () => {
  const html = renderToStaticMarkup(createElement(components.SimpleDashboard, { state: state(), posting: false, onRun: noop, onResourceFlow: noop, onDismissError: noop, onDetails: noop, onApplication: noop }));
  assert.match(html, /Research portal/); assert.match(html, /Application setup/);
  assert.match(html, /Existing server/); assert.match(html, /Kubernetes/); assert.match(html, /Setup progress/);
  assert.doesNotMatch(html, />Build system<|Simulation|0<span> \/ 0 ready|Your system being built/);
});

test('connection choice is filtered to the target and cannot enable deployment before a sealed review', () => {
  const view = { ...application(), selection: { strategyId: 'process', targetId: 'office' }, canInspect: false };
  const html = render(view);
  assert.match(html, /Choose a saved connection/); assert.match(html, /My office connection/);
  assert.doesNotMatch(html, /Unrelated connection|Unrelated access|https:\/\/office.example/);
  assert.match(html, /disabled=""[^>]*>Check setup<\/button>/);
  assert.doesNotMatch(html, />Deploy<\/button>/);
});

test('inspection and review outcomes unlock only their corresponding next action', () => {
  const inspected: ApplicationView = { ...application(), selection: { strategyId: 'cluster', targetId: 'lab' }, phase: 'review', canInspect: true, canReview: true,
    inspection: { ok: true, checks: [{ id: 'cluster', label: 'Cluster identity', status: 'passed' }] } };
  assert.match(render(inspected), />Review changes<\/button>/); assert.doesNotMatch(render(inspected), />Deploy<\/button>/);
  const reviewed: ApplicationView = { ...inspected, phase: 'deploy', canDeploy: true, review: { ok: true, reviewId: 'sealed-42', changes: [{ resourceId: 'program', label: 'Program', action: 'update' }, { resourceId: 'storage', label: 'Storage', action: 'noop' }] } };
  const html = render(reviewed); assert.match(html, />Deploy<\/button>/); assert.match(html, /1 change/); assert.match(html, /1 unchanged/);
  assert.match(render(reviewed, true), /disabled=""[^>]*>.*?Deploy<\/button>/s);
});

test('verification failure and incomplete effects never become ready or offer a deploy retry', () => {
  const failed: ApplicationView = { ...application(), selection: { strategyId: 'cluster', targetId: 'lab' }, phase: 'failed', canInspect: true,
    deployment: { ok: false, promoted: false, status: 'verification-failed', checks: [{ id: 'login', label: 'Sign in', status: 'failed' }] } };
  const html = render(failed); assert.match(html, /Needs attention/); assert.match(html, /Sign in/); assert.doesNotMatch(html, /Ready to use|>Open app<|>Deploy<\/button>/);
  assert.equal(components.applicationSetupSteps(failed).find((step: { id: string }) => step.id === 'deploy').status, 'unknown');
  const uncertain: ApplicationView = { ...failed, phase: 'incomplete', canInspect: false, deployment: { ok: false, promoted: false, status: 'incomplete' } };
  assert.match(render(uncertain), /Refresh status/); assert.doesNotMatch(render(uncertain), />Deploy<\/button>/);
  const steps = components.applicationSetupSteps(uncertain);
  assert.notEqual(steps.find((step: { id: string; status: string }) => step.id === 'verify').status, 'passed');
});

test('public selection actions contain only registered identifiers', () => {
  assert.deepEqual(components.applicationSelectionAction(application(), 'process', 'office', 'saved-office'), { action: 'select', strategyId: 'process', targetId: 'office', profileId: 'saved-office' });
  assert.equal(components.applicationSelectionAction(application(), 'process', 'lab'), undefined);
  assert.equal(components.applicationSelectionAction(application(), '../../commands', 'office'), undefined);
});

test('technical details preserve actual changes and check identities without inventing evidence', () => {
  const view: ApplicationView = { ...application(), selection: { strategyId: 'cluster', targetId: 'lab' }, phase: 'ready',
    review: { ok: true, reviewId: 'sealed-42', changes: [{ resourceId: 'program', label: 'Program', action: 'update' }] },
    deployment: { ok: true, promoted: true, status: 'promoted', checks: [{ id: 'health', label: 'Program health', status: 'passed' }, { id: 'login', label: 'Sign in', status: 'passed' }, { id: 'allowed', label: 'Owned access allowed', status: 'passed' }, { id: 'denied', label: 'Foreign access denied', status: 'passed' }], appUrl: 'http://127.0.0.1:5000' } };
  const html = renderToStaticMarkup(createElement(components.ApplicationSetupDetails, { state: state(view) }));
  assert.match(html, /program/); assert.match(html, /Program health/); assert.match(html, /Foreign access denied/); assert.match(html, /sealed-42/);
  assert.match(render(view), /Ready to use/); assert.match(render(view), /href="http:\/\/127.0.0.1:5000"/);
});

test('uncertain refresh cannot turn a retained successful deployment into current readiness', () => {
  const view: ApplicationView = { ...application(), selection: { strategyId: 'cluster', targetId: 'lab' }, phase: 'incomplete',
    error: 'The latest native status could not be confirmed.', deployment: { ok: true, promoted: true, status: 'promoted',
      checks: ['health', 'login', 'allowed', 'denied'].map(id => ({ id, label: id, status: 'passed' as const })), appUrl: 'http://127.0.0.1:5000' } };
  const html = render(view);
  assert.match(html, /Result not confirmed/); assert.match(html, /Refresh status/); assert.match(html, /Last recorded checks/);
  assert.doesNotMatch(html, /Ready to use|>Open app<|href="http:\/\/127.0.0.1:5000"|Deployment and application checks passed/);
  const steps = components.applicationSetupSteps(view);
  assert.equal(steps.find((step: { id: string }) => step.id === 'deploy').status, 'unknown');
  assert.equal(steps.find((step: { id: string }) => step.id === 'verify').status, 'unknown');
  const reading = render({ ...view, busy: true });
  assert.match(reading, /Reading recorded status/); assert.doesNotMatch(reading, /Deploying your app|>Open app</);
});

test('startup uncertainty can refresh native status without choosing or changing a target', () => {
  const view: ApplicationView = { ...application(), phase: 'incomplete', error: 'The application history could not be confirmed.' };
  const html = render(view);
  assert.match(html, /Result not confirmed/); assert.match(html, /The application history could not be confirmed/);
  assert.match(html, /<button type="button" class="simple-button simple-primary">Refresh status<\/button>/);
  assert.match(html, /aria-label="Deployment strategy"[^>]*disabled=""/);
  assert.match(html, /Inspect the last record before continuing/);
  const selected = render({ ...view, selection: { strategyId: 'process', targetId: 'office', profileId: 'saved-office' } });
  assert.match(selected, /aria-label="Saved connection"[^>]*disabled=""/); assert.doesNotMatch(selected, />Add connection</);
});

test('application resource captions reflect blocked setup and pending review without changing native readiness', () => {
  const graph = compileGraph({ name: 'research', resources: [{ id: 'program', provider: 'fixture', spec: {} }], boundaries: [], memberships: [], relations: [] });
  const dashboard = (value: DashboardState) => renderToStaticMarkup(createElement(components.SimpleDashboard, { state: value, posting: false, onRun: noop, onResourceFlow: noop, onDismissError: noop, onDetails: noop, onApplication: noop }));
  const cases: [ApplicationView, string][] = [
    [application(), 'Waiting for setup'],
    [{ ...application(), phase: 'inspect', busy: true }, 'Waiting for setup'],
    [{ ...application(), phase: 'review' }, 'Deployment not started'],
    [{ ...application(), phase: 'deploy' }, 'Deployment not started'],
    [{ ...application(), phase: 'failed', inspection: { ok: false, checks: [{ id: 'host', label: 'Target identity', status: 'failed' }] } }, 'Needs attention'],
    [{ ...application(), phase: 'incomplete' }, 'Needs attention'],
  ];
  for (const [view, caption] of cases) {
    const html = dashboard({ ...state(view), graph });
    assert.match(html, new RegExp('class="simple-stage phase-idle"[^]*?<h2 aria-live="polite">' + caption + '</h2>'));
    assert.doesNotMatch(html, /Ready to build/);
    assert.match(html, /0<span> \/ 1 ready<\/span>/);
  }
  const active = dashboard({ ...state({ ...application(), phase: 'deploy', busy: true }), graph,
    run: { id: 'native-build', mode: 'managed', status: 'running', resources: [{ id: 'program', resourceId: 'program', status: 'pending' }], events: [] } });
  assert.match(active, /class="simple-stage phase-starting"[^]*?<h2 aria-live="polite">Running your code<\/h2>/);
  const simulator = dashboard({ revision: 1, mode: 'simulator', busy: false, graph });
  assert.match(simulator, /<h2 aria-live="polite">Ready to build<\/h2>/); assert.match(simulator, />Build system<\/button>/);
});
