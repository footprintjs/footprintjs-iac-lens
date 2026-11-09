import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startDashboard } from './server/server.ts';
import { projectRoot } from './server/paths.ts';
import { loadNeoTarget } from './server/neo.ts';

const args = process.argv.slice(2);
let port = 15231, enableNeo = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--neo') enableNeo = true;
  else if (args[index] === '--port') {
    const value = args[++index];
    if (!value || !/^\d+$/.test(value)) throw new Error('--port requires an integer');
    port = Number(value); if (port > 65535) throw new Error('Port is out of range');
  } else throw new Error('Usage: npm start -- [--neo] [--port 15231]');
}
const root = projectRoot();
const directory = resolve(root, '.artifacts');
await mkdir(directory, { recursive: true, mode: 0o700 });
const neo = enableNeo ? await loadNeoTarget(resolve(root, '../footprint-iac')) : undefined;
const app = await startDashboard({ directory, staticDirectory: resolve(root, 'dist/web'), port, ...(neo ? { neo } : {}) });
const startedAt = execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
await writeFile(resolve(directory, 'server.json'), JSON.stringify({ pid: process.pid, startedAt,
  url: app.url, neoAvailable: !!neo, createdAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
console.log(`IaC Lens: ${app.url}`);
console.log(`Native recorder progress; ${neo ? 'prepared local Neo fixture enabled' : 'simulator only'}. Automatic CI is off.`);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
