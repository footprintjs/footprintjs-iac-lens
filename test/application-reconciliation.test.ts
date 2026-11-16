import assert from 'node:assert/strict';
import test from 'node:test';
import {ApplicationReview} from '../src/server/application.ts';
import {readApplicationAction,readApplicationView} from '../src/core/application.ts';

const selection={strategyId:'server',targetId:'local'},reviewId='original-review';
function fixture({method=true,promote=false,unconfirmed=false,sourceEnabled=false,throwFirst=false}={}){
 let calls=0,snapshots=0;
 const closed={reviewId,status:'reconciled-failed',recording:{runId:'native-settlement'}};
 const available={reviewId,status:'available'};
 const source={version:1,id:'source',label:'Code',providerId:'git-source',binding:selection,definitionDigest:'a'.repeat(64),receiptDigest:'b'.repeat(64),recipeDigest:'c'.repeat(64),configurationDigest:'d'.repeat(64),repository:'https://github.com/company/app.git',ref:'main',commit:'e'.repeat(40),tree:'f'.repeat(40),status:'ready',stages:['resolve','fetch','build','publish'].map(id=>({id,label:id,status:'passed'})),recording:{id:'source-proof',kind:'release-build',source:'native',complete:true,runId:'native-source'}};
 const host:any={version:1,id:'app',label:'App',strategies:[{id:'server',label:'Server',targets:[{id:'local',label:'Local',requiresProfile:false,...sourceEnabled?{requiresSource:true}:{},requiredInspectionCheckIds:['target'],requiredVerificationCheckIds:['health']}]}],
  inspect:async()=>({ok:true,checks:[{id:'target',label:'Target',status:'passed'}]}),plan:async()=>({ok:false,changes:[]}),apply:async()=>{throw Error('must not apply')},
  async snapshot(){snapshots++;return{selection,...sourceEnabled?{publication:{source}}:{},incomplete:calls===0||unconfirmed,deployment:promote&&calls?{ok:true,promoted:true,status:'promoted',checks:[{id:'health',label:'Health',status:'passed'}],appUrl:'http://127.0.0.1:1234'}:{ok:false,promoted:false,status:'incomplete'},reconciliation:calls&&!unconfirmed?closed:available};}};
 if(method)host.reconcile=async(input:any,publish:any)=>{assert.deepEqual(input,{...selection,reviewId});calls++;if(throwFirst&&calls===1)throw Error('private-observation-unavailable');if(promote)publish({neoUrl:'http://127.0.0.1:1234'});};
 const views:any[]=[],publications:any[]=[],review=new ApplicationReview(host,(view,publication)=>{views.push(view);publications.push(publication)});
 return{review,views,publications,calls:()=>calls,snapshots:()=>snapshots};
}
test('only an exact registered incomplete attempt offers observe-only reconciliation',async()=>{
 const f=fixture();await f.review.initialize();assert.equal(f.review.snapshot().reconciliation?.status,'available');assert.equal(f.review.snapshot().canInspect,false);
 assert.throws(()=>f.review.action({action:'reconcile',reviewId:'foreign'} as any),/outcome/i);assert.equal(f.calls(),0);
 assert.deepEqual(readApplicationAction({action:'reconcile',reviewId}),{action:'reconcile',reviewId});
 for(const extra of [{command:'restart'},{targetId:'other'},{path:'/private/state'}])assert.throws(()=>readApplicationAction({action:'reconcile',reviewId,...extra}));
 f.review.action({action:'reconcile',reviewId} as any);await f.review.whenIdle();
 assert.equal(f.calls(),1);assert.equal(f.review.snapshot().phase,'failed');assert.equal(f.review.snapshot().canInspect,true);assert.equal(f.review.snapshot().canReview,false);assert.equal(f.review.snapshot().canDeploy,false);
 assert.equal(f.review.snapshot().deployment?.status,'incomplete');assert.equal(f.review.snapshot().reconciliation?.status,'reconciled-failed');
 assert.throws(()=>f.review.action({action:'reconcile',reviewId} as any),/outcome/i);
 f.review.action({action:'inspect'});await f.review.whenIdle();assert.equal(f.review.snapshot().reconciliation,undefined);assert.equal(f.review.snapshot().canReview,true);
});
test('a callback or absent registered port cannot settle an uncertain effect',async()=>{
 const unknown=fixture({unconfirmed:true});await unknown.review.initialize();unknown.review.action({action:'reconcile',reviewId} as any);await unknown.review.whenIdle();
 assert.equal(unknown.review.snapshot().phase,'incomplete');assert.equal(unknown.review.snapshot().canInspect,false);assert.equal(unknown.review.snapshot().reconciliation?.status,'available');
 const missing=fixture({method:false});await missing.review.initialize();assert.equal(missing.review.snapshot().reconciliation,undefined);assert.throws(()=>missing.review.action({action:'reconcile',reviewId} as any),/outcome/i);
});
test('reconciliation never publishes an app URL or admits promotion',async()=>{
 const f=fixture({promote:true});await f.review.initialize();f.review.action({action:'reconcile',reviewId} as any);await f.review.whenIdle();
 assert.equal(f.review.snapshot().phase,'incomplete');assert.equal(f.review.snapshot().deployment?.promoted,false);assert.equal(f.review.snapshot().canDeploy,false);
 assert.ok(f.views.every(view=>!view.deployment?.promoted));assert.ok(f.publications.every(value=>!value?.neoUrl));
});
test('closed reconciliation requires a bounded proof link and cannot be a ready view',()=>{
 const base:any={id:'app',label:'App',strategies:[{id:'server',label:'Server',targets:[{id:'local',label:'Local',requiresProfile:false,requiredInspectionCheckIds:['target'],requiredVerificationCheckIds:['health']}]}],selection,phase:'failed',busy:false,canInspect:true,canReview:false,canDeploy:false,deployment:{ok:false,promoted:false,status:'incomplete'},reconciliation:{reviewId,status:'reconciled-failed',recording:{runId:'native-settlement'}}};
 assert.equal(readApplicationView(base).reconciliation?.status,'reconciled-failed');
 for(const reconciliation of [{reviewId,status:'reconciled-failed'},{reviewId,status:'available',recording:{runId:'extra'}},{reviewId,status:'reconciled-failed',recording:{runId:'x',evidencePath:'/private'}}])assert.throws(()=>readApplicationView({...base,reconciliation}));
 assert.throws(()=>readApplicationView({...base,phase:'ready'}));
});
test('an interrupted outcome inspection preserves its original source proof for an explicit later observation',async()=>{
 const f=fixture({sourceEnabled:true,throwFirst:true});await f.review.initialize();
 f.review.action({action:'reconcile',reviewId});await f.review.whenIdle();assert.equal(f.review.snapshot().phase,'incomplete');
 f.review.action({action:'reconcile',reviewId});await f.review.whenIdle();assert.equal(f.review.snapshot().phase,'failed');assert.equal(f.review.snapshot().canInspect,true);assert.equal(f.calls(),2);
 assert.ok(f.publications.every(value=>!value?.source||value.source.status==='ready'));
});
