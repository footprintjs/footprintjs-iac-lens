import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = new URL('../src/cli.ts', import.meta.url);

test('an operator can keep dashboard state outside the installed package', { timeout: 15_000 }, async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'infrachart-cli-'));
  const directory = join(cwd, 'operator-state');
  const child = spawn(process.execPath, [fileURLToPath(cli), '--port', '0', '--directory', directory], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await exited;
    await rm(cwd, { recursive: true, force: true });
  });
  const url = await new Promise<string>((resolve, reject) => {
    child.stdout.on('data', () => {
      const match = stdout.match(/InfraChart Lens: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) resolve(match[1]!);
    });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`CLI exited ${code}: ${stderr}`)));
  });
  assert.deepEqual(await (await fetch(url + '/health')).json(), { status: 'ok', service: 'footprintjs-iac-lens' });
  const metadata = JSON.parse(await readFile(join(directory, 'server.json'), 'utf8'));
  assert.equal(metadata.directory, directory);
  assert.equal(metadata.url, url);
  assert.equal(metadata.neoAvailable, false);
  await assert.rejects(stat(join(cwd, '.artifacts')), { code: 'ENOENT' });
});
