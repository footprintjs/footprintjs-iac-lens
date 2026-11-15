/** Declarative local protocol admission; never invoke properties or accept executable host configuration. */
export function migrationRow(input:unknown,fields:readonly string[]):Record<string,unknown>{
  if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Object.getOwnPropertySymbols(input).length||Object.entries(Object.getOwnPropertyDescriptors(input)).some(([key,value])=>!fields.includes(key)||!value.enumerable||!('value'in value)))throw Error('Invalid migration data');
  return input as Record<string,unknown>;
}
export function migrationText(input:unknown,max=160):string {if(typeof input!=='string'||!input.trim()||input.length>max||/[\x00-\x1f\x7f]/.test(input))throw Error('Invalid migration label');return input;}
export function migrationId(input:unknown):string {const value=migrationText(input,128);if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)||['constructor','prototype','__proto__'].includes(value))throw Error('Choose a registered migration ID');return value;}
export function migrationDigest(input:unknown):string {const value=migrationText(input,64);if(!/^[a-f0-9]{64}$/.test(value))throw Error('Invalid migration digest');return value;}
export function migrationList(input:unknown,max:number):unknown[]{if(!Array.isArray(input)||input.length>max)throw Error('Invalid migration list');return input;}
export function migrationBool(input:unknown):boolean {if(typeof input!=='boolean')throw Error('Invalid migration flag');return input;}
export function migrationChoice<T extends string>(input:unknown,values:readonly T[]):T {if(!values.includes(input as T))throw Error('Invalid migration state');return input as T;}
export function migrationUnique<T>(values:T[],id:(value:T)=>string):T[]{if(new Set(values.map(id)).size!==values.length)throw Error('Duplicate migration identifier');return values;}
