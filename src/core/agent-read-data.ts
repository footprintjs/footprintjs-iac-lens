import type { AgentStatus } from './agent-platform.ts';
export function fail(): never { throw Error('Invalid agent platform observation'); }
export function row(input: unknown, keys: readonly string[]): Record<string, any> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.getOwnPropertySymbols(input).length) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.entries(descriptors).some(([key, value]) => !keys.includes(key) || !value.enumerable || !('value' in value))) fail();
  return input as Record<string, any>;
}
export function text(input: unknown, max = 256): string {
  if (typeof input !== 'string' || !input.trim() || input.length > max || /[\x00-\x1f\x7f]/.test(input)) fail(); return input;
}
export function id(input: unknown): string { const value = text(input); if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) fail(); return value; }
export function hex(input: unknown): string { const value = text(input, 64); if (!/^[a-f0-9]{64}$/.test(value)) fail(); return value; }
export function list<T>(input: unknown, max: number, read: (input: unknown) => T): T[] { if (!Array.isArray(input) || input.length > max) fail(); return input.map(read); }
export function unique<T extends { id: string }>(values: T[]): T[] { if (new Set(values.map(value => value.id)).size !== values.length) fail(); return values; }
export function flag(input: unknown): boolean { if (typeof input !== 'boolean') fail(); return input; }
export function status(input: unknown): AgentStatus { if (!['pending', 'running', 'ready', 'failed', 'paused', 'incomplete', 'unknown', 'unsupported'].includes(input as string)) fail(); return input as AgentStatus; }
export const optionalText = (value: unknown, key: string, max = 256) => value === undefined ? {} : { [key]: text(value, max) };
