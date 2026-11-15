import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startDashboard } from './server/server.ts';
import { projectRoot } from './server/paths.ts';
import { loadNeoTarget } from './server/neo.ts';
import { loadFreshNeoTarget } from './server/fresh-neo.ts';

const args = process.argv.slice(2);
let port: number | undefined, enableNeo = false, freshNeo = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--neo') enableNeo = true;
  else if (args[index] === '--fresh-neo') { freshNeo = true; enableNeo = true; }
  else if (args[index] === '--port') {
    const value = args[++index];
    if (!value || !/^\d+$/.test(value)) throw new Error('--port requires an integer');
    port = Number(value); if (port > 65535) throw new Error('Port is out of range');
  } else throw new Error('Usage: npm start -- [--neo | --fresh-neo] [--port 15231]');
}
const root = projectRoot();
const indexDirectory = resolve(root, freshNeo ? '.artifacts/fresh' : '.artifacts');
const coreRoot = resolve(root, '../footprint-iac');
const neo = freshNeo ? await loadFreshNeoTarget(coreRoot) : enableNeo ? await loadNeoTarget(coreRoot) : undefined;
const directory = freshNeo && neo ? resolve(indexDirectory, neo.context) : indexDirectory;
await mkdir(directory, { recursive: true, mode: 0o700 });
const app = await startDashboard({ directory, staticDirectory: resolve(root, 'dist/web'), port: port ?? (freshNeo ? 15232 : 15231),
  ...(neo ? { neo } : {}), ...(freshNeo ? { initialScenario: 'neo' as const } : {}) });
const startedAt = execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
const metadata = JSON.stringify({ pid: process.pid, startedAt, directory,
  url: app.url, neoAvailable: !!neo, createdAt: new Date().toISOString() }, null, 2) + '\n';
await writeFile(resolve(directory, 'server.json'), metadata, { mode: 0o600 });
if (directory !== indexDirectory) await writeFile(resolve(indexDirectory, 'server.json'), metadata, { mode: 0o600 });
console.log(`InfraChart Lens: ${app.url}`);
console.log(`Native recorder progress; ${neo ? 'prepared local Neo fixture enabled' : 'simulator only'}. Automatic CI is off.`);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
