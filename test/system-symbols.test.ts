import assert from 'node:assert/strict';
import test from 'node:test';
import {defineSystemTopology,projectSystemTopology} from 'footprintjs-iac/system-topology/node';
import {createSystemSymbolAdapter,validateDiagramSymbolPack,type DiagramSymbolPack} from '../src/core/system-symbols.ts';

function pack() {
 return{version:1 as const,id:'consumer-shapes',symbols:[{id:'arbitrary-consumer-shape',viewBox:{width:64,height:48},paths:[{d:'M 4 4 H 60 V 44 H 4 Z',fill:'surface' as const,stroke:'ink' as const,strokeWidth:1.5}]}],
  bindings:[{targetId:'office',topologyId:'placement',subject:'component' as const,subjectId:'api',symbolId:'arbitrary-consumer-shape'}]};
}
function topology(targetId='office',topologyId='placement') {
 const binding={targetId,graphDigest:'b'.repeat(64)};
 const definition=defineSystemTopology({id:topologyId,label:'Office services',boundaries:[{id:'host',kind:'server',label:'Registered host'}],nodes:[
  {id:'api',label:'Application',category:'compute',origin:'existing',boundaryId:'host',bindings:{resourceIds:[]}},
  {id:'data',label:'Data',category:'storage',origin:'existing',boundaryId:'host',bindings:{resourceIds:[]}},
 ],connections:[]},binding);
 return projectSystemTopology(definition,{...binding,definitionDigest:definition.digest,configurationDigest:'c'.repeat(64),resources:[],components:[],checks:[]});
}

test('passive consumer geometry is detached and frozen without altering its source',()=>{
 const input=pack(),before=structuredClone(input),admitted=validateDiagramSymbolPack(input);
 assert.deepEqual(input,before);assert.deepEqual(admitted,before);assert.notEqual(admitted,input);
 assert(Object.isFrozen(admitted));assert(Object.isFrozen(admitted.symbols));assert(Object.isFrozen(admitted.symbols[0]!.paths[0]!));
 input.symbols[0]!.paths[0]!.d='M 0 0 L 2 2';input.bindings[0]!.subjectId='data';
 assert.equal(admitted.symbols[0]!.paths[0]!.d,before.symbols[0]!.paths[0]!.d);assert.equal(admitted.bindings[0]!.subjectId,'api');
});

test('object presentation is optional passive metadata and existing symbol packs retain their exact shape',()=>{
 const legacy=pack(),legacyBefore=structuredClone(legacy),legacyAdmitted=validateDiagramSymbolPack(legacy);
 assert.deepEqual(legacyAdmitted,legacyBefore);
 assert.equal(Object.hasOwn(legacyAdmitted.symbols[0]!,'presentation'),false);
 const input={...pack(),symbols:[{...pack().symbols[0]!,presentation:'object' as const}]},before=structuredClone(input);
 const admitted=validateDiagramSymbolPack(input),view=topology(),nativeBefore=structuredClone(view);
 assert.equal(admitted.symbols[0]!.presentation,'object');
 assert.deepEqual(input,before);assert(Object.isFrozen(admitted.symbols[0]!));
 const resolved=createSystemSymbolAdapter(input).resolve(view,{kind:'component',id:'api'});
 assert.deepEqual(resolved,admitted.symbols[0]);assert.equal(resolved?.presentation,'object');
 assert.deepEqual(view,nativeBefore,'presentation cannot change recorded labels, origin, progress or execution');
 input.symbols[0]!.paths[0]!.d='M0 0 L1 1';
 assert.equal(admitted.symbols[0]!.paths[0]!.d,before.symbols[0]!.paths[0]!.d);
});

test('object presentation admits only the explicit generic mode and never invokes metadata accessors',()=>{
 for(const presentation of ['card','icon','server','database','<svg onload="run()">',null,1,{},()=>{}]){
  const input={...pack(),symbols:[{...pack().symbols[0]!,presentation}]};
  assert.throws(()=>validateDiagramSymbolPack(input),/Invalid diagram symbol pack/);
 }
 let invoked=0;const definition={...pack().symbols[0]!};
 Object.defineProperty(definition,'presentation',{enumerable:true,get(){invoked++;return'object';}});
 assert.throws(()=>validateDiagramSymbolPack({...pack(),symbols:[definition]}),/Invalid diagram symbol pack/);
 assert.equal(invoked,0);
});

