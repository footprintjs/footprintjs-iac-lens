import {hydrateNeoReleaseWatcher} from './hydration.ts';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createNeoReleaseAutomation} from 'footprintjs-iac/integration/identity/release-automation';
import {loadIdentityTarget} from 'footprintjs-iac/integration/identity';
import {createGitHubSourceAdapter} from 'footprintjs-iac/delivery/git';
import {loadPipelineRecording} from 'footprintjs-iac/pipeline/node';
import {loadReleaseAutomationRecording} from 'footprintjs-iac/release-automation/node';
import {loadReleaseBuildRecording} from 'footprintjs-iac/releases/node';
import type {ControllerOptions,DeliveryPublication} from '../../src/server/index.ts';
import type {Recording} from '../../src/core/types.ts';
import {neoIdentitySystemView} from '../neo-identity/system-view.ts';
import {neoDeliveryBaselineRun} from '../neo-github-delivery/projection.ts';
import {createNeoEnvironmentProjection} from '../neo-release-pipeline/environment-projection.ts';
import {neoReleaseWatcherCatalog} from './catalog.ts';
import type {NeoReleaseWatcherConfig} from './config.ts';

function recording(loaded:{snapshot:unknown;structure:unknown;controlDeps:unknown;narrativeEntries:unknown}):Recording{return{snapshot:loaded.snapshot,structure:loaded.structure,controlDeps:loaded.controlDeps as Record<string,unknown>,narrativeEntries:Array.isArray(loaded.narrativeEntries)?loaded.narrativeEntries:[]};}
export async function createNeoReleaseWatcherHost(config:NeoReleaseWatcherConfig){
  const catalog=neoReleaseWatcherCatalog(config);
  const consumer=await createNeoReleaseAutomation({...config,catalog,configurationDigest:createHash('sha256').update(JSON.stringify({version:1,catalog:'github-published-and-reviewed-pins',repository:config.repository,manualSources:config.manualSources})).digest('hex'),
    sourceAdapter(choice,context){return createGitHubSourceAdapter({directory:join(context.directory,'source-cache'),repository:config.repository,allowedRefs:[choice.source.ref]});}});
  const initial=consumer.initialConsumer;
  const environments=await Promise.all(config.environments.map(async environment=>({id:environment.id,label:environment.label,target:await loadIdentityTarget(environment.targetPath),baseline:initial.baselines[environment.id]!})));
  const hydrated=await hydrateNeoReleaseWatcher({state:await consumer.host.snapshot(),environments,directory:config.directory});
  const currentEnvironment=environments.find(environment=>environment.id===hydrated?.environmentId)??environments[0]!;
  const project=createNeoEnvironmentProjection(environments),listeners=new Set<(patch:DeliveryPublication)=>void>();let queue=Promise.resolve(),retained:DeliveryPublication=hydrated?.patch??{};
  consumer.subscribe(event=>{queue=queue.then(async()=>{const patch=await project(event);retained={...retained,...patch};for(const listener of listeners)listener(patch);}).catch(()=>{const patch:DeliveryPublication={appAccess:{status:'failed',message:'A recorded environment observation needs inspection.'}};retained={...retained,...patch};for(const listener of listeners)listener(patch);});});
  const nativeHost=consumer.host;
  const host={snapshot:nativeHost.snapshot.bind(nativeHost),subscribe:nativeHost.subscribe.bind(nativeHost),
    async refresh(){const state=await nativeHost.refresh();await queue;return state;},async tick(){const state=await nativeHost.tick();await queue;return state;},async start(releaseId:string){const state=await nativeHost.start(releaseId);await queue;return state;},
    async promote(...args:Parameters<typeof nativeHost.promote>){const state=await nativeHost.promote(...args);await queue;return state;},async recover(...args:Parameters<typeof nativeHost.recover>){const state=await nativeHost.recover(...args);await queue;return state;}};
  const run=await neoDeliveryBaselineRun(currentEnvironment.baseline);
  const options:ControllerOptions={directory:join(config.directory,'lens'),systemView:neoIdentitySystemView(currentEnvironment.target),
    initialReview:{graph:currentEnvironment.baseline.graph,run,target:{id:currentEnvironment.target.id,context:currentEnvironment.target.context,namespace:currentEnvironment.target.namespace,label:currentEnvironment.label},neoUrl:`http://127.0.0.1:${currentEnvironment.target.neoPort}/?test`},
    releaseAutomation:{host,stages:config.environments.map(({id,label,promotion,rollback})=>({id,label,promotion,rollback})),
      subscribePublication(listener){listeners.add(listener);if(Object.keys(retained).length)listener(retained);return()=>{listeners.delete(listener);};},
      async loadRecording(state,attemptId,stageId){
        const attempt=state.attempts.find(attempt=>attempt.id===attemptId);if(!attempt)return;
        if(stageId&&attempt.pipeline){const receipt=attempt.pipeline.recordings.findLast(receipt=>receipt.stageId===stageId);if(!receipt)return;return recording(await loadPipelineRecording(receipt.evidencePath,{runId:receipt.runId,definitionDigest:attempt.pipeline.definitionDigest,executionId:attempt.pipeline.executionId!,stageId}));}
        const receipt=attempt.recordings.at(-1);if(receipt)return recording(await loadReleaseAutomationRecording(receipt.evidencePath,{runId:receipt.runId,definitionDigest:state.definitionDigest,attemptId}));
        const build=attempt.preparation,buildReceipt=build?.recordings.at(-1);if(build&&buildReceipt)return recording(await loadReleaseBuildRecording(buildReceipt.evidencePath,buildReceipt.tracePath,{runId:buildReceipt.runId,definitionDigest:build.definitionDigest,executionId:build.executionId!}));
      }}};
  return{options,host,consumer};
}
