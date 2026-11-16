import {flowChart} from 'footprintjs';
import type {DeploymentChart} from 'footprintjs-iac/progress';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileGraph } from 'footprintjs-iac/graph';
import { defineSystemTopology, projectSystemTopology } from 'footprintjs-iac/system-topology/node';
import { ONBOARDING_STAGE_IDS, ONBOARDING_STAGE_LABELS } from 'footprintjs-iac/onboarding';
import { readDashboardState } from '../src/core/client.ts';
import { readApplicationPublication } from '../src/server/application-publication.ts';
import { readOnboardingPublicationState } from '../src/server/onboarding-publication.ts';
import { versionComposition } from './helpers/onboarding-versions.ts';
import type { OnboardingSnapshot } from '../src/core/onboarding.ts';
import type { DashboardState } from '../src/core/types.ts';

const graph = compileGraph({ name: 'placement-test', boundaries: [], memberships: [], relations: [], resources: [{ id: 'services', provider: 'systemd', spec: { kind: 'SystemdServiceGroup' } }] });
function topology(configurationDigest = 'c'.repeat(64), targetId = 'office') {
  const definition = defineSystemTopology({ id: 'app-placement', label: 'Application placement', boundaries: [{ id: 'host', label: 'Office server', kind: 'server' }], nodes: [{ id: 'api', label: 'Application', category: 'compute', origin: 'deployment', boundaryId: 'host', technology: { id: 'nodejs', label: 'Node.js' }, bindings: { resourceIds: ['services'] } }], connections: [] }, { targetId, graphDigest: graph.digest });
  return projectSystemTopology(definition, { targetId, graphDigest: graph.digest, definitionDigest: definition.digest, configurationDigest, resources: [], components: [], checks: [] });
}
function onboarding(): OnboardingSnapshot { return { id: 'app', label: 'Application', strategyId: 'systemd', targetId: 'office', configurationDigest: 'c'.repeat(64), status: 'idle', busy: false, stages: ONBOARDING_STAGE_IDS.map(id => ({ id, label: ONBOARDING_STAGE_LABELS[id], status: 'pending' })), checks: [], canDiscover: true, canConfigure: false, canVerify: false, canReview: false, canDeploy: false, canReconcile: false }; }

test('a declared topology is admitted before the physical graph and binds to exact current target and configuration', () => {
  const state: DashboardState = { revision: 0, busy: false, graph: null, target: { id: 'office' }, onboarding: onboarding(), systemTopology: topology() };
  assert.equal(readDashboardState(state).systemTopology?.nodes[0]?.status, 'pending');
  assert.doesNotThrow(() => readApplicationPublication({ systemTopology: topology() }, state));
  assert.doesNotThrow(() => readApplicationPublication({ systemTopology: topology(), graph }, state));
  assert.throws(() => readDashboardState({ ...state, systemTopology: topology('d'.repeat(64)) }), /configuration/);
  assert.throws(() => readDashboardState({ ...state, systemTopology: topology('c'.repeat(64), 'other') }), /target/);
  assert.throws(() => readApplicationPublication({ target: { id: 'other' }, systemTopology: topology() }), /target/);
  const differentGraph = compileGraph({ name: 'another-graph', boundaries: [], memberships: [], relations: [], resources: [] });
  assert.throws(() => readDashboardState({ ...state, graph: differentGraph }), /resource graph/);
});
test('server admission rejects changed declaration digests and hand-painted ready states', () => {
  const alteredDefinition = structuredClone(topology()); alteredDefinition.definition.nodes[0]!.label = 'Changed outside its sealed definition';
  assert.throws(() => readApplicationPublication({ systemTopology: alteredDefinition }));
  const forgedStatus = structuredClone(topology()); forgedStatus.nodes[0]!.status = 'ready'; forgedStatus.nodes[0]!.statusLabel = 'Ready';
  assert.throws(() => readApplicationPublication({ systemTopology: forgedStatus }));
  assert.throws(() => readDashboardState({ revision: 0, busy: false, graph, systemTopology: forgedStatus }));
});
test('bounded topology protocol rejects unexpected credentials and external icon data', () => {
  for (const patch of [{ password: 'private' }, { iconUrl: 'https://untrusted.invalid/logo.svg' }]) {
    const view = structuredClone(topology()); Object.assign(view.definition.nodes[0]!, patch);
    assert.throws(() => readApplicationPublication({ systemTopology: view }));
  }
});
test('configuration activation clears the old graph until the current definition republishes pending observations', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lens-topology-version-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const { registry } = versionComposition(directory), initial = await registry.snapshot();
  const view = topology(initial.active.configurationDigest, initial.active.targetId);
  const before = readOnboardingPublicationState({ revision: 1, busy: false, graph: null }, { view: initial.active, registry: initial, publication: { graph, systemTopology: view } });
  assert.equal(before.systemTopology?.definition.digest, view.definition.digest);
  const review = await registry.dispatch({ action: 'review-version', versionId: 'v2' });
  const activated = await registry.dispatch({ action: 'activate-version', reviewId: review.review!.reviewId });
  const after = readOnboardingPublicationState(before, { view: activated.active, registry: activated });
  assert.equal(after.graph, null); assert.equal(after.systemTopology, undefined);
  assert.throws(() => readOnboardingPublicationState(after, { view: activated.active, registry: activated, publication: { systemTopology: view } }), /configuration/);
  const fresh = topology(activated.active.configurationDigest, activated.active.targetId);
  const pending = readOnboardingPublicationState(after, { view: activated.active, registry: activated, publication: { systemTopology: fresh } });
  assert.equal(pending.systemTopology?.observations.configurationDigest, activated.active.configurationDigest);
  assert.equal(pending.systemTopology?.nodes[0]?.status, 'pending'); assert.equal(pending.graph, null);
});

