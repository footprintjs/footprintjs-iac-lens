import { execFile, spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { IdentityTarget } from 'footprintjs-iac/integration/identity';
import { writeMasterJson } from './master-files.ts';

const execute = promisify(execFile);
export function neoMasterForwardArgs(target: IdentityTarget): string[] {
  return ['--kubeconfig', target.kubeconfig, '--context', target.context, '--namespace', target.namespace,
    'port-forward', 'deployment/neo', `${target.neoPort}:5230`, '--address', '127.0.0.1'];
}
/** Stop only the recorded, exactly matching owned forward; preserve the app's existing local URL. */
export async function restoreNeoMasterForward(target: IdentityTarget): Promise<void> {
  const argv = neoMasterForwardArgs(target), path = join(target.directory, 'forward.json');
  let previous: { pid?: number; argv?: string[]; context?: string; namespace?: string } | undefined;
  try { previous = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (previous?.pid) {
    if (!Number.isSafeInteger(previous.pid) || previous.pid <= 1 || previous.context !== target.context
      || previous.namespace !== target.namespace || JSON.stringify(previous.argv) !== JSON.stringify(argv)) {
      throw Error('The previous local Neo connection does not match this owned target');
    }
    let command = '';
    try { command = (await execute('ps', ['-p', String(previous.pid), '-o', 'command='])).stdout.trim(); }
    catch (error) { if ((error as { code?: number }).code !== 1) throw error; }
    if (command) {
      const suffix = ' ' + argv.join(' '), executable = command.slice(0, -suffix.length);
      if (!command.endsWith(suffix) || !/(^|\/)kubectl$/.test(executable)) throw Error('The previous Neo connection process was replaced; refusing to stop it');
      try { process.kill(previous.pid, 'SIGTERM'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      for (let attempt = 0; attempt < 40; attempt++) {
        try { process.kill(previous.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') break; throw error; }
        await delay(100);
      }
      try { process.kill(previous.pid, 0); throw Error('The previous owned Neo connection has not stopped'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
  }
  const logPath = join(target.directory, 'master-forward.log'), log = openSync(logPath, 'a', 0o600);
  const logOffset = (await stat(logPath)).size;
  let child;
  try { child = spawn('kubectl', argv, { detached: true, stdio: ['ignore', log, log] }); }
  finally { closeSync(log); }
  let spawnError: Error | undefined; child.once('error', error => { spawnError = error; });
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) throw Error('The owned Neo connection did not open');
      const freshLog = (await readFile(logPath)).subarray(logOffset).toString('utf8');
      if (/address already in use|unable to listen/i.test(freshLog)) throw Error('The original Neo address is occupied');
      if (!freshLog.includes(`Forwarding from 127.0.0.1:${target.neoPort} -> 5230`)) { await delay(200); continue; }
      try {
        const response = await fetch(`http://127.0.0.1:${target.neoPort}/health`, { signal: AbortSignal.timeout(1000) });
        if (response.status === 200 && (await response.json() as { status?: string }).status === 'ok'
          && child.exitCode === null && child.signalCode === null && !spawnError) {
          await writeMasterJson(path, { pid: child.pid, argv, context: target.context, namespace: target.namespace,
            baseUrl: `http://127.0.0.1:${target.neoPort}`, logPath, createdAt: new Date().toISOString() });
          child.unref(); return;
        }
      } catch { /* A newly opening loopback connection can refuse requests until kubectl is ready. */ }
      await delay(200);
    }
    throw Error('Neo did not become reachable at its original local address');
  } catch (error) {
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    child.unref(); throw error;
  }
}
