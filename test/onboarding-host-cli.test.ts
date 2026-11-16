import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ONBOARDING_STAGE_IDS, ONBOARDING_STAGE_LABELS } from 'footprintjs-iac/onboarding';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
function launch(cwd: string, args: string[]) {
  const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
  child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
  return { child, exited: once(child, 'exit'), output: () => output };
}
test('the regular CLI loads a private onboarding composition without another repository and never discovers on open', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lens-onboarding-cli-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const view = { id: 'registered-app', label: 'Existing application', strategyId: 'systemd', targetId: 'office-server', configurationDigest: 'a'.repeat(64), status: 'idle', busy: false,
    stages: ONBOARDING_STAGE_IDS.map(id => ({ id, label: ONBOARDING_STAGE_LABELS[id], status: 'pending' })), checks: [], canDiscover: true, canConfigure: false, canVerify: false, canReview: false, canDeploy: false, canReconcile: false };
  const module = join(directory, 'site.mjs');
  await writeFile(module, `export function createOnboardingHost(){return {version:1, workflow:{async snapshot(){return ${JSON.stringify(view)};},async dispatch(){throw Error('No effect authorized by this CLI test');},subscribe(){return()=>{};}}};}`);
  const stateDirectory = join(directory, 'state'), run = launch(directory, ['--onboarding-host', module, '--directory', stateDirectory, '--port', '0']);
  t.after(async () => { if (run.child.exitCode === null) run.child.kill('SIGTERM'); await run.exited; });
  const url = await new Promise<string>((accept, reject) => { run.child.stdout.on('data', () => { const found = run.output().match(/InfraChart Lens: (http:\/\/127\.0\.0\.1:\d+)/); if (found) accept(found[1]!); }); run.child.once('exit', () => reject(Error(run.output()))); run.child.once('error', reject); });
  const state = await (await fetch(url + '/api/state')).json(); assert.equal(state.onboarding.status, 'idle'); assert.equal(state.mode, 'managed'); assert.equal(state.graph, null);
  const metadata = JSON.parse(await readFile(join(stateDirectory, 'server.json'), 'utf8')); assert.equal(metadata.onboardingAvailable, true); assert.equal(metadata.applicationAvailable, false); assert.equal(metadata.neoAvailable, false);
  assert.match(run.output(), /Existing application/); assert.doesNotMatch(run.output(), /simulator only/);
});
test('private onboarding module errors stay private and incompatible mutation hosts are refused', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lens-onboarding-cli-error-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const module = join(directory, 'site.mjs'); await writeFile(module, `export function createOnboardingHost(){throw Error('PRIVATE_SITE_CREDENTIAL');}`);
  const invalid = launch(directory, ['--onboarding-host', module, '--port', '0']); const [code] = await invalid.exited;
  assert.notEqual(code, 0); assert.match(invalid.output(), /Onboarding host could not be loaded/); assert.doesNotMatch(invalid.output(), /PRIVATE_SITE_CREDENTIAL|InfraChart Lens:/);
  const mixed = launch(directory, ['--onboarding-host', module, '--host', module, '--port', '0']); const [mixedCode] = await mixed.exited;
  assert.notEqual(mixedCode, 0); assert.match(mixed.output(), /Choose one registered host/); assert.doesNotMatch(mixed.output(), /InfraChart Lens:/);
});
