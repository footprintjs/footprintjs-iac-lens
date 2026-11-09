import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkNeoForward, startNeoForward } from '../src/server/neo-forward.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }, mode = 'healthy') {
  const directory = await mkdtemp(join(tmpdir(), 'iac-lens-forward-'));
  const file = join(directory, 'kubectl-fixture.cjs');
  await writeFile(file, `
    const http = require('node:http');
    const mode = process.argv[2];
    if (mode === 'exit') { console.error('fixture could not establish tunnel'); process.exit(7); }
    const servers = [5230,8000].map(remote => {
      const server=http.createServer((request,response) => {
        response.setHeader('Content-Type','application/json');
        response.end(JSON.stringify({status:mode==='unhealthy'?'failed':'ok'}));
      });
      server.listen(0,'127.0.0.1',()=>console.log('Forwarding from 127.0.0.1:'+server.address().port+' -> '+remote));
      return server;
    });
    process.once('SIGTERM',()=>{ for(const server of servers)server.close(); });
  `);
  const children: ChildProcess[] = [];
  const launches: string[][] = [];
  const launch = (argv: string[], log: number) => {
    launches.push(argv);
    const child = spawn(process.execPath, [file, mode, ...argv], { stdio: ['ignore', log, log] });
    children.push(child); return child;
  };
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    }
    await rm(directory, { recursive: true, force: true });
  });
  return { options: { directory, context: 'kind-footprint-iac-recording-1234abcd', kubeconfig: join(directory, 'private-kubeconfig') },
    launch, launches, children };
}

test('fresh app access uses only its explicit target and two random loopback ports, then confirms both health contracts', async t => {
  const { options, launch, launches } = await fixture(t);
  const forward = await startNeoForward(options, launch);
  t.after(async () => forward.stop());
  assert.match(forward.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(forward.pythonUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.notEqual(forward.baseUrl, forward.pythonUrl);
  assert.deepEqual(launches, [[
    '--kubeconfig', options.kubeconfig, '--context', options.context, '--namespace', 'footprint-iac-neo-test',
    'port-forward', 'deployment/neo', ':5230', ':8000', '--address', '127.0.0.1',
  ]]);
  const metadata = JSON.parse(await readFile(join(options.directory, 'neo-forward.json'), 'utf8'));
  assert.equal(metadata.context, options.context); assert.equal(metadata.baseUrl, forward.baseUrl);
  assert.equal(metadata.pythonUrl, forward.pythonUrl); assert.ok(metadata.pid > 0 && metadata.processStartedAt);
  assert.ok(Date.parse(await checkNeoForward(forward)));
});

test('an unhealthy app or exited tunnel fails access and terminates only the newly owned process', async t => {
  const unhealthy = await fixture(t, 'unhealthy');
  await assert.rejects(() => startNeoForward(unhealthy.options, unhealthy.launch), /did not report healthy/);
  const child = unhealthy.children[0]!;
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
  const exited = await fixture(t, 'exit');
  await assert.rejects(() => startNeoForward(exited.options, exited.launch), /could not establish tunnel/);
});

test('fresh app access refuses unrelated targets and off-host health checks', async t => {
  const fixtureValue = await fixture(t);
  await assert.rejects(() => startNeoForward({ ...fixtureValue.options, context: 'production' }, fixtureValue.launch), /admitted fresh/);
  await assert.rejects(() => startNeoForward({ ...fixtureValue.options, kubeconfig: 'relative' }, fixtureValue.launch), /admitted fresh/);
  assert.deepEqual(fixtureValue.launches, []);
  await assert.rejects(() => checkNeoForward({ baseUrl: 'https://outside.example:443', pythonUrl: 'http://127.0.0.1:1' }), /loopback/);
});