test('object ports round-trip as detached viewBox coordinates and preserve the exact symbol binding', () => {
 const input = pack();
 const ports = [{ x: 4, y: 30, side: 'left' }, { x: 60, y: 30, side: 'right' }];
 const withPorts = { ...input, symbols: [{ ...input.symbols[0], presentation: 'object', ports }] };
 const admitted = validateDiagramSymbolPack(withPorts);
 const transmitted = validateDiagramSymbolPack(JSON.parse(JSON.stringify(admitted)));
 const resolved = createSystemSymbolAdapter(transmitted).resolve(topology(), { kind: 'component', id: 'api' });

 assert.deepEqual(resolved?.ports, ports);
 assert.ok(Object.isFrozen(admitted.symbols[0]?.ports));
 assert.ok(Object.isFrozen(admitted.symbols[0]?.ports?.[0]));
 assert.notEqual(admitted.symbols[0]?.ports, ports);
 ports[0]!.x = 5;
 assert.equal(admitted.symbols[0]?.ports?.[0]?.x, 4);
 assert.deepEqual(validateDiagramSymbolPack(input), input);
});

test('ports reject invalid geometry, duplicate coordinates and accessors', () => {
 const input = pack();
 const port = { x: 4, y: 30, side: 'left' };
 const definition = { ...input.symbols[0], presentation: 'object' };
 let accessorRuns = 0;
 const accessor = { ...port, get x() { accessorRuns++; return 4; } };
 const invalidPorts = [
  [], [{ ...port, x: NaN }], [{ ...port, y: Infinity }],
  [{ ...port, x: -1 }], [{ ...port, x: 65 }], [{ ...port, y: 49 }],
  [{ ...port, side: 'top' }], [{ ...port, side: undefined }],
  [port, { ...port, side: 'right' }], [accessor], Array.from({ length: 17 }, (_, x) => ({ ...port, x })),
 ];
 for (const ports of invalidPorts) {
  assert.throws(() => validateDiagramSymbolPack({ ...input, symbols: [{ ...definition, ports }] }), /Invalid diagram symbol pack/);
 }
 assert.throws(() => validateDiagramSymbolPack({ ...input, symbols: [{ ...input.symbols[0], ports: [port] }] }), /Invalid diagram symbol pack/);
 assert.equal(accessorRuns, 0);
});

test('symbol lookup uses exact target, topology and real subject membership, preserving native state',()=>{
 const input=pack(),adapter=createSystemSymbolAdapter(input),view=topology(),before=structuredClone(view);
 assert.equal(adapter.resolve(view,{kind:'component',id:'api'})?.id,'arbitrary-consumer-shape');
 for(const subject of [{kind:'component' as const,id:'data'},{kind:'component' as const,id:'host'},{kind:'boundary' as const,id:'api'},{kind:'component' as const,id:'missing'}])assert.equal(adapter.resolve(view,subject),undefined);
 assert.equal(adapter.resolve(topology('another-office'),{kind:'component',id:'api'}),undefined);
 assert.equal(adapter.resolve(topology('office','other-topology'),{kind:'component',id:'api'}),undefined);
 assert.deepEqual(view,before);assert.equal(view.nodes[0]!.origin,'existing');assert.equal(view.nodes[0]!.status,'pending');
 input.bindings[0]!.subjectId='data';assert.equal(adapter.resolve(view,{kind:'component',id:'data'}),undefined,'caller changes cannot retarget an admitted adapter');
});

