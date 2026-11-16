import { validateInfraGraph } from 'footprintjs-iac/graph';
import { readSystemDesign } from 'footprintjs-iac/system';
import { readDeploymentChart, readDeploymentSchedulePreview } from 'footprintjs-iac/progress';
import { applicationText, applicationUrl } from '../core/application.ts';
import { readApplicationSourceView } from '../core/application-source.ts';
import { readDashboardState } from '../core/client.ts';
import { readSystemViewDefinition } from '../core/capabilities.ts';
import { readChangeAssessmentView } from '../core/change-assessment.ts';
import { projectNativeDeploymentChart } from '../core/native-deployment-chart.ts';
import type { DashboardState } from '../core/types.ts';
import type { ApplicationPublication } from './application-host.ts';

const fields = ['graph', 'design', 'binding', 'schedulePreview', 'run', 'recording', 'connections', 'identity', 'artifacts', 'target', 'systemView', 'changeAssessment', 'neoUrl', 'appAccess', 'source', 'phase'];
function fail(): never { throw Error('Invalid application publication'); }
function object(input: unknown, allowed?: readonly string[]): Record<string, any> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const row = input as Record<string, any>; if (allowed && Object.keys(row).some(key => !allowed.includes(key))) fail(); return row;
}
function array(input: unknown, maximum = 4096): any[] { if (!Array.isArray(input) || input.length > maximum) fail(); return input; }
function text(input: unknown, maximum = 2048): string { return applicationText(input, maximum); }
function optionalText(input: unknown, maximum = 2048): void { if (input !== undefined) text(input, maximum); }
function digest(input: unknown): void { if (typeof input !== 'string' || !/^[a-f0-9]{64}$/.test(input)) fail(); }
function strings(input: unknown): string[] { const rows = array(input).map(value => text(value)); if (new Set(rows).size !== rows.length) fail(); return rows; }
function time(input: unknown): void { if (input !== undefined && !(typeof input === 'number' && Number.isFinite(input)) && !(typeof input === 'string' && input.length <= 100)) fail(); }
/** Bound and detach arbitrary native JSON without invoking accessors or accepting functions/classes. */
function copy(input: unknown): any {
  let count = 0;
  function visit(value: unknown, depth: number): any {
    if (++count > 500000 || depth > 256) fail();
    if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail(); return value; }
    if (!value || typeof value !== 'object' || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) fail();
    const result: Record<string, any> = {}, descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, entry] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (!entry.enumerable || !('value' in entry)) fail();
      Object.defineProperty(result, key, { value: visit(entry.value, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    if (!Array.isArray(value)) return result;
    const keys = Object.keys(result); if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) fail();
    return keys.map(key => result[key]);
  }
  return visit(input, 0);
}
function recording(input: unknown): void {
  const row = object(input, ['snapshot', 'structure', 'narrativeEntries', 'provenance', 'controlDeps']);
  const snapshot = object(row.snapshot); text(snapshot.runId, 512); object(row.structure);
  if (snapshot.commitLog !== undefined) array(snapshot.commitLog, 100000);
  if (row.narrativeEntries !== undefined) array(row.narrativeEntries, 100000);
  if (row.controlDeps !== undefined) object(row.controlDeps);
  if (row.provenance !== undefined) {
    const provenance = object(row.provenance, ['runId', 'stack', 'graphDigest']); text(provenance.runId, 512);
    optionalText(provenance.stack); if (provenance.graphDigest !== undefined) digest(provenance.graphDigest);
  }
}
function binding(input: unknown): void {
  const row = object(input, ['kind', 'version', 'profileId', 'targetId', 'target', 'designDigest', 'graph', 'decisions', 'mappings', 'digest']);
  if (row.kind !== 'system-binding' || row.version !== 1) fail();
  text(row.profileId); text(row.targetId); digest(row.designDigest); digest(row.digest);
  const target = object(row.target, ['id', 'properties']); if (text(target.id) !== row.targetId) fail(); if (target.properties !== undefined) object(target.properties);
  const graph = validateInfraGraph(row.graph), ids = new Set(graph.resources.map(resource => resource.id));
  for (const input of array(row.decisions)) {
    const decision = object(input, ['capabilityId', 'capabilityPath', 'adapterId', 'ruleId', 'targetId', 'mode', 'status', 'reason', 'requirements', 'defaults', 'candidates']);
    for (const key of ['capabilityId', 'capabilityPath', 'adapterId', 'ruleId', 'targetId', 'reason']) text(decision[key], 4000);
    if (!['simulation', 'real'].includes(decision.mode) || !['simulated', 'implemented'].includes(decision.status)) fail();
    const defaults = object(decision.defaults); for (const value of Object.values(defaults)) if (typeof value !== 'string') fail();
    for (const input of array(decision.requirements)) {
      const requirement = object(input, ['property', 'requested', 'status', 'reason']); text(requirement.property); text(requirement.reason, 4000);
      if (!('requested' in requirement) || !['simulated', 'implemented'].includes(requirement.status)) fail();
    }
    for (const input of array(decision.candidates)) {
      const candidate = object(input, ['ruleId', 'matched', 'reason']); text(candidate.ruleId); text(candidate.reason, 4000); if (typeof candidate.matched !== 'boolean') fail();
    }
  }
  for (const input of array(row.mappings)) {
    const mapping = object(input, ['capabilityId', 'capabilityPath', 'adapterId', 'targetId', 'mode', 'resourceIds', 'entryPoints', 'exitPoints', 'groupId']);
    for (const key of ['capabilityId', 'capabilityPath', 'adapterId', 'targetId', 'groupId']) text(mapping[key]);
    if (!['simulation', 'real'].includes(mapping.mode)) fail();
    for (const key of ['resourceIds', 'entryPoints', 'exitPoints']) if (strings(mapping[key]).some(id => !ids.has(id))) fail();
  }
}
/** Native recorder fields are retained, but they may never be spliced across runs. */
function progressProvenance(row: Record<string, any>, runId: string, resourceId?: string): void {
  if (row.version === undefined && row.runId === undefined) return;
  if (row.version !== 1 || text(row.runId, 512) !== runId || !runId
    || !Number.isSafeInteger(row.sequence) || row.sequence < 1
    // Live recorder events carry time. Native commit replay retains ordering/stage
    // but has no timestamp, so an absent value must remain absent.
    || (row.timestamp !== undefined && (typeof row.timestamp !== 'number' || !Number.isFinite(row.timestamp)))
    || !['pending', 'deploying', 'ready', 'failed', 'skipped', 'deleted'].includes(row.status)
    || !['create', 'update', 'verify', 'delete', 'noop'].includes(row.action)) fail();
  text(row.resourceId); text(row.runtimeStageId);
  if (resourceId !== undefined && row.resourceId !== resourceId) fail();
}
function run(input: unknown): void {
  const row = object(input, ['id', 'status', 'mode', 'startedAt', 'finishedAt', 'resources', 'events', 'recording', 'chart', 'report']);
  if (typeof row.id !== 'string' || row.id.length > 512 || !['idle', 'running', 'passed', 'failed'].includes(row.status)) fail();
  if (row.mode !== undefined && !['simulator', 'kubernetes', 'managed'].includes(row.mode)) fail();
  time(row.startedAt); time(row.finishedAt);
  const statuses = ['pending', 'deploying', 'ready', 'failed', 'skipped', 'deleted'];
  for (const input of array(row.resources)) {
    const resource = object(input, ['id', 'resourceId', 'status', 'action', 'message', 'timestamp', 'runtimeStageId', 'version', 'runId', 'sequence']);
    text(resource.id); if (!statuses.includes(resource.status)) fail();
    for (const key of ['resourceId', 'action', 'message', 'runtimeStageId']) optionalText(resource[key], 4000); time(resource.timestamp);
    if (resource.sequence !== undefined && (!Number.isSafeInteger(resource.sequence) || resource.sequence < 0)) fail();
    progressProvenance(resource, row.id, resource.id);
  }
  for (const input of array(row.events, 100000)) {
    const event = object(input, ['resourceId', 'status', 'action', 'message', 'timestamp', 'runtimeStageId', 'sequence', 'seq', 'version', 'runId']);
    if (event.status !== undefined && !statuses.includes(event.status)) fail();
    for (const key of ['resourceId', 'action', 'message', 'runtimeStageId']) optionalText(event[key], 4000); time(event.timestamp);
    for (const key of ['sequence', 'seq']) if (event[key] !== undefined && (!Number.isSafeInteger(event[key]) || event[key] < 0)) fail();
    progressProvenance(event, row.id);
  }
  if (row.recording !== undefined) recording(row.recording);
  if (row.chart !== undefined) readDeploymentChart(row.chart);
  if (row.report !== undefined) object(row.report);
}
function observedRun(input: unknown, identity: boolean): void {
  const row = object(input, ['id', 'status', 'label', ...(identity ? [] : ['scopeDescription']), 'checks', 'events', 'checkedAt', 'recording', 'report']);
  text(row.id); if (!['idle', 'checking', 'passed', 'failed'].includes(row.status)) fail();
  if (identity) text(row.label); else optionalText(row.label);
  optionalText(row.scopeDescription); time(row.checkedAt);
  const checkFields = identity ? ['checkId', 'label', 'kind', 'resourceIds', 'expected', 'status', 'timestamp', 'runtimeStageId', 'observation', 'message']
    : ['connectionId', 'from', 'to', 'status', 'scopeDescription', 'timestamp', 'message', 'runtimeStageId', 'observation', 'details'];
  for (const [event, inputs] of [[false, array(row.checks)], [true, array(row.events, 100000)]] as const) for (const input of inputs) {
    const check = object(input, [...checkFields, ...(event ? ['version', 'runId', 'sequence'] : [])]);
    const statuses = identity ? ['untested', 'checking', 'passed', 'failed'] : ['untested', 'checking', 'connected', 'failed'];
    if (!statuses.includes(check.status) || (event && (check.status === 'untested' || check.version !== 1 || !Number.isSafeInteger(check.sequence) || check.sequence < 0))) fail();
    if (event) text(check.runId, 512);
    optionalText(check.message, 4000); optionalText(check.runtimeStageId); time(check.timestamp);
    if (identity) {
      text(check.checkId); text(check.label); if (!['login', 'access', 'directory'].includes(check.kind)) fail();
      const verdicts = ['authenticated', 'rejected', 'allowed', 'denied', 'available', 'unavailable'];
      if (!verdicts.includes(check.expected) || check.expected === 'unavailable') fail();
      if (check.resourceIds !== undefined) strings(check.resourceIds);
      if (check.observation !== undefined) {
        const observation = object(check.observation, ['verdict', 'observedAt', 'latencyMs', 'details']);
        if (!verdicts.includes(observation.verdict) || (check.status === 'passed' && observation.verdict !== check.expected)) fail();
        measured(observation);
        if (observation.details !== undefined) {
          const details = object(observation.details, ['code', 'httpStatus', 'sourceId', 'subjectId', 'policyId', 'matchedRuleIds', 'action', 'resource', 'protocol', 'phase']);
          for (const key of ['code', 'sourceId', 'subjectId', 'policyId', 'action', 'resource']) optionalText(details[key]);
          if (details.httpStatus !== undefined && (!Number.isSafeInteger(details.httpStatus) || details.httpStatus < 0 || details.httpStatus > 599)) fail();
          if (details.matchedRuleIds !== undefined) strings(details.matchedRuleIds);
          if (details.protocol !== undefined && !['ldap', 'ldaps', 'oidc', 'http', 'https'].includes(details.protocol)) fail();
          if (details.phase !== undefined && !['directory', 'authentication', 'authorization', 'transport'].includes(details.phase)) fail();
        }
      } else if (check.status === 'passed') fail();
    } else {
      for (const key of ['connectionId', 'from', 'to']) text(check[key]); optionalText(check.scopeDescription);
      if (check.details !== undefined) object(check.details);
      if (check.observation !== undefined) {
        const observation = object(check.observation, ['method', 'target', 'observedAt', 'latencyMs', 'details']);
        text(observation.method); text(observation.target); measured(observation); object(observation.details);
      }
    }
  }
  if (row.recording !== undefined) recording(row.recording);
  if (row.report !== undefined) object(row.report, ['evidencePath', 'tracePath', 'error', 'captureError', 'traceStatus']);
}
function measured(observation: Record<string, any>): void {
  if (typeof observation.observedAt !== 'number' || !Number.isFinite(observation.observedAt)
    || typeof observation.latencyMs !== 'number' || !Number.isFinite(observation.latencyMs) || observation.latencyMs < 0) fail();
}
/** Shape admission is separate from the registered host's native evidence verification. */
export function readApplicationPublication(input: unknown, current?: DashboardState): ApplicationPublication {
  const row = object(copy(input), fields);
  if (row.phase !== undefined && row.phase !== 'verify') fail();
  if (row.source !== undefined) row.source = readApplicationSourceView(row.source);
  if (row.graph !== undefined && row.graph !== null) row.graph = validateInfraGraph(row.graph);
  if (row.design !== undefined) row.design = readSystemDesign(row.design);
  if (row.binding !== undefined) binding(row.binding);
  if (row.recording !== undefined) recording(row.recording);
  if (row.run !== undefined) run(row.run);
  if (row.connections !== undefined) observedRun(row.connections, false);
  if (row.identity !== undefined) observedRun(row.identity, true);
  if (row.systemView !== undefined) row.systemView = readSystemViewDefinition(row.systemView);
  if (row.schedulePreview !== undefined) row.schedulePreview = readDeploymentSchedulePreview(row.schedulePreview);
  if (row.changeAssessment !== undefined) { row.changeAssessment = readChangeAssessmentView(row.changeAssessment); if (row.changeAssessment.recording) recording(row.changeAssessment.recording); }
  if (row.neoUrl !== undefined) applicationUrl(row.neoUrl);
  if (row.appAccess !== undefined) {
    const access = object(row.appAccess, ['status', 'checkedAt', 'message']);
    if (!['checking', 'ready', 'failed'].includes(access.status)) fail(); optionalText(access.checkedAt, 100); optionalText(access.message, 4000);
  }
  if (row.target !== undefined) {
    const target = object(row.target, ['id', 'context', 'namespace', 'label']);
    for (const key of ['id', 'context', 'namespace', 'label']) optionalText(target[key], 256);
  }
  if (row.artifacts !== undefined) {
    let bytes = 0; const ids = new Set<string>();
    for (const input of array(row.artifacts, 256)) {
      const artifact = object(input, ['id', 'path', 'content', 'mediaType', 'target', 'sha256']);
      const id = text(artifact.id); if (ids.has(id)) fail(); ids.add(id); text(artifact.path);
      if (typeof artifact.content !== 'string' || (bytes += Buffer.byteLength(artifact.content)) > 16 * 1024 * 1024) fail();
      optionalText(artifact.mediaType, 256); optionalText(artifact.target); if (artifact.sha256 !== undefined) digest(artifact.sha256);
    }
  }
  const context: DashboardState = { revision: 0, busy: false, graph: null, ...current, ...row };
  if (row.binding !== undefined && ((context.graph && row.binding.graph.digest !== context.graph.digest) || (context.design && row.binding.designDigest !== context.design.digest))) fail();
  if (current || row.graph !== undefined) {
    // A detached publication has no authority to choose an application. Its source
    // shape is admitted above; ownership is checked when attached to the real view.
    readDashboardState(current ? context : { ...context, source: undefined });
    if (context.run?.chart !== undefined && !projectNativeDeploymentChart(context).chart) fail();
    const provenance = context.run?.recording?.provenance;
    if (provenance && (provenance.runId !== context.run!.id || (provenance.graphDigest !== undefined && provenance.graphDigest !== context.graph?.digest)
      || (provenance.stack !== undefined && provenance.stack !== context.graph?.name))) fail();
  }
  return row as ApplicationPublication;
}
