import { readRecordedDependencyResult, type RecordedDependencyResult } from 'footprintjs-iac/diagnostics/recorded';
export type { RecordedDependencyResult };
export const DIAGNOSTIC_HISTORY_LIMIT = 12;
export type DiagnosticKind = 'connections' | 'identity' | 'deployment' | 'workflow' | 'action';
export type DiagnosticFact = { code: 'status' | 'verdict' | 'http-status' | 'latency-ms' | 'operation' | 'reason'; value: string | number };
export interface DiagnosticTarget {
  id: string; key: string; label: string; outcome: 'passed' | 'failed' | 'unknown'; facts: readonly DiagnosticFact[];
  trace?: RecordedDependencyResult;
}
export interface DiagnosticRun {
  id: string; runId: string; runtimeRunId: string | null; kind: DiagnosticKind; label: string;
  outcome: 'passed' | 'failed'; sequence: number; targets: readonly DiagnosticTarget[]; limitations: readonly string[];
  configurationVersion?: DiagnosticConfigurationVersion;
}
export interface DiagnosticConfigurationVersion {
  registryId: string; versionId: string; head: number; configurationDigest: string; releaseDigest: string;
  association: 'admitted-registry-head' | 'matched-legacy-binding';
}
export interface RecordedDiagnostics { version: 1; binding: string; runs: readonly DiagnosticRun[]; omitted: number; limitations?: readonly string[]; persistenceError?: string }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string') || Object.values(Object.getOwnPropertyDescriptors(value)).some(field => !('value' in field) || !field.enumerable)) throw Error('Invalid recorded diagnostic history');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 4096): string { if (typeof value !== 'string' || value.length > max) throw Error('Invalid diagnostic text'); return value; }
function count(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw Error('Invalid diagnostic count'); return value as number; }
function list(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) throw Error('Invalid diagnostic list'); return value; }
export function readDiagnosticConfigurationVersion(input: unknown): DiagnosticConfigurationVersion {
  const value = object(input);
  if (Object.keys(value).some(key => !['registryId', 'versionId', 'head', 'configurationDigest', 'releaseDigest', 'association'].includes(key))) throw Error('Invalid diagnostic version fields');
  for (const key of ['registryId', 'versionId']) if (typeof value[key] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value[key] as string) || ['__proto__', 'constructor', 'prototype'].includes(value[key] as string)) throw Error('Invalid diagnostic version ID');
  for (const key of ['configurationDigest', 'releaseDigest']) if (typeof value[key] !== 'string' || !/^(?:sha256:)?[a-f0-9]{64}$/.test(value[key] as string)) throw Error('Invalid diagnostic version digest');
  count(value.head); if (typeof value.association !== 'string' || !['admitted-registry-head', 'matched-legacy-binding'].includes(value.association)) throw Error('Declare the diagnostic version association');
  return { registryId: value.registryId as string, versionId: value.versionId as string, head: value.head as number, configurationDigest: value.configurationDigest as string, releaseDigest: value.releaseDigest as string, association: value.association as DiagnosticConfigurationVersion['association'] };
}
const statuses = new Set(['passed','failed','connected','ready','pending','deploying','checking','untested','skipped','deleted','idle','running','paused','incomplete']);
const verdicts = new Set(['authenticated','rejected','allowed','denied','available','unavailable']);
const operations = new Set(['create','update','delete','noop','no-op','find','verify','check','read','observe']);
const reasons = new Set(['verified','invalid-credentials','anonymous','access-allowed','access-denied','directory-unavailable','identity-unavailable',
  'transport-failure','tls-error','connection-refused','provider-unavailable','backend-error','invalid-observation','adapter-failure',
  'federated-login-failed','jwks-probe-failed']);
export function readDiagnosticFact(value: unknown): DiagnosticFact {
  const row = object(value);
  if (Object.keys(row).some(key => !['code','value'].includes(key))) throw Error('Invalid diagnostic fact');
  if (row.code === 'http-status' && typeof row.value === 'number' && Number.isInteger(row.value) && row.value >= 100 && row.value <= 599) return { code: row.code, value: row.value };
  if (row.code === 'latency-ms' && typeof row.value === 'number' && Number.isFinite(row.value) && row.value >= 0 && row.value <= 86_400_000) return { code: row.code, value: row.value };
  if (typeof row.value === 'string' && ((row.code === 'status' && statuses.has(row.value)) || (row.code === 'verdict' && verdicts.has(row.value))
    || (row.code === 'operation' && operations.has(row.value)) || (row.code === 'reason' && reasons.has(row.value)))) return { code: row.code, value: row.value };
  throw Error('Diagnostic values must use the approved fact fields');
}
export function readRecordedDiagnostics(value: unknown): RecordedDiagnostics {
  const row = object(value);
  if (row.version !== 1 || typeof row.binding !== 'string' || !/^[a-f0-9]{64}$/.test(row.binding)) throw Error('Invalid diagnostic history binding');
  const runs = list(row.runs, DIAGNOSTIC_HISTORY_LIMIT).map(value => {
    const run = object(value), runId = text(run.runId, 200), runtimeRunId = run.runtimeRunId === null ? null : text(run.runtimeRunId, 200);
    if (typeof run.kind !== 'string' || !['connections','identity','deployment','workflow','action'].includes(run.kind)
      || typeof run.outcome !== 'string' || !['passed','failed'].includes(run.outcome)) throw Error('Invalid diagnostic run');
    const targets = list(run.targets, 16).map(value => {
      const target = object(value), key = text(target.key);
      if (typeof target.outcome !== 'string' || !['passed','failed','unknown'].includes(target.outcome)) throw Error('Invalid diagnostic outcome');
      const trace = target.trace === undefined ? undefined : readRecordedDependencyResult(target.trace);
      if (trace && (trace.key !== key || trace.runId !== runtimeRunId && !(trace.status === 'unavailable' && trace.runId === null))) throw Error('The diagnostic belongs to another native recording');
      return { id: text(target.id, 200), key, label: text(target.label, 400), outcome: target.outcome as DiagnosticTarget['outcome'],
        facts: list(target.facts, 8).map(readDiagnosticFact), ...(trace ? { trace } : {}) };
    });
    if (new Set(targets.map(target => target.id)).size !== targets.length) throw Error('Duplicate diagnostic target');
    return { id: text(run.id, 240), runId, runtimeRunId, kind: run.kind as DiagnosticKind, label: text(run.label, 200), outcome: run.outcome as DiagnosticRun['outcome'],
      sequence: count(run.sequence), targets, limitations: list(run.limitations, 16).map(value => text(value, 1000)),
      ...(run.configurationVersion !== undefined ? { configurationVersion: readDiagnosticConfigurationVersion(run.configurationVersion) } : {}) };
  });
  if (new Set(runs.map(run => run.id)).size !== runs.length) throw Error('Duplicate diagnostic run');
  return { version: 1, binding: row.binding, runs, omitted: count(row.omitted),
    ...(row.limitations !== undefined ? { limitations: list(row.limitations, 8).map(value => text(value,1000)) } : {}),
    ...(row.persistenceError !== undefined ? { persistenceError: 'Diagnostic history could not be saved. Earlier native recordings remain authoritative.' } : {}) };
}
