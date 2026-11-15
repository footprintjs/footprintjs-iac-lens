import type { PipelineCatalog, PipelineOption, PipelineOptionValue, PipelineSelection, PipelineStageSelection } from './pipeline-types.ts';
import { row, id, label, list, bool, ids, unique, primitive, choice, hex } from './pipeline-read.ts';

function readOption(input: unknown): PipelineOption {
  const value=row(input,['id','label','required','default','type','values','min','max']);
  const base={id:id(value.id),label:label(value.label),...(value.required!==undefined?{required:bool(value.required)}:{}),...(value.default!==undefined?{default:primitive(value.default)}:{})};
  let option:PipelineOption;
  if(value.type==='choice') option={...base,type:'choice',values:unique(list(value.values,32).map(input=>{const v=row(input,['value','label']);return {value:id(v.value),label:label(v.label)};}),v=>v.value)};
  else if(value.type==='integer' && Number.isSafeInteger(value.min) && Number.isSafeInteger(value.max) && Number(value.min)<=Number(value.max)) option={...base,type:'integer',min:Number(value.min),max:Number(value.max)};
  else if(value.type==='boolean')option={...base,type:'boolean'};
  else throw Error('Unsupported strategy option');
  if(option.type==='choice'&&!option.values.length)throw Error('A choice option needs registered values');
  if(option.default!==undefined)readOptionValue(option,option.default);
  return option;
}
function readOptionValue(option:PipelineOption,input:unknown):PipelineOptionValue {
  const value=primitive(input);
  if(option.type==='choice' && !option.values.some(item=>item.value===value) || option.type==='integer' && (typeof value!=='number'||value<option.min||value>option.max) || option.type==='boolean' && typeof value!=='boolean')throw Error(`Unsupported value for ${option.id}`);
  return value;
}
export function readPipelineStageSelection(input:unknown):PipelineStageSelection {
  const value=row(input,['id','strategyId','options','checkIds','rollback','scheduleId']);
  if(!value.options || typeof value.options!=='object'||Array.isArray(value.options))throw Error('Invalid strategy options');
  const keys=Object.keys(value.options);if(keys.length>32)throw Error('Too many strategy options');
  const options=Object.fromEntries(Object.entries(row(value.options,keys.map(id))).map(([key,value])=>[key,primitive(value)]));
  return {id:id(value.id),strategyId:id(value.strategyId),options,checkIds:ids(value.checkIds),rollback:choice(value.rollback,['disabled','manual','automatic'] as const),...(value.scheduleId!==undefined?{scheduleId:id(value.scheduleId)}:{})};
}
export function readPipelineSelection(input:unknown):PipelineSelection {
  const value=row(input,['releaseId','stages']);return {releaseId:id(value.releaseId),stages:unique(list(value.stages,32).map(readPipelineStageSelection),value=>value.id)};
}
export function readPipelineCatalog(input:unknown):PipelineCatalog {
  const value=row(input,['id','label','simulation','releases','strategies','checks','schedules','stages']);
  const choices=(input:unknown)=>unique(list(input).map(input=>{const value=row(input,['id','label']);return{id:id(value.id),label:label(value.label)};}),v=>v.id);
  const catalog:PipelineCatalog={id:id(value.id),label:label(value.label),simulation:bool(value.simulation),
    releases:unique(list(value.releases,128).map(input=>{const v=row(input,['id','label','kind','version','commit','digest']);
      const commit=v.commit===undefined?undefined:label(v.commit,64);if(commit&&!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit))throw Error('Invalid source commit');
      const kind=choice(v.kind,['source','prepared'] as const);if(kind==='prepared'&&!v.digest)throw Error('Prepared release needs a digest');
      return{id:id(v.id),label:label(v.label),kind,...(v.version!==undefined?{version:label(v.version)}:{}),...(commit?{commit}:{}),...(v.digest!==undefined?{digest:hex(v.digest)}:{})};}),v=>v.id),
    strategies:unique(list(value.strategies).map(input=>{const v=row(input,['id','label','description','rollback','options']);return{id:id(v.id),label:label(v.label),description:label(v.description,500),rollback:bool(v.rollback),options:unique(list(v.options,32).map(readOption),v=>v.id)};}),v=>v.id),
    checks:choices(value.checks),schedules:choices(value.schedules),
    stages:unique(list(value.stages,32).map(input=>{const v=row(input,['id','label','promotion','strategyIds','checkIds','scheduleIds','defaults']);const stageId=id(v.id);return{id:stageId,label:label(v.label),promotion:choice(v.promotion,['automatic','manual'] as const),strategyIds:ids(v.strategyIds),checkIds:ids(v.checkIds),scheduleIds:ids(v.scheduleIds),defaults:(({id:_,...defaults})=>defaults)(readPipelineStageSelection({...row(v.defaults,['strategyId','options','checkIds','rollback','scheduleId']),id:stageId}))};}),v=>v.id)};
  if(!catalog.releases.length||!catalog.stages.length)throw Error('Configure releases and stages');
  for(const stage of catalog.stages){
    if(!stage.strategyIds.length||stage.strategyIds.some(id=>!catalog.strategies.some(v=>v.id===id))||stage.checkIds.some(id=>!catalog.checks.some(v=>v.id===id))||stage.scheduleIds.some(id=>!catalog.schedules.some(v=>v.id===id)))throw Error('Stage references an unregistered capability');
  }
  admitPipelineSelection(catalog,{releaseId:catalog.releases[0]!.id,stages:catalog.stages.map(stage=>({id:stage.id,...stage.defaults}))});
  return catalog;
}
/** Admission against the host catalog is repeated at the server boundary. */
export function admitPipelineSelection(catalog:PipelineCatalog,input:unknown):PipelineSelection {
  const selection=readPipelineSelection(input);
  if(!catalog.releases.some(v=>v.id===selection.releaseId)||selection.stages.length!==catalog.stages.length)throw Error('Choose a registered release and every stage');
  selection.stages.forEach((stage,index)=>{
    const allowed=catalog.stages[index]!;const strategy=catalog.strategies.find(v=>v.id===stage.strategyId);
    if(stage.id!==allowed.id||!allowed.strategyIds.includes(stage.strategyId)||!strategy)throw Error('Unsupported stage strategy');
    if(stage.rollback!=='disabled'&&!strategy.rollback||stage.checkIds.some(id=>!allowed.checkIds.includes(id))||stage.scheduleId&&!allowed.scheduleIds.includes(stage.scheduleId))throw Error('Unsupported check, schedule or recovery policy');
    if(Object.keys(stage.options).some(id=>!strategy.options.some(v=>v.id===id)))throw Error('Unsupported strategy option');
    for(const option of strategy.options){const value=Object.hasOwn(stage.options,option.id)?stage.options[option.id]:undefined;if(value===undefined){if(option.required)throw Error(`Provide ${option.label}`);}else readOptionValue(option,value);}
  });
  return selection;
}
export function defaultPipelineSelection(catalog:PipelineCatalog):PipelineSelection{return {releaseId:catalog.releases[0]!.id,stages:catalog.stages.map(stage=>({id:stage.id,...structuredClone(stage.defaults)}))};}
