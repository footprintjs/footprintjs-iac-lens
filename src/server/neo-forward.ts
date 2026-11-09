import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

interface ForwardOptions { context: string; kubeconfig: string; directory: string }
export interface NeoForward {
  context: string; baseUrl: string; pythonUrl: string; checkedAt: string;
  stop(): void;
}
type Launch = (argv: string[], log: number) => ChildProcess;
const launch: Launch = (argv, log) => spawn('kubectl', argv, { detached: true, stdio: ['ignore', log, log] });

/** These are one-time health observations, not a continuous traffic monitor. */
export async function checkNeoForward(forward: Pick<NeoForward, 'baseUrl' | 'pythonUrl'>): Promise<string> {
  for (const [base, path] of [[forward.baseUrl, '/health'], [forward.pythonUrl, '/healthz']]) {
    const url = new URL(base!);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) {
      throw new Error('Neo access must use a local loopback port-forward');
    }
    const response = await fetch(base! + path, { signal: AbortSignal.timeout(5000) });
    if (!response.ok || (await response.json() as { status?: unknown }).status !== 'ok') {
      throw new Error(`Neo ${path} did not report healthy`);
    }
  }
  return new Date().toISOString();
}

/** Only the admitted fresh Neo target can start this fixed, loopback-only command. */
export async function startNeoForward(options: ForwardOptions, start: Launch = launch): Promise<NeoForward> {
  if (!/^kind-footprint-iac-recording-[a-f0-9]{8}$/.test(options.context) || !isAbsolute(options.kubeconfig)) {
    throw new Error('App access requires an admitted fresh local Neo target');
  }
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const logPath = resolve(options.directory, `neo-forward-${randomUUID()}.log`);
  const argv = ['--kubeconfig', options.kubeconfig, '--context', options.context, '--namespace', 'footprint-iac-neo-test',
    'port-forward', 'deployment/neo', ':5230', ':8000', '--address', '127.0.0.1'];
  const log = openSync(logPath, 'a', 0o600);
  let child: ChildProcess;
  try { child = start(argv, log); } finally { closeSync(log); }
  let spawnError: Error | undefined;
  child.once('error', error => { spawnError = error; });
  const stop = () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    child.unref();
  };
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      const output = await readFile(logPath, 'utf8');
      if (child.exitCode !== null || child.signalCode !== null || /address already in use|unable to listen on any.*ports/i.test(output)) {
        throw new Error(output.trim() || `Neo port-forward exited ${child.exitCode ?? child.signalCode}`);
      }
      const ports = new Map<number, number>();
      for (const match of output.matchAll(/Forwarding from 127\.0\.0\.1:(\d+) -> (5230|8000)/g)) {
        const port = Number(match[1]);
        if (port > 0 && port <= 65535) ports.set(Number(match[2]), port);
      }
      if (ports.has(5230) && ports.has(8000)) {
        const baseUrl = `http://127.0.0.1:${ports.get(5230)}`;
        const pythonUrl = `http://127.0.0.1:${ports.get(8000)}`;
        const checkedAt = await checkNeoForward({ baseUrl, pythonUrl });
        const processInfo = await promisify(execFile)('ps', ['-p', String(child.pid), '-o', 'lstart=']);
        await writeFile(resolve(options.directory, 'neo-forward.json'), JSON.stringify({
          pid: child.pid, processStartedAt: processInfo.stdout.trim(), command: 'kubectl', argv,
          context: options.context, kubeconfig: options.kubeconfig, baseUrl, pythonUrl, checkedAt, logPath,
        }, null, 2) + '\n', { mode: 0o600 });
        child.unref();
        return { context: options.context, baseUrl, pythonUrl, checkedAt, stop };
      }
      await delay(100);
    }
    throw new Error('Neo app access did not open within 10 seconds; the Kubernetes deployment result is unchanged');
  } catch (error) { stop(); throw error; }
}
