import type { PipelineOptionValue } from './pipeline-types.ts';
export function row(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.getOwnPropertySymbols(input).length) throw Error('Invalid pipeline value');
  if (Object.entries(Object.getOwnPropertyDescriptors(input)).some(([key, value]) => !fields.includes(key) || !value.enumerable || !('value' in value))) throw Error('Unsupported pipeline field');
  return input as Record<string, unknown>;
}
export function label(input: unknown, max = 160): string {
  if (typeof input !== 'string' || !input.trim() || input.length > max || /[\x00-\x1f\x7f]/.test(input)) throw Error('Invalid pipeline label');
  return input;
}
export function id(input: unknown): string { const value = label(input, 128); if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)||['__proto__','constructor','prototype'].includes(value)) throw Error('Invalid registered ID'); return value; }
export function list(input: unknown, max = 128): unknown[] { if (!Array.isArray(input) || input.length > max) throw Error('Invalid pipeline list'); return input; }
export function bool(input: unknown): boolean { if (typeof input !== 'boolean') throw Error('Invalid pipeline flag'); return input; }
export function primitive(input: unknown): PipelineOptionValue {
  if (typeof input === 'boolean' || typeof input === 'number' && Number.isSafeInteger(input)) return input;
  return label(input, 128);
}
export function unique<T>(values: T[], key: (value:T)=>string): T[] { if (new Set(values.map(key)).size !== values.length) throw Error('Duplicate pipeline ID'); return values; }
export function ids(input: unknown): string[] { return unique(list(input).map(id),value=>value); }
export function hex(input: unknown): string { const value=label(input,64);if(!/^[a-f0-9]{64}$/.test(value))throw Error('Invalid pipeline digest');return value; }
export function optional<T>(input:unknown, read:(input:unknown)=>T):T|undefined{return input===undefined?undefined:read(input);}
export function choice<T extends string>(input:unknown, values:readonly T[]):T { if(!values.includes(input as T))throw Error('Invalid pipeline state');return input as T; }
