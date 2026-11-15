import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import test from 'node:test';
import { CONNECTION_PROFILE_CAPACITY, type ConnectionAdapterSchema, type ConnectionProfilesView } from '../src/core/connection-profiles.ts';
import type { DashboardState } from '../src/core/types.ts';

const compiled = await build({ stdin: { contents: `export { ConnectionProfileForm, connectionRegistration } from './web/components/ConnectionProfileForm.tsx';
export { ConnectionProfilesControl } from './web/components/ConnectionProfilesControl.tsx';
export { ResourceFlowStrip } from './web/components/ResourceFlowStrip.tsx';`, resolveDir: import.meta.dirname + '/..', sourcefile: 'connection-form-fixture.ts', loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent' });
const cache = join(import.meta.dirname, '../.artifacts'); await mkdir(cache, { recursive: true });
const folder = await mkdtemp(join(cache, 'connection-ui-')); let components;
try { const file = join(folder, 'render.mjs'); await writeFile(file, compiled.outputFiles[0]!.text); components = await import(pathToFileURL(file).href); }
finally { await rm(folder, { recursive: true, force: true }); }
const { ConnectionProfileForm, connectionRegistration, ConnectionProfilesControl, ResourceFlowStrip } = components;
const schema: ConnectionAdapterSchema = { id: 'company-system', label: 'Company system', fields: [
  { name: 'address', label: 'Server address', kind: 'url', required: true },
  { name: 'port', label: 'Server port', kind: 'integer' },
  { name: 'password', label: 'Access password', kind: 'password', required: true },
  { name: 'privateToken', label: 'Private token', kind: 'text', secret: true },
] };
const profile = { id: 'saved-connection', label: 'Office system', adapterId: schema.id, revision: 1, config: { address: 'https://company.example' } };
const view = (): ConnectionProfilesView => ({ schemas: [schema], profiles: [profile], busy: false, requiredAtStart: true });
const noop = () => {};

test('generic form renders only declared fields and masks both password-kind and explicitly private fields', () => {
  const html = renderToStaticMarkup(createElement(ConnectionProfileForm!, { schemas: [schema], disabled: false, onSave: async () => {} }));
  assert.match(html, /Server address/); assert.match(html, /type="url"/); assert.match(html, /type="number"/);
  assert.equal((html.match(/type="password"/g) ?? []).length, 2); assert.match(html, /autoComplete="off"/);
  assert.doesNotMatch(html, /type="password"[^>]*value=|localStorage|sessionStorage|LDAP|Neo/);
  assert.match(html, /maxLength="160"/);
});

test('form data serialization separates secrets from safe configuration without copying unrelated DOM fields', () => {
  const data = new FormData(); data.set('profile-label', ' Office '); data.set('field:address', 'https://company.example'); data.set('field:port', '443');
  data.set('field:password', 'entered-private-value'); data.set('field:privateToken', 'private-token'); data.set('undeclared', 'ignored');
  const input = connectionRegistration(schema, data);
  assert.deepEqual(input, { adapterId: schema.id, label: 'Office', config: { address: 'https://company.example', port: '443' },
    secrets: { password: 'entered-private-value', privateToken: 'private-token' } });
  assert.equal(JSON.stringify(input.config).includes('private'), false);
});

test('the native workflow Start requires explicit connection selection while keeping the existing chart controls', () => {
  const state: DashboardState = { revision: 0, graph: null, busy: false, connectionProfiles: view(), resourceFlow: {
    version: 1, kind: 'resource-flow-state', id: 'company-flow', resourceId: 'company-resource', label: 'Connect system', mode: 'existing',
    definitionDigest: 'a'.repeat(64), configurationDigest: 'b'.repeat(64), target: { id: 'company', scope: 'office' }, executionId: null, status: 'idle',
    stages: ['acquire', 'details', 'connect', 'verify'].map(id => ({ id: id as 'acquire' | 'details' | 'connect' | 'verify', label: id, status: 'pending' })), events: [], segments: [],
  } };
  const html = renderToStaticMarkup(createElement(ResourceFlowStrip!, { state, posting: false, onAction: noop, onProfileAction: async () => ({ action: 'register', profile }) }));
  assert.match(html, /Saved connection setup/); assert.match(html, /Choose a connection before starting/);
  assert.match(html, /disabled=""[^>]*>.*?Start workflow/); assert.match(html, />Add connection</);
  assert.match(html, /Native workflow stages/); assert.doesNotMatch(html, /Deploy system/);
});

test('a missing probe is displayed as unavailable rather than a passed or failed connection', () => {
  const catalog = { ...view(), lastTest: { profileId: profile.id, ok: false, code: 'connection-check-unavailable' as const } };
  const html = renderToStaticMarkup(createElement(ConnectionProfilesControl!, { view: catalog, selected: profile.id, locked: false, disabled: false, onSelect: noop }));
  assert.match(html, /Connection check unavailable/); assert.doesNotMatch(html, /Connection check passed|Connection check failed|class="connection-profile-failed"/);
});

test('profile capacity disables adding without disabling existing selection or tests', () => {
  const catalog = { ...view(), profiles: Array.from({ length: CONNECTION_PROFILE_CAPACITY }, (_, index) => ({ ...profile, id: 'saved-' + index })) };
  const html = renderToStaticMarkup(createElement(ConnectionProfilesControl!, { view: catalog, selected: 'saved-0', locked: false, disabled: false, onSelect: noop,
    onAction: async () => ({ action: 'test', result: { profileId: 'saved-0', ok: true } }) }));
  assert.match(html, /Connection limit reached/); assert.match(html, /disabled="">Add connection/);
  assert.match(html, /<button>Test connection/); assert.doesNotMatch(html, /aria-label="Saved connection"[^>]*disabled/);
});
