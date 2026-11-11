import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadIdentityTarget } from 'footprint-iac/integration/identity';
import { startDashboard } from '../src/server/index.ts';
import { createNeoLiveReview } from './neo-identity/create-live-review.ts';

const [selected, ...args] = process.argv.slice(2);
const ports = args.filter(value => /^--port=\d+$/.test(value));
if (!selected || ports.length > 1 || args.filter(value => value === '--full').length > 1
  || args.some(value => value !== '--full' && !/^--port=\d+$/.test(value))) {
  throw Error('Usage: node examples/neo-identity-live.ts /printed/target.json [--port=0]. One build includes identity and Neo; no identity-only stage is required.');
}
const port = ports.length ? Number(ports[0]!.slice('--port='.length)) : 0;
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Choose a valid local viewer port');
const target = await loadIdentityTarget(resolve(selected));
if (resolve(selected) !== join(target.directory, 'target.json')) throw Error('Pin the printed identity target.json path for this review');
const options = await createNeoLiveReview(target);
const app = await startDashboard({ ...options, staticDirectory: resolve(import.meta.dirname, '../dist/web'), port });
await mkdir(options.directory, { recursive: true, mode: 0o700 });
await writeFile(join(options.directory, 'server.json'), JSON.stringify({ pid: process.pid, url: app.url,
  directory: options.directory, targetPath: selected, stage: '--full', singleBuild: true,
  context: target.context, namespace: target.namespace, createdAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
console.log('IaC Lens: ' + app.url);
console.log('One Build system button creates all six resources. Start the loopback forward after readiness before opening Neo.');
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
