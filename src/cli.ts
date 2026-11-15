#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startDashboard } from './server/server.ts';
import { projectRoot } from './server/paths.ts';
import { loadNeoTarget } from './server/neo.ts';
import { loadFreshNeoTarget } from './server/fresh-neo.ts';
import { loadApplicationHost } from './server/load-application-host.ts';

const args = process.argv.slice(2);
const usage = 'Usage: footprintjs-iac-lens [--host MODULE | --neo | --fresh-neo] [--port 15231] [--directory PATH] [--core-root PATH]';
if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0); }
let port: number | undefined, enableNeo = false, freshNeo = false;
let stateDirectory: string | undefined, coreDirectory: string | undefined;
let hostModule: string | undefined;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--neo') enableNeo = true;
  else if (args[index] === '--fresh-neo') { freshNeo = true; enableNeo = true; }
  else if (args[index] === '--port') {
    const value = args[++index];
    if (!value || !/^\d+$/.test(value)) throw new Error('--port requires an integer');
    port = Number(value); if (port > 65535) throw new Error('Port is out of range');
  } else if (args[index] === '--directory' || args[index] === '--core-root' || args[index] === '--host') {
    const flag = args[index], value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`);
    if (flag === '--directory') stateDirectory = resolve(value);
    else if (flag === '--core-root') coreDirectory = resolve(value);
    else { if (hostModule) throw Error('Choose one application host module'); hostModule = value; }
  } else throw new Error(usage);
}
if (hostModule && (enableNeo || freshNeo || coreDirectory)) throw Error('Choose an application host or a prepared Neo target');
const root = projectRoot();
const indexDirectory = stateDirectory ?? resolve(process.cwd(), freshNeo ? '.artifacts/fresh' : '.artifacts');
const coreRoot = coreDirectory ?? resolve(process.cwd(), '../footprint-iac');
const neo = freshNeo ? await loadFreshNeoTarget(coreRoot) : enableNeo ? await loadNeoTarget(coreRoot) : undefined;
const directory = freshNeo && neo ? resolve(indexDirectory, neo.context) : indexDirectory;
await mkdir(directory, { recursive: true, mode: 0o700 });
const applicationHost = hostModule ? await loadApplicationHost(hostModule, { directory }) : undefined;
const app = await (async () => {
  try {
    return await startDashboard({ directory, staticDirectory: resolve(root, 'dist/web'), port: port ?? (freshNeo ? 15232 : 15231),
      ...(neo ? { neo } : {}), ...(applicationHost ? { applicationHost } : {}), ...(freshNeo ? { initialScenario: 'neo' as const } : {}) });
  } catch (error) {
    if (applicationHost) throw Error('Application dashboard could not be started. Check the registered host and its private connection storage.');
    throw error;
  }
})();
const startedAt = execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
const metadata = JSON.stringify({ pid: process.pid, startedAt, directory,
  url: app.url, neoAvailable: !!neo, applicationAvailable: !!applicationHost, createdAt: new Date().toISOString() }, null, 2) + '\n';
await writeFile(resolve(directory, 'server.json'), metadata, { mode: 0o600 });
if (directory !== indexDirectory) await writeFile(resolve(indexDirectory, 'server.json'), metadata, { mode: 0o600 });
console.log(`InfraChart Lens: ${app.url}`);
console.log(`Native recorder progress; ${applicationHost ? app.controller.getSnapshot().application?.label ?? 'registered application host' : neo ? 'prepared local Neo fixture enabled' : 'simulator only'}. Automatic CI is off.`);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
