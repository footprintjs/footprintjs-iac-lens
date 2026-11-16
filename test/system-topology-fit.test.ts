import assert from 'node:assert/strict';
import test from 'node:test';
import {fitSystemTopology} from '../web/features/system-topology/topology-fit.ts';
test('full native system geometry fits the actual 720p viewport without vertical overflow',()=>{
 const result=fitSystemTopology({width:996,height:388},{width:1238,height:354});
 assert.equal(result.scale,354/388);assert.equal(result.height,354);assert(result.width<=1238);
 assert.equal(result.width/result.scale,996,'visual fitting keeps routing and card geometry unchanged');
});
test('fitting observes both viewport dimensions, never enlarges cards, and retains safe unmeasured geometry',()=>{
 assert.deepEqual(fitSystemTopology({width:996,height:388},{width:2000,height:1000}),{scale:1,width:996,height:388});
 const narrow=fitSystemTopology({width:996,height:388},{width:431,height:774});assert.equal(narrow.scale,431/996);assert.equal(narrow.width,431);assert(narrow.height<=774);
 assert.deepEqual(fitSystemTopology({width:996,height:388},{width:0,height:0}),{scale:1,width:996,height:388});
 assert.deepEqual(fitSystemTopology({width:996,height:388},{width:NaN,height:354}),{scale:1,width:996,height:388});
});
