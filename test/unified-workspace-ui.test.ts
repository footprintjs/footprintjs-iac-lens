import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import test from 'node:test';
import { compileGraph } from 'footprintjs-iac/graph';
import type { InfraGraph } from 'footprintjs-iac';
import type { DashboardRun, DashboardState } from '../src/core/types.ts';
import type { ResourceFlowState } from '../src/core/resource-flow.ts';
import { projectRevisionReview } from '../src/core/revision-review.ts';
import { queryRecordedDependencies } from 'footprintjs-iac/diagnostics/recorded';
import type { RecordedDiagnostics } from '../src/core/recorded-diagnostics.ts';

const compiled = await build({ stdin: { contents: `export { SimpleDashboard } from './web/components/SimpleDashboard.tsx';
export { DetailsWorkspace } from './web/components/DetailsWorkspace.tsx';
export { EvidenceSource } from './web/components/EvidenceSource.tsx';
export { RevisionDetails } from './web/components/ChangeReview.tsx';
export { default as EvidenceView } from './web/components/EvidenceView.tsx';
export { RecordedTraceHistory } from './web/components/RecordedTraceButton.tsx';
export { RecordedDependencyPanel } from './web/components/RecordedDependencyPanel.tsx';
export { DeploymentStep } from './web/components/DeploymentStep.tsx';
export { buildDeploymentFlowView } from './web/lib/deployment-flow-view.ts';`,
  resolveDir: import.meta.dirname + '/..', sourcefile: 'ui-render-fixture.ts', loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent' });
const cache = join(import.meta.dirname, '../.artifacts'); await mkdir(cache, { recursive: true });
const directory = await mkdtemp(join(cache, 'ui-render-'));
let components;
try {
  const file = join(directory, 'render.mjs'); await writeFile(file, compiled.outputFiles[0]!.text);
  components = await import(pathToFileURL(file).href);
} finally { await rm(directory, { recursive: true, force: true }); }
const { SimpleDashboard, DetailsWorkspace, EvidenceSource, DeploymentStep, buildDeploymentFlowView, RevisionDetails, EvidenceView, RecordedTraceHistory, RecordedDependencyPanel } = components;
const noop = () => {};

/** Rendering fixtures exercise composition; native reconciliation is tested in the host suites. */
function fixture(status: 'idle' | 'paused' | 'passed' = 'passed', mode: 'create' | 'existing' = 'create'): DashboardState {
  const graph = compileGraph({ name: 'unified-workspace', boundaries: [], memberships: [], resources: [
    { id: 'identity-directory', provider: 'fixture', spec: { role: 'directory' } },
    { id: 'identity-provider', provider: 'fixture', spec: { role: 'provider' }, dependsOn: ['identity-directory'] },
    { id: 'neo-namespace', provider: 'fixture', spec: { kind: 'Namespace' } },
    { id: 'neo-access-policy', provider: 'fixture', spec: { kind: 'ConfigMap' }, dependsOn: ['neo-namespace'] },
    { id: 'neo-app', provider: 'fixture', spec: { kind: 'Deployment' }, dependsOn: ['neo-access-policy', 'identity-provider'] },
    { id: 'neo-service', provider: 'fixture', spec: { kind: 'Service' }, dependsOn: ['neo-app'] },
  ], relations: [
    { from: 'identity-provider', to: 'identity-directory', kind: 'communicatesWith' },
    { from: 'neo-app', to: 'identity-provider', kind: 'communicatesWith' },
    { from: 'neo-service', to: 'neo-app', kind: 'communicatesWith' },
  ] });
  const executionId = status === 'idle' ? null : 'render-execution';
  const stageIds = ['acquire', 'details', 'connect', 'verify'] as const;
  const parent: ResourceFlowState = { version: 1, kind: 'resource-flow-state', id: 'connect-storage', resourceId: 'identity-provider',
    label: 'Application identity', mode, target: { id: 'ui-target', scope: 'ui-scope' }, definitionDigest: 'a'.repeat(64), configurationDigest: 'c'.repeat(64),
    executionId, status, stages: stageIds.map((id, index) => ({ id, label: [mode === 'create' ? 'Create resource' : 'Find existing resource', 'Connection details', 'Connect application', 'Verify connection and access'][index]!,
      status: status === 'idle' ? 'pending' : status === 'passed' || index === 0 ? 'passed' : index === 1 ? 'waiting' : 'pending' })),
    events: status === 'idle' ? [] : stageIds.flatMap((stageId, index) => status === 'paused' && index > 1 ? [] : [
      { sequence: index * 2 + 1, executionId: executionId!, stageId, status: 'running' as const, timestamp: 1000 + index, runtimeStageId: stageId + '#0' },
      { sequence: index * 2 + 2, executionId: executionId!, stageId, status: status === 'paused' && index === 1 ? 'waiting' as const : 'passed' as const, timestamp: 1100 + index, runtimeStageId: stageId + '#0' },
    ]), segments: status === 'idle' ? [] : [{ runId: 'parent-native', evidencePath: '/owned/parent.json', tracePath: '/owned/parent.jsonl', status }],
    ...(status !== 'idle' ? { resource: { id: 'identity-provider', kind: 'identity', physicalId: 'provider-42', scope: 'ui-scope' } } : {}),
    ...(status === 'paused' ? { pause: { token: 'b'.repeat(64), prompt: 'Choose a connection profile', profiles: [{ id: 'approved', label: 'Approved identity' }] } } : {}),
    ...(status === 'passed' ? { details: { resourceId: 'identity-provider', profileId: 'approved', protocol: 'oidc', endpoint: 'http://provider.internal/realm' },
      connection: { id: 'app-binding' }, verification: { ok: true, checks: [{ id: 'access', passed: true }] } } : {}),
  };
  const child = (phase: 'acquire' | 'connect', ids: string[]) => {
    const resources = graph.resources.filter(resource => ids.includes(resource.id)).map(resource => resource.dependsOn ? { ...resource, dependsOn: resource.dependsOn.filter(id => ids.includes(id)) } : resource);
    const childGraph: InfraGraph = compileGraph({ name: graph.name, resources, boundaries: [], memberships: [], relations: [] });
    const id = 'native-' + phase;
    const run: DashboardRun = { id, status: 'passed', mode: 'managed', resources: resources.map(resource => ({ id: resource.id, resourceId: resource.id, status: 'ready', action: 'create' })),
      events: resources.flatMap((resource, index) => ['pending', 'deploying', 'ready'].map((status, step) => ({ resourceId: resource.id, status: status as 'pending' | 'deploying' | 'ready',
        action: 'create', runId: id, sequence: index * 3 + step + 1, timestamp: 1200 + index * 3 + step, runtimeStageId: 'execute-' + resource.id + '#0' }))),
      recording: { snapshot: { runId: 'runtime-' + id }, structure: {}, provenance: { runId: id, stack: graph.name, graphDigest: childGraph.digest } } };
    return { phase, graph: childGraph, graphDigest: childGraph.digest, run, origin: 'evidence' as const };
  };
  const children = status === 'idle' ? [] : [
    ...(mode === 'create' ? [child('acquire', ['identity-directory', 'identity-provider'])] : []),
    ...(status === 'passed' ? [child('connect', ['neo-namespace', 'neo-access-policy', 'neo-app', 'neo-service'])] : []),
  ];
  const connections: NonNullable<DashboardState['connections']> = { id: status === 'passed' ? 'connection-run' : '', status: status === 'passed' ? 'passed' : 'idle', events: [],
    checks: graph.relations.flatMap((relation, index) => relation.kind !== 'communicatesWith' ? [] : [{ connectionId: 'communication:' + index, from: relation.from, to: relation.to,
      status: status === 'passed' ? 'connected' as const : 'untested' as const }]) };
  const identity: NonNullable<DashboardState['identity']> = { id: status === 'passed' ? 'access-run' : '', label: 'Sign-in and access', status: status === 'passed' ? 'passed' : 'idle', events: [], checks:
    ['directory', 'reader-login', 'wrong-password', 'anonymous', 'reader-access', 'guest-access', 'forged-token'].map(checkId => ({ checkId, label: checkId, kind: 'access',
      expected: 'denied', status: status === 'passed' ? 'passed' : 'untested', ...(status === 'passed' ? { observation: { verdict: 'denied', observedAt: 2000, latencyMs: 1 } } : {}) })) };
  return { revision: 1, graph, mode: 'managed', busy: false, resourceFlow: parent,
    systemView: { blocks: [{ id: 'identity', label: 'Identity', family: 'identity', units: [
      { id: 'directory', label: 'Directory', resourceIds: ['identity-directory'] },
      { id: 'provider', label: 'Sign-in provider', resourceIds: ['identity-provider'] },
      { id: 'policy', label: 'Permission policy configuration', resourceIds: ['neo-access-policy', 'neo-app'] },
    ] }] },
    target: { id: 'ui-target', label: 'Application system' }, run: children.at(-1)?.run, connections, identity,
    connectionReviewAvailable: true, identityReviewAvailable: true,
    resourceFlowWorkspace: { flowId: parent.id, executionId, definitionDigest: parent.definitionDigest, targetId: parent.target.id, graphDigest: graph.digest, sequence: 1, children,
      ...(status !== 'idle' && mode === 'existing' ? { found: ['identity-directory', 'identity-provider'].map(resourceId => ({ resourceId, physicalId: resourceId + '-existing', timestamp: 1000, parentRunId: 'parent-native', runtimeStageId: 'acquire#0' })) } : {}) },
    artifacts: [{ id: 'saved', path: 'evidence.json', mediaType: 'application/json', content: '{}' }] };
}

function simple(state: DashboardState) {
  return renderToStaticMarkup(createElement(SimpleDashboard!, { state, posting: false, onRun: noop, onResourceFlow: noop, onDismissError: noop, onDetails: noop }));
}
function details(state: DashboardState, view = 'deployment', evidenceKind = 'deployment') {
  return renderToStaticMarkup(createElement(DetailsWorkspace!, { state, posting: false, fitWindow: true, view, evidenceKind, setView: noop, selectResource: noop,
    selectConnection: noop, setEvidenceKind: noop, selectActivity: noop, run: noop, resourceFlow: noop, dismissError: noop }));
}

test('Simple composes four workflow tasks with all six resources, live edges and access summaries', () => {
  const html = simple(fixture());
  assert.match(html, /Resource workflow orchestration/); assert.match(html, /Native workflow stages/);
  assert.match(html, /Your system being built/); assert.match(html, /Build flow and live connections/);
  for (const label of ['Directory', 'Sign-in', 'Space', 'Access', 'Program', 'Network']) assert.match(html, new RegExp(label + ': Ready'));
  assert.match(html, /3\/3 passed/); assert.match(html, /7\/7 passed/);
  assert.doesNotMatch(html, />Build system</); assert.doesNotMatch(html, /Run simulation|Deploy system|Reapply/);
  const failed = fixture();
  failed.connections!.status = 'failed';
  failed.connections!.checks = failed.connections!.checks.map((check, index) => index < 2 ? { ...check, status: 'failed' } : check);
  assert.match(simple(failed), /Connection failed/);
  for (const degradedHtml of [simple(failed), details(failed)]) {
    assert.match(degradedHtml, /Workflow complete/);
    assert.doesNotMatch(degradedHtml, /Connected and verified/);
    assert.match(degradedHtml, /Verify connection and access: Verified/);
  }
});

test('one workflow Start and human Continue preserve the resource canvas and disable pre-verification rechecks', () => {
  const idleHtml = simple(fixture('idle'));
  assert.equal((idleHtml.match(/>Start workflow</g) ?? []).length, 1);
  assert.match(idleHtml, /Your system being built/); assert.doesNotMatch(idleHtml, />Build system</);
  const pausedHtml = simple(fixture('paused'));
  assert.match(pausedHtml, /Connection details needed/); assert.match(pausedHtml, /Approved identity/); assert.match(pausedHtml, />Continue</);
  assert.match(pausedHtml, /Your system being built/); assert.match(pausedHtml, /Directory: Ready/); assert.match(pausedHtml, /Program: Waiting/);
  assert.match(pausedHtml, /aria-label="Check connections" disabled/); assert.match(pausedHtml, /aria-label="Check sign-in and access" disabled/);
});

test('Find displays observed sources as Found while keeping consumer resources and communication edges', () => {
  const html = simple(fixture('passed', 'existing'));
  assert.match(html, /Find existing resource: Found/); assert.match(html, /Directory: Found/); assert.match(html, /Sign-in: Found/);
  assert.match(html, /Program: Ready/); assert.match(html, /connected: Program to Sign-in/);
  assert.doesNotMatch(html, /Directory: Building|Sign-in: Building/);
  assert.match(simple(fixture('idle', 'existing')), /Ready to connect/);
  const { nodes } = buildDeploymentFlowView(fixture('passed', 'existing'));
  for (const node of nodes.filter((node: { id: string }) => ['identity-directory', 'identity-provider'].includes(node.id))) {
    assert.match(node.ariaLabel, /Found by read-only lookup/);
    const step = renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(DeploymentStep!, { data: node.data })));
    assert.match(step, /READ-ONLY LOOKUP/); assert.match(step, />Found</);
    assert.doesNotMatch(step, /NOT STARTED|Resource operation|RECORDED START/);
  }
});

test('Details retains deployment, running-system, evidence and artifacts workspace alongside orchestration', () => {
  const state = fixture();
  for (const view of ['deployment', 'system', 'artifacts']) {
    const html = details(state, view);
    for (const label of ['Deployment flow', 'Running system', 'Execution evidence', 'Output artifacts']) assert.ok(html.includes(label), label);
    assert.match(html, /Resource workflow orchestration/); assert.match(html, /Connections/); assert.match(html, /Access checks/);
    assert.doesNotMatch(html, /Run simulation|Deploy system|Reapply \/ check no-op/);
  }
  const evidence = renderToStaticMarkup(createElement(EvidenceSource!, { state, kind: 'deployment', onKind: noop }));
  assert.match(evidence, /Workflow orchestration/); assert.match(evidence, /Acquire · 2 resources/); assert.match(evidence, /Connect · 4 resources/);
});

test('workflow mode retains supplied version history without exposing competing review/apply controls', () => {
  const state = fixture();
  state.revisionReview = { status: 'ready', current: { id: 'v1', digest: 'd'.repeat(64), graphDigest: state.graph!.digest },
    candidate: { id: 'v2', digest: 'e'.repeat(64), graphDigest: state.graph!.digest }, reviewId: 'f'.repeat(64), canApply: true,
    resources: state.graph!.resources.map(resource => ({ resourceId: resource.id, action: 'noop', change: 'unchanged' })) };
  for (const html of [simple(state), details(state)]) {
    assert.match(html, /Version and changes/); assert.match(html, />Inspect history</);
    assert.doesNotMatch(html, />Review changes<|>Apply update<|>Check version</);
  }
  state.revisionReview.resources = [];
  const view = projectRevisionReview(state)!;
  const recorded = renderToStaticMarkup(createElement(RevisionDetails!, { view, readOnly: true }));
  assert.match(recorded, /This recorded version is shown for reference/);
  assert.match(recorded, /Full master history is available in Output artifacts/);
  assert.match(recorded, /No resource diff is attached to this recorded version/);
  assert.doesNotMatch(recorded, /Review changes to load the current deployment plan/);
  const editable = renderToStaticMarkup(createElement(RevisionDetails!, { view, readOnly: false }));
  assert.match(editable, /Review changes to load the current deployment plan/);
});

test('new provenance uses the public presentation view without exposing the legacy causal resolver, while serial evidence retains it', () => {
  const snapshot = { runId: 'recorded-run', sharedState: { config: { region: 'west', tier: 'standard' } },
    executionTree: { id: 'seed', runtimeStageId: 'seed#0', name: 'Seed', logs: {}, errors: {}, metrics: {}, evals: {},
      next: { id: 'add-config', runtimeStageId: 'add-config#1', name: 'AddConfig', logs: {}, errors: {}, metrics: {}, evals: {} } },
    commitLog: [{ idx: 0, stage: 'Seed', stageId: 'seed', runtimeStageId: 'seed#0', trace: [{ path: 'config', verb: 'set' }], overwrite: { config: { region: 'west' } }, updates: {} },
      { idx: 1, stage: 'AddConfig', stageId: 'add-config', runtimeStageId: 'add-config#1', trace: [{ path: 'config', verb: 'merge' }], overwrite: {}, updates: { config: { tier: 'standard' } } }],
  };
  const recording = { snapshot, structure: { id: 'seed', name: 'Seed', type: 'stage', next: { id: 'add-config', name: 'AddConfig', type: 'stage' } } };
  const before = JSON.stringify(recording);
  const limited = renderToStaticMarkup(createElement(EvidenceView!, { recording, running: false }));
  assert.match(limited, /data-evidence-mode="state-timeline"/); assert.match(limited, /data-fp="explainable-view"/);
  assert.match(limited, /data-fp="value-inspector"/); assert.match(limited, /Updated recorded dependency reader/);
  assert.match(limited, /2 recorded steps/); assert.match(limited, /partial update/);
  assert.doesNotMatch(limited, /Data Trace|Backward causal chain|reads were not recorded/); assert.equal(JSON.stringify(recording), before);
  const serial = structuredClone(recording); serial.snapshot.commitLog[1]!.trace[0]!.verb = 'set'; serial.snapshot.commitLog[1]!.updates = {};
  const complete = renderToStaticMarkup(createElement(EvidenceView!, { recording: serial, running: false }));
  assert.match(complete, /data-evidence-mode="full"/); assert.doesNotMatch(complete, /Updated recorded dependency reader/);
});

test('Simple offers recorded failure explanations, retains recovery selection and separate native action evidence', () => {
  const state = fixture(), snapshot = { runId: 'failed-runtime', commitLog: [{ idx: 0, stage: 'Check service', stageId: 'check', runtimeStageId: 'check#0', trace: [{ path: 'progress:check', verb: 'set' }], overwrite: { 'progress:check': 'private-body' }, updates: {} }],
    executionTree: { id: 'check', runtimeStageId: 'check#0', name: 'Check service' } };
  const report = queryRecordedDependencies({ snapshot }, 'progress:check');
  const history: RecordedDiagnostics = { version: 1, binding: 'a'.repeat(64), omitted: 0, limitations: ['Earlier diagnostic history could not be read; native recordings remain authoritative.'], runs: [
    { id: 'failed', runId: 'failed-domain', runtimeRunId: snapshot.runId, kind: 'connections', label: 'Connections', outcome: 'failed', sequence: 1, limitations: [],
      targets: [{ id: 'check', key: report.key, label: 'Program → Sign-in', outcome: 'failed', facts: [{ code: 'http-status', value: 503 }, { code: 'reason', value: 'federated-login-failed' }, { code: 'reason', value: 'jwks-probe-failed' }], trace: report }] },
    { id: 'recovered', runId: 'recovered-domain', runtimeRunId: 'recovered-runtime', kind: 'connections', label: 'Connections', outcome: 'passed', sequence: 2, limitations: [], targets: [] },
  ] };
  state.recordedDiagnostics = history; state.connections!.status = 'failed';
  const html = simple(state); assert.match(html, /Why did this fail\?/);
  const explanation = renderToStaticMarkup(createElement(RecordedTraceHistory!, { history, initialRunId: 'failed' }));
  assert.match(explanation, /Connections · Failed · run 1/); assert.match(explanation, /Connections · Passed · run 2/);
  assert.match(explanation, /Program → Sign-in/); assert.match(explanation, /HTTP 503/); assert.match(explanation, /Recorded commit order/);
  assert.match(explanation, /Federated sign-in check failed/); assert.match(explanation, /Signing-key check failed/); assert.doesNotMatch(explanation, /unreachable/);
  assert.match(explanation, /Earlier diagnostic history could not be read/); assert.doesNotMatch(explanation, /private-body/);
  const unreadable = { ...history, runs: [] }; state.recordedDiagnostics = unreadable;
  assert.match(simple(state), /History needs attention/);
  assert.match(renderToStaticMarkup(createElement(RecordedTraceHistory!, { history: unreadable })), /Earlier diagnostic history could not be read/);
  state.recordedDiagnostics = history;
  state.connections!.status = 'passed'; assert.match(simple(state), />Trace back</);
  state.hostActions = { busy: false, controls: [{ id: 'pause-service', label: 'Pause service' }], history: [{ invocationId: 'action-one', actionId: 'pause-service', label: 'Pause service', status: 'passed', startedAt: 0, finishedAt: 1,
    receipt: { ok: true, runId: 'native-action', recording: { snapshot, structure: {} } } }] };
  const evidence = renderToStaticMarkup(createElement(EvidenceSource!, { state, kind: 'action', onKind: noop }));
  assert.match(evidence, /Configured actions/); assert.match(evidence, /native-action/);
  assert.match(evidence, /no dependency across runs is inferred/); assert.doesNotMatch(evidence, /Acquire · 2 resources/);
});

test('the updated explanation presents real temporal uncertainty, data and decision edges and query limits honestly', async () => {
  const require = createRequire(new URL('../../footprint-iac/package.json', import.meta.url));
  const { EventLog, RecordFrame, SharedMemory } = await import(pathToFileURL(require.resolve('foottrace/write')).href);
  const state = new SharedMemory(), log = new EventLog({});
  const frame = () => { const frame = new RecordFrame(state, log); frame.useEncoding({ commitValues: 'full', writeProvenance: 'reads-prefix' }); return frame; };
  const finish = (frame: any, id: string) => { frame.commit(() => ({ stage: id, stageId: id, runtimeStageId: id + '#0' })); frame.release(); };
  const seed = frame(); seed.write(['value'], 'private-value', 'set'); finish(seed,'seed');
  const reader = frame(), value = reader.read([], 'value'); reader.noteRead([], 'value');
  const sibling = frame(); sibling.write(['value'], 'new-private-value', 'set'); sibling.write(['late'], true, 'set'); finish(sibling,'sibling');
  reader.read([], 'late'); reader.noteRead([], 'late'); reader.write(['result'], value, 'set'); finish(reader,'reader');
  const snapshot = { runId: 'parallel-native', writeProvenance: 'reads-prefix', commitLog: log.list(), executionTree: [
    { runtimeStageId: 'seed#0' }, { runtimeStageId: 'sibling#0' }, { runtimeStageId: 'reader#0', stageReads: { value, late: true } },
  ] };
  const report = queryRecordedDependencies({ snapshot }, 'result');
  assert.ok(report.summary.possibleSourceEdges > 0);
  const html = renderToStaticMarkup(createElement(RecordedDependencyPanel!, { report, technical: true }));
  assert.match(html, /possible source/); assert.match(html, /Data from step/); assert.match(html, /Evidence limits/);
  assert.match(html, /Parallel work can start or read in a different order/); assert.match(html, /Control dependencies were not supplied/);
  assert.doesNotMatch(html, /private-value/);
  const limited = queryRecordedDependencies({ snapshot }, 'result', { maxNodes: 1 });
  assert.match(renderToStaticMarkup(createElement(RecordedDependencyPanel!, { report: limited })), /query reached a recording limit/);
});

test('Simple names only the exact selected subject and groups equivalent links while Details retains native edges', () => {
  const report = structuredClone(queryRecordedDependencies({ snapshot: { runId: 'subject-native', commitLog: [
    { stage: 'Seed', stageId: 'seed', runtimeStageId: 'seed#0', trace: [{ path: 'first', verb: 'set' }, { path: 'second', verb: 'set' }], overwrite: { first: 1, second: 2 }, updates: {} },
    { stage: 'Checking communication:1', stageId: 'check', runtimeStageId: 'check#0', trace: [{ path: 'result', verb: 'set' }], overwrite: { result: 3 }, updates: {} },
  ], executionTree: { runtimeStageId: 'seed#0', next: { runtimeStageId: 'check#0', stageReads: { first: 1, second: 2 } } } } }, 'result'));
  const edges = report.dependencies!.edges!; assert.equal(edges.length, 2);
  // Distinct evidence classes remain separate even when their source step matches.
  edges.push({ ...edges[0]!, kind: 'control' }, { ...edges[0]!, builtOn: 'partial-write' }, { ...edges[0]!, overlap: 'written-while-running' });
  Object.assign(report.summary, { dataEdges: 4, controlEdges: 1, partialWriteEdges: 1, possibleSourceEdges: 1 });
  const subject = { id: 'communication:1', label: 'Sign-in → Directory' }, before = JSON.stringify(report);
  const html = renderToStaticMarkup(createElement(RecordedDependencyPanel!, { report, subject }));
  assert.match(html, /Checking Sign-in → Directory/); assert.doesNotMatch(html, /Checking communication:1/);
  assert.match(html, /Data from step 1 ×2/); assert.match(html, /Decision from step 1/);
  assert.match(html, /Data from step 1 · partial update/); assert.match(html, /Data from step 1 · possible source/);
  const details = renderToStaticMarkup(createElement(RecordedDependencyPanel!, { report, subject, technical: true }));
  assert.match(details, /Checking communication:1/); assert.doesNotMatch(details, /×2/);
  assert.match(details, /first/); assert.match(details, /second/);
  report.dependencies!.nodes!['check#0']!.stageName = 'Checking communication:10';
  assert.match(renderToStaticMarkup(createElement(RecordedDependencyPanel!, { report, subject })), /Checking communication:10/);
  report.dependencies!.nodes!['check#0']!.stageName = 'Checking communication:1'; assert.equal(JSON.stringify(report), before);
});
