import { resolve, join } from 'node:path';
import { startDashboard } from '../src/server/index.ts';
import { createNeoVersionedReview } from './neo-identity/master-workflow.ts';
import { writeMasterJson } from './neo-identity/master-files.ts';

const [targetPath, candidatePath, ...args] = process.argv.slice(2);
if (!targetPath || !candidatePath || args.length > 1 || args.some(value => !/^--port=\d+$/.test(value))) {
  throw Error('Usage: node examples/neo-identity-versioned.ts /prepared/target.json /prepared/candidates/<source-tree>/target.json [--port=0]');
}
const port = args.length ? Number(args[0]!.slice('--port='.length)) : 0;
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Choose a valid local viewer port');
const options = await createNeoVersionedReview(resolve(targetPath), resolve(candidatePath));
const app = await startDashboard({ ...options, staticDirectory: resolve(import.meta.dirname, '../dist/web'), port });
await writeMasterJson(join(options.directory, 'server.json'), { pid: process.pid, url: app.url, directory: options.directory,
  targetPath: resolve(targetPath), candidatePath: resolve(candidatePath), versioned: true, createdAt: new Date().toISOString() });
console.log('InfraChart Lens: ' + app.url);
console.log('Review the staged version, then apply the exact reviewed changes. Opening this server does not deploy.');
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
