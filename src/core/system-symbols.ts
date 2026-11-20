import type {SystemTopologyView} from 'footprintjs-iac/system-topology';

export interface DiagramSymbolPath {
  readonly d:string;
  readonly fill?:'none'|'surface'|'subtle'|'accent';
  readonly stroke?:'none'|'ink'|'muted'|'accent';
  readonly strokeWidth?:number;
}
/** An outline attachment point in SVG viewBox units. Wires approach from the designated side. */
export interface DiagramSymbolPort {
  readonly x: number;
  readonly y: number;
  readonly side: 'left' | 'right';
}
export interface DiagramSymbolDefinition {
  readonly id:string;
  /** Render the consumer drawing as the object itself; omission retains the existing glyph presentation. */
  readonly presentation?:'object';
  readonly viewBox:{readonly width:number;readonly height:number};
  readonly paths:readonly DiagramSymbolPath[];
  readonly ports?: readonly DiagramSymbolPort[];
}
export interface DiagramSymbolBinding {
  readonly targetId:string;
  readonly topologyId:string;
  readonly subject:'component'|'boundary';
  readonly subjectId:string;
  readonly symbolId:string;
}
/** Consumer-owned presentation only; no resource state, executable markup or external assets. */
export interface DiagramSymbolPack {
  readonly version:1;
  readonly id:string;
  readonly symbols:readonly DiagramSymbolDefinition[];
  readonly bindings:readonly DiagramSymbolBinding[];
}
export interface SystemSymbolSubject {readonly kind:'component'|'boundary';readonly id:string}
export interface SystemSymbolAdapter {
  resolve(view:SystemTopologyView,subject:SystemSymbolSubject):DiagramSymbolDefinition|undefined;
}

const invalid=(field:string):never=>{throw new TypeError(`Invalid diagram symbol pack: ${field}`);};
function object(value:unknown,allowed:readonly string[],field:string):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid(field);
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)return invalid(field);
  const result:Record<string,unknown>=Object.create(null);
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string'||!allowed.includes(key))return invalid(field);
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!('value'in descriptor))return invalid(field);
    result[key]=descriptor.value;
  }
  return result;
}
function array(value:unknown,max:number,field:string):unknown[] {
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>max)return invalid(field);
  if(Reflect.ownKeys(value).length!==value.length+1)return invalid(field);
  return Array.from({length:value.length},(_,index)=>{
    const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
    if(!descriptor||!('value'in descriptor))return invalid(field);
    return descriptor.value;
  });
}
function id(value:unknown,field:string):string {
  if(typeof value!=='string'||!value.length||value.length>160||value.trim()!==value
    ||/[\u0000-\u001f\u007f]/.test(value)||['__proto__','prototype','constructor'].includes(value))return invalid(field);
  return value;
}
function number(value:unknown,min:number,max:number,field:string):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)return invalid(field);
  return value;
}
function choice<T extends string>(value:unknown,values:readonly T[],field:string):T|undefined {
  if(value===undefined)return;
  if(typeof value!=='string'||!values.includes(value as T))return invalid(field);
  return value as T;
}

