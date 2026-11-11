import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FileStateStore } from 'footprint-iac';
import { createIdentityGraph, identityEngine, loadIdentityTarget, neoIdentityCheckAdapter,
  neoIdentityChecks, neoIdentityConnectionAdapter, type IdentityTarget } from 'footprint-iac/integration/identity';
import type { SystemBlockDefinition, SystemViewDefinition } from '../src/core/index.ts';
import { startDashboard } from '../src/server/index.ts';

const [selected, ...args] = process.argv.slice(2);
const stages = args.filter(value => value === '--identity-only' || value === '--full');
const ports = args.filter(value => /^--port=\d+$/.test(value));
if (!selected || stages.length !== 1 || ports.length > 1
  || args.some(value => value !== '--identity-only' && value !== '--full' && !/^--port=\d+$/.test(value))) {
  throw Error('Usage: node examples/neo-identity-live.ts /printed/target.json --identity-only|--full [--port=15238]');
}
const port = ports.length ? Number(ports[0]!.slice('--port='.length)) : 0;
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Choose a valid local viewer port');
const target = await loadIdentityTarget(resolve(selected));
if (resolve(selected) !== join(target.directory, 'target.json')) throw Error('Pin the printed identity target.json path for this review');
const includeNeo = stages[0] === '--full';
const graph = createIdentityGraph(target, { includeNeo });
const { engine, recorder } = identityEngine(target);
const directory = join(target.directory, includeNeo ? 'lens-live-app' : 'lens-live-identity');

