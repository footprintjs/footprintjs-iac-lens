import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadEvidence, type ApplyResult, type InfraGraph } from 'footprint-iac';
import { loadIdentityTarget, neoIdentityCheckAdapter, neoIdentityChecks } from 'footprint-iac/integration/identity';
import { startDashboard } from '../src/server/server.ts';
import type { DashboardRun, ProgressEvent } from '../src/core/types.ts';

const target = await loadIdentityTarget(process.argv[2]);
const deployment = JSON.parse(await readFile(join(target.directory, 'deployment.json'), 'utf8')) as {
  graph: InfraGraph; result: ApplyResult; events: ProgressEvent[];
};
if (!deployment.result.ok) throw new Error('Deploy the Neo identity fixture successfully before opening Lens');
const evidence = await loadEvidence(deployment.result.evidencePath);
const run: DashboardRun = { id: deployment.result.runId, status: 'passed', mode: 'kubernetes',
  resources: deployment.graph.resources.map(resource => ({ id: resource.id, resourceId: resource.id, status: 'ready',
    action: deployment.result.plan.operations.find(operation => operation.resource.id === resource.id)?.action })),
  events: deployment.events, report: deployment.result,
  recording: { snapshot: evidence.snapshot, structure: evidence.structure, narrativeEntries: Array.isArray(evidence.narrative) ? evidence.narrative : [] } };
const directory = join(target.directory, 'lens');
const app = await startDashboard({ directory, staticDirectory: resolve(import.meta.dirname, '../dist/web'), port: 15237,
  initialReview: { graph: deployment.graph, run, neoUrl: `http://127.0.0.1:${target.neoPort}/?test`,
    target: { context: target.context, namespace: target.namespace, label: 'Local Neo with LDAP-backed identity and access policy' } },
  identityReview: { stack: deployment.graph.name, label: 'Real LDAP login and Neo access checks', checks: neoIdentityChecks,
    adapter: await neoIdentityCheckAdapter(target) } });
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(join(directory, 'server.json'), JSON.stringify({ pid: process.pid, url: app.url, directory,
  context: target.context, namespace: target.namespace, createdAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
console.log('IaC Lens: ' + app.url);
console.log('Neo: ' + `http://127.0.0.1:${target.neoPort}/?test`);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
