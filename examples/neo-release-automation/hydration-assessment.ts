import {lstat,readFile,realpath} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {verifyEvidenceTrace,type InfraGraph} from 'footprintjs-iac';
import {readChangeAssessmentReport,loadChangeAssessmentRecording} from 'footprintjs-iac/change-assessment/node';
import type {PipelineOperation} from 'footprintjs-iac/pipeline';
import {neoDeliveryTarget} from 'footprintjs-iac/integration/identity/github-delivery';
import type {ChangeAssessmentView} from '../../src/core/change-assessment.ts';
import {pipelineFingerprint} from '../../src/server/pipeline-binding.ts';
import type {NeoEnvironmentView} from '../neo-release-pipeline/environment-projection.ts';

const row=(input:unknown):Record<string,unknown>=>input&&typeof input==='object'&&!Array.isArray(input)?input as Record<string,unknown>:{};
/** Private deployment metadata supplies a reference, never an unrestricted path to follow. */
export async function hydrateNeoStageAssessment(directory:string,environment:NeoEnvironmentView,executionId:string,operation:PipelineOperation,graph:InfraGraph):Promise<ChangeAssessmentView|undefined>{
  const deployment=row(operation.receipt?.metadata?.deployment),metadata=row(deployment.metadata);
  const phase=metadata.revalidation?'revalidate':metadata.assessment?'plan':undefined;if(!phase)return;
  const receipt=row(metadata[phase==='revalidate'?'revalidation':'assessment']),report=readChangeAssessmentReport(receipt.report),recording=row(receipt.recording);
  const reviewId=report.id.match(new RegExp('^neo-'+phase+'-([a-f0-9]{64})$'))?.[1];
  const operationId=pipelineFingerprint({executionId,stageId:environment.id,id:operation.id});
  const fixed=join(directory,'pipelines','deployment',environment.id,operationId,'assessments',reviewId??'invalid',phase);
  const path=recording.evidencePath,trace=recording.tracePath;
  const target=neoDeliveryTarget(environment.target);
  if(!reviewId||typeof path!=='string'||typeof trace!=='string'||dirname(path)!==fixed||!/^[-A-Za-z0-9]{1,128}\.json$/.test(basename(path))
    ||trace!==path.replace(/\.json$/,'.jsonl')||recording.complete!==true||report.target.id!==target.id||report.target.scopeDigest!==pipelineFingerprint(target.scope)
    ||report.changes.length!==graph.resources.length||report.changes.some(change=>{
      const resource=graph.resources.find(resource=>resource.id===change.resourceId);return !resource||change.desiredDigest!==pipelineFingerprint(resource);
    })||!operation.receipt?.evidence?.some(reference=>reference.kind==='change-assessment-'+phase&&reference.digest===report.digest&&reference.runId===recording.runId))throw Error('Neo preflight receipt is not bound to this fixed stage deployment');
  for(const file of [path,trace]){const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>16*1024*1024||await realpath(file)!==file)throw Error('Neo preflight receipt left its fixed directory');}
  const value=JSON.parse(await readFile(path,'utf8'));
  await verifyEvidenceTrace({snapshot:value.snapshot,tracePath:trace,traceStatus:value.traceStatus});
  const loaded=await loadChangeAssessmentRecording(path,{runId:String(recording.runId),definitionDigest:report.definitionDigest,executionId:report.executionId});
  if(!loaded.complete||pipelineFingerprint((loaded.snapshot as {sharedState?:{report?:unknown}}).sharedState?.report)!==pipelineFingerprint(report))throw Error('Neo preflight report differs from its native decision recording');
  return{phase,status:'complete',report,recording:{snapshot:loaded.snapshot,structure:loaded.structure,controlDeps:loaded.controlDeps as Record<string,unknown>,narrativeEntries:Array.isArray(loaded.narrativeEntries)?loaded.narrativeEntries:[]}};
}
