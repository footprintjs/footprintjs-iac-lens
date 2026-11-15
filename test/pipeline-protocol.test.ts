import assert from 'node:assert/strict';
import test from 'node:test';
import { admitPipelineSelection, defaultPipelineSelection, readPipelineAction, readPipelineCatalog, readPipelineView } from '../src/core/pipeline.ts';
import { pipelineCatalog } from '../examples/pipeline-strategies/catalog.ts';
const catalog=readPipelineCatalog(pipelineCatalog([{kind:'release-manifest',schemaVersion:1,id:'candidate',label:'Candidate',source:{repository:'https://github.com/example/app',ref:'v2',commit:'a'.repeat(40),tree:'b'.repeat(40)},recipe:{id:'recipe',digest:'c'.repeat(64)},artifacts:[],digest:'d'.repeat(64)}]));
test('pipeline selection admits only bounded host-registered stages, strategies, checks and options',()=>{
  const selection=defaultPipelineSelection(catalog);assert.deepEqual(admitPipelineSelection(catalog,selection),selection);
  for(const override of [{strategyId:'unregistered'},{options:{command:'curl attacker'}},{options:{pace:'unknown'}},{checkIds:['other-suite']},{scheduleId:'unregistered'}]){
    const draft=structuredClone(selection);Object.assign(draft.stages[1]!,override);assert.throws(()=>admitPipelineSelection(catalog,draft));
  }
  assert.throws(()=>admitPipelineSelection(catalog,{...selection,stages:selection.stages.toReversed()}));
  assert.throws(()=>admitPipelineSelection(catalog,{...selection,releaseId:'outside'}));
  assert.throws(()=>readPipelineAction({action:'preview',pipelineId:catalog.id,selection,repository:'https://other'}));
  assert.throws(()=>readPipelineAction({action:'start',pipelineId:catalog.id,previewId:'a'.repeat(64),path:'/private'}));
  assert.throws(()=>readPipelineAction({action:'recover',pipelineId:catalog.id,executionId:'run',stageId:'gamma',token:'browser-must-not-control-token'}));
});
test('capability catalogs validate schema defaults, references, duplicates and recovery capability',()=>{
  const copy=structuredClone(catalog);copy.strategies[1]!.options[0]!.default='unsupported';assert.throws(()=>readPipelineCatalog(copy));
  const recovery=structuredClone(catalog);recovery.strategies.forEach(v=>v.rollback=false);assert.throws(()=>readPipelineCatalog(recovery));
  assert.throws(()=>readPipelineCatalog({...catalog,stages:[...catalog.stages,catalog.stages[0]]}));
  assert.throws(()=>readPipelineCatalog({...catalog,releases:[{...catalog.releases[0],digest:undefined}]}));
  assert.throws(()=>readPipelineView({catalog,busy:false,execution:{id:'run',status:'passed',releaseId:'outside',releaseDigest:'d'.repeat(64),stages:[],recordings:[],events:[]}}));
});
test('option schema accepts registered alternate strategies without hard coding provider tools',()=>{
  const copy=structuredClone(catalog);copy.strategies.push({id:'future-tool',label:'New tool',description:'A host registered strategy',rollback:false,options:[{id:'batch',label:'Batch size',type:'integer',required:true,min:1,max:10},{id:'careful',label:'Careful',type:'boolean',default:true}]});copy.stages[0]!.strategyIds.push('future-tool');
  const selection=defaultPipelineSelection(copy);selection.stages[0]={id:'dev',strategyId:'future-tool',options:{batch:5,careful:true},checkIds:[],rollback:'disabled'};
  assert.equal(admitPipelineSelection(readPipelineCatalog(copy),selection).stages[0]?.strategyId,'future-tool');
  selection.stages[0].options.batch=11;assert.throws(()=>admitPipelineSelection(copy,selection));
});
