import { createHash,randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadIdentityTarget } from 'footprintjs-iac/integration/identity';
import { createNeoReleasePipeline,type NeoReleasePipelineOptions } from 'footprintjs-iac/integration/identity/release-pipeline';
import { FileMasterStore } from 'footprintjs-iac/master/workflow';
import { loadPipelineRecording,type PipelineWorkflowPort } from 'footprintjs-iac/pipeline/node';
import { admitPipelineSelection,type PipelineSelection } from '../../src/core/pipeline.ts';
import type { ControllerOptions,PreparedPipeline,DeliveryPublication } from '../../src/server/index.ts';
import { neoIdentitySystemView } from '../neo-identity/system-view.ts';
import { neoDeliveryBaselineRun } from '../neo-github-delivery/projection.ts';
import { masterReviewSummary } from '../neo-identity/master-summary.ts';
import { neoReleasePipelineCatalog } from './catalog.ts';
import { createNeoEnvironmentProjection } from './environment-projection.ts';
import { loadNeoLensAttempt,saveNeoLensAttempt } from './attempt.ts';

/** Host-only composition: Neo supplies real adapters to the reusable library and Lens protocol. */
export async function createNeoReleasePipelineHost(options:NeoReleasePipelineOptions,review:{newAttempt?:boolean}={}):Promise<ControllerOptions>{
  const consumer=await createNeoReleasePipeline(options),catalog=neoReleasePipelineCatalog(options);
  const directory=join(consumer.directory,'lens'),path=join(directory,'current-attempt.json');
  const hostDigest=createHash('sha256').update(JSON.stringify({id:catalog.id,environments:consumer.environments,stages:catalog.stages})).digest('hex');
  const environments=await Promise.all(options.environments.map(async environment=>({id:environment.id,label:environment.label,target:await(options.loadTarget??loadIdentityTarget)(environment.targetPath),baseline:consumer.baselines[environment.id]!})));
  const project=createNeoEnvironmentProjection(environments),listeners=new Set<(patch:DeliveryPublication)=>void>();let queue=Promise.resolve();
  let retained:DeliveryPublication={revisionReview:{...masterReviewSummary(await new FileMasterStore(join(consumer.target.directory,'master')).load()),canApply:false}};
  consumer.subscribe(event=>{
    queue=queue.then(async()=>{const patch=await project(event);retained={...retained,...patch};for(const listener of listeners)listener(patch);})
      .catch(()=>{const patch:DeliveryPublication={appAccess:{status:'failed',message:'A recorded Neo observation could not be displayed. Inspect its retained evidence.'}};retained={...retained,...patch};for(const listener of listeners)listener(patch);});
  });
  const wrap=(workflow:PipelineWorkflowPort):PipelineWorkflowPort=>({snapshot:workflow.snapshot.bind(workflow),subscribe:workflow.subscribe.bind(workflow),
    async start(){const state=await workflow.start();await queue;return state;},async promote(request){const state=await workflow.promote(request);await queue;return state;},async recover(request){const state=await workflow.recover(request);await queue;return state;}});
  const create=async(id:string,selection:PipelineSelection):Promise<PreparedPipeline>=>{
    const selected=admitPipelineSelection(catalog,selection);
    const prepared=await consumer.createPipeline({id,releaseId:selected.releaseId,stageIds:selected.stages.map(stage=>stage.id)});
    return{workflow:wrap(prepared.workflow),plans:prepared.plans};
  };
  const previous=review.newAttempt?undefined:await loadNeoLensAttempt(path,hostDigest);
  const current=previous?{selection:previous.selection,prepared:await create(previous.id,previous.selection)}:undefined;
  const run=await neoDeliveryBaselineRun(consumer.baseline);
  return {directory,systemView:neoIdentitySystemView(consumer.target),initialReview:{graph:consumer.baseline.graph,run,
    target:{id:consumer.target.id,context:consumer.target.context,namespace:consumer.target.namespace,label:options.environments[0]!.label},neoUrl:`http://127.0.0.1:${consumer.target.neoPort}/?test`},
    pipeline:{catalog,...(current?{current}:{}),async prepare(selection){const id='neo-'+randomUUID(),prepared=await create(id,selection);await saveNeoLensAttempt(path,{version:1,hostDigest,id,selection});return prepared;},
      subscribePublication(listener){listeners.add(listener);if(Object.keys(retained).length)listener(retained);return()=>{listeners.delete(listener);};},
      async loadRecording(state,stageId){const receipt=state.recordings.findLast(item=>item.stageId===stageId);if(!receipt)return;
        const loaded=await loadPipelineRecording(receipt.evidencePath,{runId:receipt.runId,definitionDigest:state.definitionDigest,executionId:state.executionId!,stageId});
        return{snapshot:loaded.snapshot,structure:loaded.structure,controlDeps:loaded.controlDeps as Record<string,unknown>,narrativeEntries:Array.isArray(loaded.narrativeEntries)?loaded.narrativeEntries:[]};}},
  };
}
