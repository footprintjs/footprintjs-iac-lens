import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startDashboard } from '../src/server/index.ts';
import { createNeoGithubDeliveryHost, NEO_GITHUB_DELIVERY_REF } from './neo-github-delivery/create-host.ts';

const [targetPath, ...args] = process.argv.slice(2);
if (!targetPath || args.some(arg => !/^(--id=[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}|--port=\d+)$/.test(arg))
  || new Set(args.map(arg => arg.split('=')[0])).size !== args.length) {
  throw Error('Usage: node examples/neo-github-delivery.ts /prepared/target.json [--id=safe-delivery-id] [--port=0]');
}
const value = (key: string) => args.find(arg => arg.startsWith('--' + key + '='))?.slice(key.length + 3);
const port = Number(value('port') ?? 0), id = value('id');
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Choose a valid local viewer port');
const host = await createNeoGithubDeliveryHost(resolve(targetPath), { ...(id ? { id } : {}) });
const app = await startDashboard({ ...host, staticDirectory: resolve(import.meta.dirname, '../dist/web'), port });
await mkdir(host.directory, { recursive: true, mode: 0o700 });
await writeFile(join(host.directory, 'server.json'), JSON.stringify({ pid: process.pid, url: app.url, targetPath: resolve(targetPath),
  ref: NEO_GITHUB_DELIVERY_REF, createdAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
console.log('InfraChart Lens: ' + app.url);
console.log('Deploy from GitHub fetches the pinned remote source, builds and stores packages, updates affected resources, then measures real connections and access. CI remains off.');
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
