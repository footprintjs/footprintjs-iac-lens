import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileGraph } from 'footprintjs-iac/graph';
import { checkConnections } from 'footprintjs-iac/connections';
import { checkIdentityAccess } from 'footprintjs-iac/identity';
import { neoIdentityChecks } from 'footprintjs-iac/integration/identity';
import type { DeliveryState } from 'footprintjs-iac/delivery';
import { hydrateNeoDeliveryChecks } from '../examples/neo-github-delivery/hydration.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'lens-delivery-hydration-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const graph = compileGraph({ name: 'hydration-fixture', resources: ['a', 'b', 'c'].map(id => ({ id, provider: 'simulator', spec: {} })),
    boundaries: [], memberships: [], relations: [
      { from: 'a', to: 'b', kind: 'communicatesWith' }, { from: 'b', to: 'c', kind: 'communicatesWith' },
      { from: 'c', to: 'a', kind: 'communicatesWith' },
    ] });
  let calls = 0;
  const connections = await checkConnections({ graph, traceDirectory: join(directory, 'connection-traces'),
    adapter: { async check() { calls++; return { method: 'unit-test-measurement', target: 'fixed-fixture', observedAt: Date.now(), latencyMs: 1, details: {} }; } } });
  const identity = await checkIdentityAccess({ stack: graph.name, checks: neoIdentityChecks, traceDirectory: join(directory, 'identity-traces'),
    adapter: { async check(request) { calls++; return { verdict: request.expected, observedAt: Date.now(), latencyMs: 1, details: { code: 'verified' } }; } } });
  const receipts = [];
  for (const [kind, id, result] of [['connections', 'neo-connections', connections], ['identity', 'neo-access', identity]] as const) {
    await mkdir(join(directory, kind));
    const evidencePath = join(directory, kind, result.runId + '.json');
    await writeFile(evidencePath, JSON.stringify(result));
    receipts.push({ id, runId: result.runId, evidencePath });
  }
  const state = { results: { verification: { ok: true, checks: [], metadata: { receipts } } } } as unknown as DeliveryState;
  return { directory, graph, state, connections, identity, receipts, calls: () => calls };
}

test('reopening a completed delivery hydrates three connections and seven access outcomes from native receipts without new effects', async t => {
  const f = await fixture(t), before = f.calls();
  const restored = await hydrateNeoDeliveryChecks(f.state, f.directory, f.graph);
  assert.equal(restored.connections?.status, 'passed'); assert.equal(restored.identity?.status, 'passed');
  assert.equal(restored.connections?.checks.length, 3); assert.equal(restored.identity?.checks.length, 7);
  assert.ok(restored.connections?.checks.every(check => check.status === 'connected'));
  assert.ok(restored.identity?.checks.every(check => check.status === 'passed'));
  assert.ok(restored.connections?.recording?.snapshot && restored.identity?.recording?.snapshot);
  assert.equal(f.calls(), before, 'hydration must not execute new probes');
});

test('delivery hydration rejects changed verdicts and receipts outside the fixed execution directory', async t => {
  const f = await fixture(t), path = f.receipts[0]!.evidencePath;
  const original = await readFile(path, 'utf8'), changed = JSON.parse(original);
  changed.checks[Object.keys(changed.checks)[0]!].status = 'failed';
  await writeFile(path, JSON.stringify(changed));
  await assert.rejects(hydrateNeoDeliveryChecks(f.state, f.directory, f.graph), /native recording/);
  await writeFile(path, original);
  f.receipts[0]!.evidencePath = join(f.directory, 'elsewhere.json');
  await assert.rejects(hydrateNeoDeliveryChecks(f.state, f.directory, f.graph), /fixed directory/);
});