test('boundary and component assignments remain distinct, and an empty pack supplies no defaults',()=>{
 const input:DiagramSymbolPack={...pack(),bindings:[...pack().bindings,{targetId:'office',topologyId:'placement',subject:'boundary',subjectId:'host',symbolId:'arbitrary-consumer-shape'}]};
 const adapter=createSystemSymbolAdapter(input),view=topology();
 assert.equal(adapter.resolve(view,{kind:'boundary',id:'host'})?.id,'arbitrary-consumer-shape');
 assert.equal(adapter.resolve(view,{kind:'component',id:'host'}),undefined);
 const missing={...view,nodes:view.nodes.filter(row=>row.id!=='api')};assert.equal(adapter.resolve(missing,{kind:'component',id:'api'}),undefined);
 assert.equal(createSystemSymbolAdapter({version:1,id:'no-catalog',symbols:[],bindings:[]}).resolve(view,{kind:'component',id:'api'}),undefined);
});

test('unknown fields, accessors, inherited objects and prototype-related keys are refused without invoking getters',()=>{
 let invoked=0;const accessor={...pack()};Object.defineProperty(accessor,'symbols',{get(){invoked++;return[];}});
 const inherited=Object.assign(Object.create({private:true}),pack());
 const dangerous=JSON.parse(JSON.stringify({...pack(),extra:true}));delete dangerous.extra;Object.defineProperty(dangerous,'__proto__',{value:{polluted:true},enumerable:true});
 for(const value of [{...pack(),script:'alert(1)'},{...pack(),version:2},accessor,inherited,dangerous,{...pack(),symbols:[{...pack().symbols[0],image:'https://example.com/icon.svg'}]}])assert.throws(()=>validateDiagramSymbolPack(value),/Invalid diagram symbol pack/);
 assert.equal(invoked,0);
 const sparse=pack();delete sparse.symbols[0];assert.throws(()=>validateDiagramSymbolPack(sparse),/Invalid diagram symbol pack/);
});

test('raw markup, URLs, invalid commands, nonfinite coordinates and invalid view boxes never cross the contract',()=>{
 const badPaths=['<svg onload="alert(1)">','https://example.com/icon.svg','M0 0 url(javascript:alert(1))','M 0 0 R 2 2','M 0','M 0 0 L 1e999 0','M 0 0 Z 1','M 0 0 L 1000001 0','M 0 0 '+ 'L0 0 '.repeat(1800)];
 for(const d of badPaths){const value=pack();value.symbols[0]!.paths[0]!.d=d;assert.throws(()=>validateDiagramSymbolPack(value),/Invalid diagram symbol pack/);}
 for(const width of [0,-1,NaN,Infinity,513]){const value=pack();value.symbols[0]!.viewBox.width=width;assert.throws(()=>validateDiagramSymbolPack(value),/Invalid diagram symbol pack/);}
 for(const strokeWidth of [-1,17,NaN]){const value=pack();value.symbols[0]!.paths[0]!.strokeWidth=strokeWidth;assert.throws(()=>validateDiagramSymbolPack(value),/Invalid diagram symbol pack/);}
 const badPaint={...pack(),symbols:[{...pack().symbols[0],paths:[{d:'M0 0 L1 1',fill:'url(#foreign)'}]}]};assert.throws(()=>validateDiagramSymbolPack(badPaint),/Invalid diagram symbol pack/);
});

test('duplicate definitions, ambiguous bindings, missing symbols and oversized packs are refused',()=>{
 const duplicate=pack();duplicate.symbols.push(structuredClone(duplicate.symbols[0]!));
 const ambiguous=pack();ambiguous.bindings.push(structuredClone(ambiguous.bindings[0]!));
 const missing=pack();missing.bindings[0]!.symbolId='unregistered';
 const many=pack();many.symbols=Array.from({length:33},(_,index)=>({...structuredClone(pack().symbols[0]!),id:`symbol-${index}`}));
 const manyBindings=pack();manyBindings.bindings=Array.from({length:129},(_,index)=>({...pack().bindings[0]!,subjectId:`component-${index}`}));
 const large=pack();large.symbols=Array.from({length:32},(_,index)=>({...structuredClone(pack().symbols[0]!),id:`symbol-${index}`,paths:[{...pack().symbols[0]!.paths[0]!,d:'M0 0 '+ 'L1 1 '.repeat(500)}]}));large.bindings=[];
 for(const value of [duplicate,ambiguous,missing,many,manyBindings,large])assert.throws(()=>validateDiagramSymbolPack(value),/Invalid diagram symbol pack/);
});