/** This observed address is a separate trusted host binding between the two deployment stages. */
async function observeProviderAddress(): Promise<void> {
  const inventory = await new FileStateStore(target.stateDirectory).load(graph.name);
  const id = inventory.resources['identity-provider']?.physicalId;
  if (!id || !/^[a-f0-9]{64}$/.test(id)) throw Error('The provider has no owned physical identity in durable inventory');
  const format = '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"address":{{json (index .NetworkSettings.Networks "kind").IPAddress}}}';
  const observed = JSON.parse(execFileSync('docker', ['inspect', '--format', format, id],
    { encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024 })) as { id: string; name: string; running: boolean; address: string };
  if (observed.id !== id || observed.name !== '/' + target.providerName || !observed.running
    || !/^\d+\.\d+\.\d+\.\d+$/.test(observed.address)) throw Error('The observed provider address does not match owned inventory');
  target.providerAddress = observed.address;
  await writeFile(join(target.directory, 'provider-address.json'), JSON.stringify({ ...observed, observedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  await writeFile(join(target.directory, 'target.json'), JSON.stringify(target, null, 2) + '\n', { mode: 0o600 });
  const latestPath = join(target.directory, '../latest.json');
  const latest = JSON.parse(await readFile(latestPath, 'utf8')) as { id?: string };
  if (latest.id === target.id) await writeFile(latestPath, JSON.stringify(target, null, 2) + '\n', { mode: 0o600 });
}

function systemView(target: IdentityTarget, full: boolean): SystemViewDefinition {
  const blocks: SystemBlockDefinition[] = [
    { id: 'placement', label: 'Placement and isolation', family: 'other', units: [
      { id: 'prepared-cluster', label: 'Prepared local cluster', mode: 'existing', resourceIds: [],
        description: 'Existing cluster; this review creates no new cluster and preserves other applications.' },
      ...(full ? [{ id: 'namespace', label: 'Application namespace', resourceIds: ['neo-namespace'], description: target.namespace }] : []),
    ] },
    { id: 'identity', label: 'Identity and access', family: 'identity', units: [
      { id: 'directory', label: 'Directory', resourceIds: ['identity-directory'], description: 'LDAP directory adapter with validated TLS.' },
      { id: 'broker', label: 'Sign-in provider', resourceIds: ['identity-provider'], description: 'OIDC broker backed by the directory.' },
      ...(full ? [{ id: 'policy', label: 'Permission policy configuration', resourceIds: ['neo-access-policy', 'neo-app'],
        description: 'Mounted policy configuration; allowed and denied behavior is measured separately.' }] : []),
    ] },
  ];
  if (full) blocks.push(
    { id: 'compute', label: 'Compute', family: 'compute', units: [
      { id: 'application', label: 'Neo application', mode: 'embedded', resourceIds: ['neo-app'], description: 'Application container in the managed Deployment.' },
      { id: 'collector', label: 'Collector tools', mode: 'embedded', resourceIds: ['neo-app'], description: 'Same-Pod tool container; listens only on loopback.' },
    ] },
    { id: 'storage', label: 'Storage', family: 'storage', units: [
      { id: 'seeded-data', label: 'Local seeded data', mode: 'embedded', resourceIds: ['neo-app'], description: 'SQLite fixture inside the Pod; no persistent volume is provisioned.' },
      { id: 'session-state', label: 'Session state', mode: 'embedded', resourceIds: ['neo-app'], description: 'In-process test session state; restart persistence is not claimed.' },
    ] },
    { id: 'network', label: 'Network', family: 'network', units: [
      { id: 'service', label: 'Application service', resourceIds: ['neo-service'], description: 'Managed private Service. Connection health is separate from resource readiness.' },
    ] },
  );
  return { blocks };
}

const app = await startDashboard({ directory, staticDirectory: resolve(import.meta.dirname, '../dist/web'), port,
  systemView: systemView(target, includeNeo),
  managedReview: { graph, recorder, mode: 'managed', label: includeNeo ? 'Deploy protected Neo' : 'Bootstrap identity services',
    target: { id: target.id, context: target.context, namespace: target.namespace, label: includeNeo ? 'Local Neo identity fixture' : 'Local directory and sign-in provider' },
    ...(includeNeo ? { neoUrl: `http://127.0.0.1:${target.neoPort}/?test` } : {}),
    async apply() {
      const result = await engine.apply(graph);
      await writeFile(join(target.directory, includeNeo ? 'deployment.json' : 'identity-deployment.json'),
        JSON.stringify({ graph, result, events: recorder.getEvents() }, null, 2) + '\n', { mode: 0o600 });
      if (result.ok && !includeNeo) await observeProviderAddress();
      return result;
    } },
  ...(includeNeo ? { identityReview: { stack: graph.name, label: 'Real LDAP login and Neo access checks', checks: neoIdentityChecks,
    resourceBindings: {
      'directory-available': ['identity-directory'],
      'login-alice': ['identity-provider', 'identity-directory'],
      'login-wrong-password': ['identity-provider', 'identity-directory'],
      'anonymous-refused': ['neo-app'],
      'reader-allowed': ['neo-app', 'neo-access-policy', 'identity-provider'],
      'guest-denied': ['neo-app', 'neo-access-policy', 'identity-provider'],
      'tampered-token-refused': ['neo-app'],
    },
    adapter: await neoIdentityCheckAdapter(target) } } : {}),
  ...(includeNeo ? { connectionReview: { adapter: await neoIdentityConnectionAdapter(target),
    label: 'Real Neo identity connections',
    description: 'Measured connection checks over this prepared local system. These are point-in-time probes; resource readiness and continuous traffic are separate.',
    scopes: Object.fromEntries(graph.relations.flatMap((relation, index) => relation.kind !== 'communicatesWith' ? [] : [[`communication:${index}`,
      relation.from === 'identity-provider' && relation.to === 'identity-directory'
        ? 'An actual OIDC credential grant through the owned broker and its sealed, uncached LDAPS directory federation.'
        : relation.from === 'neo-app' && relation.to === 'identity-provider'
          ? 'An HTTP signing-key request from a Ready owned Neo Pod to its declared owned broker address.'
          : 'An in-cluster Service DNS/ClusterIP health request from a Ready owned Neo Pod to its owned Neo backends.',
    ]])),
  } } : {}),
});
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(join(directory, 'server.json'), JSON.stringify({ pid: process.pid, url: app.url, directory,
  targetPath: selected, stage: stages[0], context: target.context, namespace: target.namespace, createdAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
console.log('IaC Lens: ' + app.url);
console.log(includeNeo ? 'Deploy system, then start the explicit loopback forward before opening Neo.' : 'Deploy system to bootstrap the owned directory and sign-in provider.');
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
