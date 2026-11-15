import type { ConnectionAdapterSchema, ConnectionProfileRegistration, ConnectionProfileTestResult } from 'footprintjs-iac/connection-profiles';
import { CONNECTION_PROFILE_CAPACITY } from 'footprintjs-iac/connection-profiles/limits';
export { CONNECTION_PROFILE_CAPACITY };

export type { ConnectionAdapterSchema, ConnectionProfileRegistration, ConnectionProfileTestResult };
export interface ConnectionProfileSummary { id: string; label: string; adapterId: string; revision: number; config: Record<string, string> }
export interface ConnectionProfilesView {
  schemas: readonly ConnectionAdapterSchema[]; profiles: readonly ConnectionProfileSummary[];
  busy: boolean; requiredAtStart: boolean; lastTest?: ConnectionProfileTestResult;
}
export type ConnectionProfileAction = { action: 'register'; registration: ConnectionProfileRegistration } | { action: 'test'; profileId: string };
export type ConnectionProfileActionResult = { action: 'register'; profile: ConnectionProfileSummary } | { action: 'test'; result: ConnectionProfileTestResult };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string')
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(field => !('value' in field) || !field.enumerable)) throw Error('Invalid connection data');
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, fields: string[]) { if (Object.keys(value).some(key => !fields.includes(key))) throw Error('Unexpected connection field'); }
function text(value: unknown, maximum = 4096): string {
  if (typeof value !== 'string' || value.length > maximum) throw Error('Invalid connection field'); return value;
}
export function connectionProfileId(value: unknown): string {
  const id = text(value, 200); if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw Error('Invalid connection profile ID'); return id;
}
function values(value: unknown): Record<string, string> {
  const row = object(value); if (Object.keys(row).length > 32) throw Error('Too many connection fields');
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [connectionProfileId(key), text(value)]));
}
export function readConnectionProfileAction(value: unknown): ConnectionProfileAction {
  const row = object(value);
  if (row.action === 'test') { only(row, ['action', 'profileId']); return { action: 'test', profileId: connectionProfileId(row.profileId) }; }
  if (row.action !== 'register') throw Error('Choose a connection action');
  only(row, ['action', 'registration']); const registration = object(row.registration);
  only(registration, ['label', 'adapterId', 'config', 'secrets']);
  const label = text(registration.label, 160).trim(); if (!label || /[\x00-\x1f\x7f]/.test(label)) throw Error('Name this connection');
  return { action: 'register', registration: { label, adapterId: connectionProfileId(registration.adapterId), config: values(registration.config), secrets: values(registration.secrets) } };
}
export function readConnectionProfileSummary(value: unknown, schemas: readonly ConnectionAdapterSchema[]): ConnectionProfileSummary {
  const row = object(value); const adapterId = connectionProfileId(row.adapterId), schema = schemas.find(schema => schema.id === adapterId);
  if (!schema || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1) throw Error('Invalid saved connection');
  const config = values(row.config);
  if (Object.keys(config).some(key => !schema.fields.some(field => field.name === key && !field.secret && field.kind !== 'password'))) throw Error('A saved connection contains a private or undeclared field');
  return { id: connectionProfileId(row.id), label: text(row.label, 160), adapterId, revision: row.revision as number, config };
}
export function readConnectionProfilesView(value: unknown): ConnectionProfilesView {
  const row = object(value); only(row, ['schemas', 'profiles', 'busy', 'requiredAtStart', 'lastTest']);
  if (!Array.isArray(row.schemas) || row.schemas.length > 32 || !Array.isArray(row.profiles) || row.profiles.length > CONNECTION_PROFILE_CAPACITY
    || typeof row.busy !== 'boolean' || typeof row.requiredAtStart !== 'boolean') throw Error('Invalid connection catalog');
  const schemas = row.schemas.map(value => {
    const schema = object(value); only(schema, ['id', 'label', 'description', 'fields']);
    if (!Array.isArray(schema.fields) || schema.fields.length > 32) throw Error('Invalid connection fields');
    const fields = schema.fields.map(value => {
      const field = object(value); only(field, ['name', 'label', 'kind', 'required', 'secret', 'description']);
      if ((typeof field.kind !== 'string' || !['text', 'url', 'integer', 'password'].includes(field.kind)) || (field.required !== undefined && typeof field.required !== 'boolean')
        || (field.secret !== undefined && typeof field.secret !== 'boolean')) throw Error('Invalid connection field schema');
      return { name: connectionProfileId(field.name), label: text(field.label, 512), kind: field.kind,
        ...(field.required !== undefined ? { required: field.required } : {}), ...(field.secret !== undefined ? { secret: field.secret } : {}),
        ...(field.description !== undefined ? { description: text(field.description, 2000) } : {}) };
    });
    if (new Set(fields.map(field => field.name)).size !== fields.length) throw Error('Duplicate connection field');
    return { id: connectionProfileId(schema.id), label: text(schema.label, 512), fields,
      ...(schema.description !== undefined ? { description: text(schema.description, 2000) } : {}) } as ConnectionAdapterSchema;
  });
  if (new Set(schemas.map(schema => schema.id)).size !== schemas.length) throw Error('Duplicate connection adapter');
  const profiles = row.profiles.map(profile => readConnectionProfileSummary(profile, schemas));
  if (new Set(profiles.map(profile => profile.id)).size !== profiles.length) throw Error('Duplicate connection profile');
  const lastTest = row.lastTest === undefined ? undefined : readConnectionProfileTestResult(row.lastTest);
  if (lastTest && !profiles.some(profile => profile.id === lastTest.profileId)) throw Error('Unknown tested profile');
  return { schemas, profiles, busy: row.busy, requiredAtStart: row.requiredAtStart, ...(lastTest ? { lastTest } : {}) };
}
export function readConnectionProfileTestResult(value: unknown): ConnectionProfileTestResult {
  const row = object(value); only(row, ['profileId', 'ok', 'code']);
  if (typeof row.ok !== 'boolean' || (row.code !== undefined && (typeof row.code !== 'string' || !['connection-check-failed', 'connection-check-unavailable'].includes(row.code)))) throw Error('Invalid connection test result');
  return { profileId: connectionProfileId(row.profileId), ok: row.ok, ...(row.code ? { code: row.code as 'connection-check-failed' | 'connection-check-unavailable' } : {}) };
}
