import { createHash } from 'node:crypto';
import { readPipelineState,type PipelineState } from 'footprintjs-iac/pipeline';
import { readReleaseManifest } from 'footprintjs-iac/releases/node';
import type { PipelineCatalog,PipelineSelection } from '../core/pipeline.ts';
export interface PipelineBinding { definitionDigest:string; definition:string; releaseDigest:string; release:string }
function canonical(input:unknown):string {
  if(Array.isArray(input))return '['+input.map(canonical).join(',')+']';
  if(input&&typeof input==='object')return '{'+Object.keys(input).sort().map(key=>JSON.stringify(key)+':'+canonical((input as Record<string,unknown>)[key])).join(',')+'}';
  return JSON.stringify(input);
}
export const pipelineFingerprint=(input:unknown)=>createHash('sha256').update(canonical(input)).digest('hex');
/** Public base readers admit native state, then the host pins its full target/release definition. */
export function admitPipelineHostState(input:PipelineState,catalog:PipelineCatalog,selection:PipelineSelection,binding?:PipelineBinding):{state:PipelineState;binding:PipelineBinding}{
  const state=readPipelineState(input);const release=readReleaseManifest(state.release);
  if(state.definition.stages.length!==selection.stages.length)throw Error('Unexpected pipeline stage');
  selection.stages.forEach((selected,index)=>{const definition=state.definition.stages[index];if(!definition||definition.id!==selected.id||definition.strategyId!==selected.strategyId||definition.rollback!==selected.rollback||definition.promotion!==catalog.stages[index]?.promotion)throw Error('Pipeline does not match selected settings');});
  const choice=catalog.releases.find(value=>value.id===selection.releaseId);if(!choice||choice.digest&&choice.digest!==release.digest||choice.commit&&choice.commit!==release.source.commit)throw Error('The registered source or prepared release changed');
  const next={definitionDigest:state.definitionDigest,definition:pipelineFingerprint(state.definition),releaseDigest:release.digest,release:pipelineFingerprint(release)};
  if(binding&&canonical(binding)!==canonical(next))throw Error('The installed pipeline target or release binding changed');
  return{state,binding:next};
}