test('topology resource bindings must refer to the current graph once it is published', () => {
  const definition = defineSystemTopology({ id: 'unknown-resource', label: 'Unknown resource', boundaries: [{ id: 'host', label: 'Server', kind: 'server', bindings: { resourceIds: ['absent'] } }], nodes: [{ id: 'api', label: 'API', category: 'compute', origin: 'deployment', boundaryId: 'host', bindings: { resourceIds: ['absent'] } }], connections: [] }, { targetId: 'office', graphDigest: graph.digest });
  const view = projectSystemTopology(definition, { targetId: 'office', graphDigest: graph.digest, definitionDigest: definition.digest, configurationDigest: 'c'.repeat(64), resources: [], components: [], checks: [] });
  assert.doesNotThrow(() => readDashboardState({ revision: 0, busy: false, graph: null, systemTopology: view }));
  assert.throws(() => readDashboardState({ revision: 0, busy: false, graph, systemTopology: view }), /resource binding/);
  assert.throws(() => readApplicationPublication({ graph, systemTopology: view }), /resource binding/);
});

test('terminal incomplete publication replaces current live actions and withdraws the stopped run capture without changing configuration',()=>{
 const original=onboarding(),definition=defineSystemTopology({id:'terminal-system',label:'Existing application',boundaries:[],connections:[],nodes:[{id:'api',label:'Application',category:'compute',origin:'existing',bindings:{resourceIds:['services'],componentIds:['api-unit']}}]},{targetId:original.targetId,graphDigest:graph.digest});
 const action={resourceId:'services',phase:'start' as const,status:'running' as const,evidence:{kind:'adapter' as const,runId:'native-current',runtimeStageId:'execute-services/provider/start#1',complete:false}};
 const observations={...definition.binding,definitionDigest:definition.digest,configurationDigest:original.configurationDigest,resources:[],components:[],checks:[],actions:[action]};
 const native=flowChart('Load',()=>{},'load').addDeciderFunction('Resource gate',()=> 'execute-services','gate-services').addFunctionBranch('execute-services','Reconcile services',()=>{}).addFunctionBranch('skip-services','Skip services',()=>{}).end().build();
 const chart:DeploymentChart={version:1,runId:'deployment-current',stack:graph.name,graphDigest:graph.digest,structure:native.buildTimeStructure,resources:[{resourceId:'services',action:'update',batchIndex:0,gateStageId:'gate-services',executeStageId:'execute-services',skipStageId:'skip-services'}]};
 const recording={snapshot:{runId:'native-current'},structure:native.buildTimeStructure,provenance:{runId:'deployment-current',stack:graph.name,graphDigest:graph.digest}};
 const live:DashboardState={revision:1,busy:true,graph,target:{id:original.targetId},onboarding:{...original,status:'reviewed',busy:true,canDiscover:false,stages:original.stages.map(stage=>({...stage,status:stage.id==='deploy'?'running':'passed'}))},systemTopology:projectSystemTopology(definition,observations),run:{id:'deployment-current',status:'running',resources:[{id:'services',status:'deploying'}],events:[],chart,recording},recording,neoUrl:'http://127.0.0.1:55330',appAccess:{status:'ready'}};
 const incomplete:OnboardingSnapshot={...original,status:'incomplete',busy:false,canDiscover:false,stages:original.stages.map(stage=>({...stage,status:stage.id==='deploy'?'unknown':'passed'})),deployment:{ok:false,promoted:false,status:'incomplete'}};
 const terminal=readOnboardingPublicationState(live,{view:incomplete,publication:{graph,target:{id:original.targetId},recording:undefined,systemTopology:projectSystemTopology(definition,{...observations,actions:[{...action,status:'unknown'}]}),run:{id:'deployment-current',status:'failed',resources:[{id:'services',status:'pending'}],events:[],report:{outcome:'unconfirmed'}}}});
 assert.equal(terminal.busy,false);assert.equal(terminal.onboarding?.status,'incomplete');assert.equal(terminal.onboarding?.configurationDigest,original.configurationDigest);assert.equal(terminal.target?.id,original.targetId);
 assert.equal(terminal.run?.status,'failed');assert.equal(terminal.run?.recording,undefined);assert.equal(terminal.run?.chart,undefined);assert.equal(terminal.recording,undefined);assert.equal(terminal.neoUrl,undefined);assert.equal(terminal.appAccess,undefined);
 const node=terminal.systemTopology!.nodes[0]!;assert.equal(node.originLabel,'Existing');assert.equal(node.progress.completed,0);assert.equal(node.facts.running,'unknown');assert(node.actions?.every(row=>row.status==='unknown'&&!row.evidence.complete));
 assert.equal(terminal.systemTopology!.definition.digest,live.systemTopology!.definition.digest,'withdrawal does not invent a new system declaration');
});