/** Only bounded SVG path commands and finite coordinates cross the transport. */
function pathData(value:unknown):string {
  if(typeof value!=='string'||!value.length||value.length>8192||!/^\s*[Mm]/.test(value))return invalid('paths.d');
  const token=/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  if(value.replace(token,'').replace(/[\s,]/g,''))return invalid('paths.d');
  const tokens=value.match(token)!;
  const arity:Record<string,number>={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0};
  let index=0;
  while(index<tokens.length){
    const command=tokens[index++]!,count=arity[command.toUpperCase()];
    if(count===undefined)return invalid('paths.d');
    let coordinates=0;
    while(index<tokens.length&&!/^[A-Za-z]$/.test(tokens[index]!)){
      number(Number(tokens[index++]),-1_000_000,1_000_000,'paths.d');coordinates++;
    }
    if(count===0?coordinates!==0:coordinates===0||coordinates%count!==0)return invalid('paths.d');
  }
  return value;
}
function path(value:unknown):DiagramSymbolPath {
  const input=object(value,['d','fill','stroke','strokeWidth'],'paths');
  const fill=choice(input.fill,['none','surface','subtle','accent']as const,'paths.fill');
  const stroke=choice(input.stroke,['none','ink','muted','accent']as const,'paths.stroke');
  const strokeWidth=input.strokeWidth===undefined?undefined:number(input.strokeWidth,0,16,'paths.strokeWidth');
  return Object.freeze({d:pathData(input.d),...fill===undefined?{}:{fill},...stroke===undefined?{}:{stroke},...strokeWidth===undefined?{}:{strokeWidth}});
}
function readPorts(value: unknown, viewBox: DiagramSymbolDefinition['viewBox']): readonly DiagramSymbolPort[] {
  const entries = array(value, 16, 'ports');
  if (entries.length === 0) return invalid('ports');

  const coordinates = new Set<string>();
  const ports = entries.map(entry => {
    const input = object(entry, ['x', 'y', 'side'], 'ports');
    const side = choice(input.side, ['left', 'right'] as const, 'ports.side');
    if (side === undefined) return invalid('ports.side');
    const x = number(input.x, 0, viewBox.width, 'ports.x');
    const y = number(input.y, 0, viewBox.height, 'ports.y');
    const key = JSON.stringify([x, y]);
    if (coordinates.has(key)) return invalid('ports');
    coordinates.add(key);
    return Object.freeze({ x, y, side });
  });
  return Object.freeze(ports);
}
function symbol(value:unknown):DiagramSymbolDefinition {
  const input = object(value, ['id', 'presentation', 'viewBox', 'paths', 'ports'], 'symbols');
  const box = object(input.viewBox, ['width', 'height'], 'viewBox');
  const viewBox = Object.freeze({
    width: number(box.width, 1, 512, 'viewBox.width'),
    height: number(box.height, 1, 512, 'viewBox.height'),
  });
  const presentation = choice(input.presentation, ['object'] as const, 'symbols.presentation');
  const paths = array(input.paths, 32, 'paths').map(path);
  if (!paths.length) return invalid('paths');
  if (input.ports !== undefined && presentation !== 'object') return invalid('ports');
  const ports = input.ports === undefined ? undefined : readPorts(input.ports, viewBox);
  return Object.freeze({
    id: id(input.id, 'symbols.id'),
    ...(presentation === undefined ? {} : { presentation }),
    viewBox,
    paths: Object.freeze(paths),
    ...(ports === undefined ? {} : { ports }),
  });
}
const bindingKey=(value:Pick<DiagramSymbolBinding,'targetId'|'topologyId'|'subject'|'subjectId'>)=>JSON.stringify([value.targetId,value.topologyId,value.subject,value.subjectId]);

/** Admit passive geometry into a detached frozen copy; the library supplies no domain catalog. */
export function validateDiagramSymbolPack(value:unknown):DiagramSymbolPack {
  const input=object(value,['version','id','symbols','bindings'],'root');
  if(input.version!==1)return invalid('version');
  const symbols=array(input.symbols,32,'symbols').map(symbol),known=new Set<string>();
  for(const item of symbols){if(known.has(item.id))return invalid('symbols.id');known.add(item.id);}
  const seen=new Set<string>(),bindings=array(input.bindings,128,'bindings').map(value=>{
    const row=object(value,['targetId','topologyId','subject','subjectId','symbolId'],'bindings');
    const subject=choice(row.subject,['component','boundary']as const,'bindings.subject');if(!subject)return invalid('bindings.subject');
    const binding:DiagramSymbolBinding={targetId:id(row.targetId,'bindings.targetId'),topologyId:id(row.topologyId,'bindings.topologyId'),subject,
      subjectId:id(row.subjectId,'bindings.subjectId'),symbolId:id(row.symbolId,'bindings.symbolId')};
    const key=bindingKey(binding);if(seen.has(key)||!known.has(binding.symbolId))return invalid('bindings');seen.add(key);
    return Object.freeze(binding);
  });
  const admitted:DiagramSymbolPack=Object.freeze({version:1,id:id(input.id,'id'),symbols:Object.freeze(symbols),bindings:Object.freeze(bindings)});
  if(new TextEncoder().encode(JSON.stringify(admitted)).byteLength>65_536)return invalid('size');
  return admitted;
}

/** Exact registered object bindings only. Missing and foreign objects retain the normal viewer. */
export function createSystemSymbolAdapter(pack:unknown):SystemSymbolAdapter {
  const admitted=validateDiagramSymbolPack(pack),symbols=new Map(admitted.symbols.map(symbol=>[symbol.id,symbol]));
  const bindings=new Map(admitted.bindings.map(binding=>[bindingKey(binding),binding.symbolId]));
  return Object.freeze({resolve(view:SystemTopologyView,subject:SystemSymbolSubject){
    if(subject.kind!=='component'&&subject.kind!=='boundary')return;
    const rows=subject.kind==='component'?view.nodes:view.boundaries;if(!rows.some(row=>row.id===subject.id))return;
    const key=bindingKey({targetId:view.definition.binding.targetId,topologyId:view.definition.id,subject:subject.kind,subjectId:subject.id});
    const found=bindings.get(key);return found===undefined?undefined:symbols.get(found);
  }});
}
