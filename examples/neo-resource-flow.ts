import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startDashboard } from '../src/server/index.ts';
import { createNeoResourceFlowHost } from './neo-resource-flow/create-host.ts';

const [targetPath, ...args] = process.argv.slice(2);
const allowed = /^(--mode=(create|existing)|--details=(automatic|human)|--profiles=(prepared|user)|--flow=[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}|--port=\d+)$/;
if (!targetPath || args.some(arg => !allowed.test(arg)) || new Set(args.map(arg => arg.split('=')[0])).size !== args.length) {
  throw Error('Usage: node examples/neo-resource-flow.ts /prepared/target.json [--mode=create|existing] [--details=automatic|human] [--profiles=prepared|user] [--flow=safe-id] [--port=0]');
}
const value = (name: string) => args.find(arg => arg.startsWith('--' + name + '='))?.split('=')[1];
const mode = (value('mode') ?? 'create') as 'create' | 'existing', details = (value('details') ?? 'automatic') as 'automatic' | 'human';
const port = Number(value('port') ?? 0), id = value('flow'), profiles = (value('profiles') ?? 'prepared') as 'prepared' | 'user';
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Choose a valid local viewer port');
const options = await createNeoResourceFlowHost(resolve(targetPath), { mode, details, profiles, ...(id ? { id } : {}) });
const app = await startDashboard({ ...options, staticDirectory: resolve(import.meta.dirname, '../dist/web'), port });
await mkdir(options.directory, { recursive: true, mode: 0o700 });
await writeFile(join(options.directory, 'server.json'), JSON.stringify({ pid: process.pid, url: app.url,
  targetPath: resolve(targetPath), mode, details, profiles, flowId: id ?? `neo-${mode}-${details}`, createdAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
console.log('InfraChart Lens: ' + app.url);
console.log('Start runs the actual Create/Find → Connection details → Connect → Verify workflow. Opening this page performs no deployment.');
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
