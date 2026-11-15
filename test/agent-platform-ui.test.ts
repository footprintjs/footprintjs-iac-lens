import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import test from 'node:test';
import type { AgentLayerView, AgentPlatformView, AgentRecordingRef, AgentStatus, AgentView } from '../src/core/agent-platform.ts';
import type { DashboardState } from '../src/core/types.ts';
import { deploymentRecording, recordedTurnRows } from '../web/features/agents/model.ts';
import { compileGraph } from 'footprintjs-iac/graph';

const compiled = await build({ stdin: { contents: "export { default as AgentWorkspace } from './web/features/agents/AgentWorkspace.tsx'; export { ConversationDetails } from './web/features/agents/ConversationDetails.tsx'; export { LayerDetails } from './web/features/agents/AgentDetails.tsx';", resolveDir: import.meta.dirname + '/..', loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent' });
const cache = join(import.meta.dirname, '../.artifacts'); await mkdir(cache, { recursive: true });
const folder = await mkdtemp(join(cache, 'agent-platform-ui-')); let components;
try { const path = join(folder, 'render.mjs'); await writeFile(path, compiled.outputFiles[0]!.text); components = await import(pathToFileURL(path).href); }
finally { await rm(folder, { recursive: true, force: true }); }

const recording: AgentRecordingRef = { id: 'ready-evidence', kind: 'deployment', runId: 'native-ready', complete: true, source: 'native' };
function agent(status: AgentStatus = 'unknown'): AgentView {
  return { id: 'neo', label: 'Neo triage agent', description: 'Registered local Neo agent', revisionId: 'sha256:full-agent-revision', revisionLabel: 'Local release', status,
    layers: [
      { id: 'infrastructure', label: 'Infrastructure', status: 'ready', detail: 'Two recorded resources', recording },
      { id: 'environment', label: 'Environment', status: 'unknown', detail: 'No environment verification recorded' },
      { id: 'agent', label: 'Agent', status: 'unknown', detail: 'Readiness not recorded' },
    ], resourceIds: ['program', 'service'], canCheck: true,
    capabilities: [{ id: 'conversationIsolation', label: 'Conversation isolation', status: 'unsupported' }], conversations: [], limitations: [] };
}
function view(item = agent()): AgentPlatformView { return { version: 1, id: 'neo-agents', label: 'Your agents', busy: false, agents: [item], limitations: [] }; }
const state = (): DashboardState => ({ revision: 1, busy: false, graph: null, mode: 'managed' });
const noop = () => {};
const render = (item = agent()) => renderToStaticMarkup(createElement(components.AgentWorkspace, { view: view(item), state: state(), posting: false, onCheck: noop, onRefresh: noop, onInfrastructure: noop }));

test('agent view uses the real catalog and keeps unmeasured layers unknown', () => {
  const html = render();
  assert.match(html, /Neo triage agent/); assert.match(html, /Infrastructure/); assert.match(html, /Environment/);
  assert.match(html, /data-status="unknown"/); assert.match(html, /Not confirmed/);
  assert.doesNotMatch(html, /Ready for conversations|Simulation|Demo agent|Build system/);
  assert.match(html, /No recorded conversations yet/);
});

test('native layer states drive building, ready and failure without hiding current uncertainty', () => {
  const building = agent('running'); building.layers = building.layers.map(layer => layer.id === 'environment' ? { ...layer, status: 'running' } : layer);
  const active = render(building); assert.match(active, /data-status="running"/); assert.match(active, /agents-glyph-active/);
  const ready = agent('ready'); ready.layers = ready.layers.map(layer => ({ ...layer, status: 'ready' }));
  assert.match(render(ready), /Ready for conversations/);
  const interrupted: AgentView = { ...ready, status: 'incomplete' };
  const unknown = render(interrupted); assert.match(unknown, /Result not confirmed/); assert.doesNotMatch(unknown, /Ready for conversations/);
  const failed: AgentView = { ...ready, status: 'failed' }; assert.match(render(failed), /Needs attention/);
});

test('agent catalog does not invent a conversation or turn for a deployed agent', () => {
  const ready = agent('ready'); ready.layers = ready.layers.map(layer => ({ ...layer, status: 'ready' }));
  const html = render(ready);
  assert.match(html, /No recorded conversations yet/);
  assert.doesNotMatch(html, /Conversation 1|Turn 1|Alice|Bob|Running a turn/);
  assert.match(html, /Native FootPrint/);
});

test('a malformed agent selection falls back to an admitted real catalog entry', () => {
  const html = renderToStaticMarkup(createElement(components.AgentWorkspace, { view: view(), selectedAgentId: 'unregistered-agent', state: state(), posting: false, onCheck: noop, onRefresh: noop, onInfrastructure: noop }));
  assert.match(html, /Neo triage agent/); assert.doesNotMatch(html, /unregistered-agent/);
});

test('a native reference cannot open a foreign or different-kind dashboard recording', () => {
  const graph = compileGraph({ name: 'neo', resources: [{ id: 'program', provider: 'fixture', spec: {} }], boundaries: [], memberships: [], relations: [] });
  const raw = { snapshot: { runId: 'different-native-runtime-id' }, structure: {}, provenance: { runId: recording.runId, graphDigest: graph.digest, stack: graph.name } };
  const dashboard: DashboardState = { ...state(), graph, run: { id: recording.runId, status: 'passed', resources: [], events: [], recording: raw } };
  assert.equal(deploymentRecording(dashboard, recording), raw);
  assert.equal(deploymentRecording(dashboard, { ...recording, kind: 'turn' }), undefined);
  assert.equal(deploymentRecording(dashboard, { ...recording, runId: 'another-native-run' }), undefined);
  const changed = { ...raw, provenance: { ...raw.provenance, runId: 'another-domain-run' } };
  assert.equal(deploymentRecording({ ...dashboard, run: { ...dashboard.run!, recording: changed } }, recording), undefined);
  for (const provenance of [undefined, { ...raw.provenance, graphDigest: 'foreign-graph' }, { ...raw.provenance, stack: 'foreign-stack' }]) {
    const unscoped = { ...raw, snapshot: { runId: recording.runId }, provenance };
    assert.equal(deploymentRecording({ ...dashboard, run: { ...dashboard.run!, recording: unscoped } }, recording), undefined);
  }
});

test('actual turn stages retain their recorded identity without inheriting the latest declared revision', () => {
  const item: AgentView = { ...agent('ready'), conversations: [{ id: 'owned-conversation', label: 'Observed conversation', status: 'running', turns: [
    { id: 'actual-native-turn', label: 'Recorded tool activity', status: 'running', recording: { ...recording, id: 'turn-proof', kind: 'turn', runId: 'actual-native-turn', complete: false },
      stages: [{ id: 'inspect', label: 'Inspect request', status: 'ready', kind: 'stage', sequence: 1, runtimeStageId: 'inspect#0' },
        { id: 'tool', label: 'Read configured tool', status: 'running', kind: 'tool', sequence: 2, runtimeStageId: 'tool#1' }] },
  ] }] };
  const html = render(item); assert.match(html, /1 recorded conversation/); assert.match(html, /Recorded tool activity/);
  assert.doesNotMatch(html, /Alice|Bob|Conversation 1/);
  const row = recordedTurnRows(item)[0]!; assert.equal(row.revisionId, undefined);
  const details = renderToStaticMarkup(createElement(components.ConversationDetails, { agent: item, row }));
  assert.match(details, /Not supplied by this recording/); assert.match(details, /actual-native-turn/); assert.match(details, /tool#1/); assert.match(details, /Tool call/); assert.match(details, /Incomplete/);
  assert.doesNotMatch(details, /sha256:full-agent-revision/);
});

test('a bounded turn list preserves admitted order without claiming an unrecorded global chronology', () => {
  const item: AgentView = { ...agent(), conversations: [{ id: 'owned-conversation', label: 'Recorded conversation', status: 'ready',
    turns: Array.from({ length: 6 }, (_, index) => ({ id: `native-turn-${index}`, label: `Admitted turn ${index}`, status: 'ready' as const, stages: [] })),
  }] };
  const html = render(item);
  assert.match(html, /Showing 5 of 6 admitted turns/); assert.doesNotMatch(html, /latest|Admitted turn 5/);
  assert.ok(html.indexOf('Admitted turn 0') < html.indexOf('Admitted turn 4'));
});

test('environment drilldown displays only supplied native stages and leaves missing observations explicit', () => {
  const layer: AgentLayerView = { id: 'environment', label: 'Execution environment', status: 'running',
    recording: { ...recording, kind: 'readiness', complete: false },
    stages: [{ id: 'acquire', label: 'Find environment', status: 'ready', runtimeStageId: 'acquire#0', sequence: 1 },
      { id: 'connect', label: 'Connect', status: 'running', runtimeStageId: 'connect#2', sequence: 2 },
      { id: 'verify', label: 'Verify', status: 'pending' }],
  };
  const html = renderToStaticMarkup(createElement(components.LayerDetails, { agent: agent(), layer, state: state() }));
  assert.match(html, /Find environment/); assert.match(html, /Connect/); assert.match(html, /Verify/);
  assert.match(html, /data-status="running"/); assert.match(html, /data-status="pending"/); assert.match(html, /connect#2/); assert.match(html, /Incomplete/);
  assert.doesNotMatch(html, /Create environment|Sequence 3|Snapshot restored/);
  const absent = renderToStaticMarkup(createElement(components.LayerDetails, { agent: agent(), layer: { ...layer, stages: undefined }, state: state() }));
  assert.match(absent, /No native stage observations were supplied for this layer/);
  assert.doesNotMatch(absent, /Find environment|connect#2|Snapshot restored/);
});
