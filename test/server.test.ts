import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import test from 'node:test';
import { startDashboard } from '../src/server/index.ts';
import type { DashboardState } from '../src/core/types.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }, readinessDelay = 5) {
  const directory = await mkdtemp(join(tmpdir(), 'iac-lens-server-'));
  const staticDirectory = join(directory, 'public');
  await mkdir(staticDirectory);
  await writeFile(join(staticDirectory, 'index.html'), '<!doctype html><html><body>InfraChart Lens fixture<script src="/app.js"></script></body></html>');
  await writeFile(join(staticDirectory, 'app.js'), 'globalThis.fixtureViewer = true;\n');
  await writeFile(join(staticDirectory, 'styles.css'), 'body { color: #123; }\n');
  await writeFile(join(directory, 'outside.html'), 'PRIVATE OUTSIDE FIXTURE');
  await symlink(join(directory, 'outside.html'), join(staticDirectory, 'escape.html'));
  const running = await startDashboard({ directory: join(directory, 'data'), staticDirectory, port: 0, readinessDelay });
  t.after(async () => { await running.close(); await rm(directory, { recursive: true, force: true }); });
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(running.url + '/api/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { ...running, directory, post };
}

interface StateFrame { id: number; state: DashboardState }

/** Node fetch normalizes Host; this sends the literal hostile header over HTTP. */
function postWithHost(url: string, host: string): Promise<number> {
  const body = JSON.stringify({ scenario: 'demo' });
  return new Promise((resolve, reject) => {
    const outgoing = request(url + '/api/run', { method: 'POST', headers: {
      Host: host, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
    } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
    outgoing.on('error', reject); outgoing.end(body);
  });
}

async function openStream(url: string, lastEventId?: number) {
  const abort = new AbortController();
  const response = await fetch(url + '/api/events', {
    headers: lastEventId === undefined ? {} : { 'Last-Event-ID': String(lastEventId) }, signal: abort.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async next(): Promise<StateFrame> {
      for (;;) {
        let end: number;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (!frame.includes('event: state')) continue;
          const id = Number(frame.match(/^id: (\d+)$/m)?.[1]);
          const data = frame.match(/^data: (.*)$/m)?.[1];
          assert.ok(Number.isSafeInteger(id) && data);
          const state = JSON.parse(data) as DashboardState;
          assert.equal(id, state.revision);
          return { id, state };
        }
        const chunk = await reader.read();
        assert.equal(chunk.done, false, 'state stream must stay open');
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
    async close(): Promise<void> { abort.abort(); await reader.cancel().catch(() => undefined); },
  };
}

test('the local dashboard starts with seven pending resources and serves only its static assets', async t => {
  const running = await fixture(t, 0);
  const health = await fetch(running.url + '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'footprintjs-iac-lens' });
  const state = await (await fetch(running.url + '/api/state')).json() as DashboardState;
  assert.equal(state.mode, 'simulator');
  assert.equal(state.busy, false);
  assert.equal(state.graph?.resources.length, 7);
  assert.equal(state.run?.status, 'idle');
  assert.equal(state.run?.resources.length, 7);
  assert.ok(state.run?.resources.every(resource => resource.status === 'pending'));
  assert.deepEqual(state.run?.events, []);
  assert.equal(state.neoAvailable, false);
  assert.ok(state.artifacts?.some(artifact => artifact.target?.includes('export only')));
  for (const [path, media, expected] of [
    ['/', 'text/html', 'InfraChart Lens fixture'], ['/app.js', 'text/javascript', 'fixtureViewer'], ['/styles.css', 'text/css', 'color'],
  ]) {
    const response = await fetch(running.url + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.includes(media!));
    assert.ok((await response.text()).includes(expected!));
  }
  for (const path of ['/missing.js', '/escape.html', '/%2e%2e%2foutside.html', '/.env']) {
    assert.equal((await fetch(running.url + path)).status, 404, path);
  }
  for (const path of ['/%zz', '/%00', '/%5c..%5coutside.html']) {
    assert.equal((await fetch(running.url + path)).status, 400, path);
  }
});

test('SSE carries actual native deployment transitions and reconnect returns the current full event history', { timeout: 15_000 }, async t => {
  const running = await fixture(t);
  const stream = await openStream(running.url);
  t.after(() => stream.close());
  const initial = await stream.next();
  assert.ok(initial.state.run?.resources.every(resource => resource.status === 'pending'));
  assert.equal((await running.post({ scenario: 'demo' })).status, 202);
  const frames: StateFrame[] = [];
  for (let count = 0; count < 100; count++) {
    const frame = await stream.next(); frames.push(frame);
    if (!frame.state.busy && frame.state.run?.status === 'passed') break;
  }
  const final = frames.at(-1)!;
  assert.equal(final.state.run?.status, 'passed');
  assert.equal(final.state.run.resources.length, 7);
  assert.ok(final.state.run.resources.every(resource => resource.status === 'ready'));
  const events = final.state.run.events;
  assert.equal(events.length, 21);
  for (const resource of final.state.graph!.resources) {
    assert.deepEqual(events.filter(event => event.resourceId === resource.id).map(event => event.status), ['pending', 'deploying', 'ready']);
  }
  assert.ok(events.every(event => typeof event.runtimeStageId === 'string' && event.runtimeStageId.includes('#')));
  const revisions = [initial.id, ...frames.map(frame => frame.id)];
  assert.ok(revisions.every((revision, index) => index === 0 || revision > revisions[index - 1]!));
  await running.controller.whenIdle();
  const persisted = JSON.parse(await readFile(join(running.directory, 'data/latest.json'), 'utf8')) as DashboardState;
  assert.deepEqual(persisted.run?.events, events);
  assert.ok(final.state.run.recording?.snapshot);
  assert.ok(final.state.run.recording?.structure);
  const replayed = await openStream(running.url, initial.id);
  t.after(() => replayed.close());
  const latest = await replayed.next();
  assert.ok(latest.id >= final.id);
  assert.deepEqual(latest.state.run?.events, events);
});

test('a repeated successful deployment is verified as no-op and resets its native progress run', async t => {
  const running = await fixture(t, 0);
  running.controller.start('demo'); await running.controller.whenIdle();
  const baseline = running.controller.getSnapshot();
  assert.equal(baseline.run?.status, 'passed');
  const providerBefore = await stat(join(running.directory, 'data/provider.json'), { bigint: true });
  assert.equal((await running.post({ scenario: 'noop' })).status, 202);
  await running.controller.whenIdle();
  const repeated = running.controller.getSnapshot();
  assert.equal(repeated.run?.status, 'passed');
  assert.notEqual(repeated.run?.id, baseline.run.id);
  assert.ok(repeated.run?.resources.every(resource => resource.status === 'ready' && resource.action === 'noop'));
  assert.equal(repeated.run?.events[0]?.sequence, 1);
  assert.equal(repeated.run?.events.length, 21);
  const report = repeated.run?.report as { results: Record<string, { action: string; status: string }> };
  assert.equal(Object.keys(report.results).length, 7);
  assert.ok(Object.values(report.results).every(result => result.action === 'noop' && result.status === 'complete'));
  const providerAfter = await stat(join(running.directory, 'data/provider.json'), { bigint: true });
  assert.equal(providerAfter.ino, providerBefore.ino, 'no-op must not replace provider inventory');
  assert.equal(providerAfter.mtimeNs, providerBefore.mtimeNs, 'no-op must not rewrite provider inventory');
});

test('provider failure leaves a failed node and skipped dependents, and a direct repair converges', async t => {
  const running = await fixture(t, 0);
  assert.equal((await running.post({ scenario: 'failure' })).status, 202);
  await running.controller.whenIdle();
  const failure = running.controller.getSnapshot();
  assert.equal(failure.run?.status, 'failed');
  assert.equal(failure.run?.resources.find(resource => resource.id === 'persistent-store')?.status, 'failed');
  for (const id of ['api', 'worker', 'web', 'gateway']) {
    assert.equal(failure.run?.resources.find(resource => resource.id === id)?.status, 'skipped', id);
  }
  assert.equal(failure.run?.resources.find(resource => resource.id === 'session-store')?.status, 'ready');
  assert.equal((await running.post({ scenario: 'noop' })).status, 409);
  assert.equal((await running.post({ scenario: 'demo' })).status, 202);
  await running.controller.whenIdle();
  const repaired = running.controller.getSnapshot();
  assert.equal(repaired.run?.status, 'passed');
  assert.ok(repaired.run.resources.every(resource => resource.status === 'ready'));
});

test('mutation admission rejects conflicting runs, invalid scenarios and unavailable targets', async t => {
  const running = await fixture(t);
  assert.equal((await running.post({ scenario: 'noop' })).status, 409);
  assert.equal((await running.post({ scenario: 'neo' })).status, 409);
  assert.equal((await running.post({ scenario: 'connections' })).status, 409);
  assert.equal((await running.post({ scenario: 'shell' })).status, 400);
  assert.equal((await running.post({ scenario: 'demo', path: '/untrusted' })).status, 400);
  assert.equal((await running.post([])).status, 400);
  const statuses = await Promise.all([running.post({ scenario: 'demo' }), running.post({ scenario: 'demo' })]);
  assert.deepEqual(statuses.map(response => response.status).sort(), [202, 409]);
  await running.controller.whenIdle();
});

test('host, origin, media type and malformed request bodies are refused before mutation', async t => {
  const running = await fixture(t, 0);
  assert.equal(await postWithHost(running.url, 'attacker.invalid'), 403);
  assert.equal((await running.post({ scenario: 'demo' }, { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await running.post({ scenario: 'demo' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(running.url + '/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
  assert.equal((await fetch(running.url + '/api/run', { method: 'DELETE' })).status, 405);
  assert.equal(running.controller.getSnapshot().run?.status, 'idle');
});

test('oversized run requests return a bounded refusal without disconnecting the HTTP client', async t => {
  const running = await fixture(t, 0);
  const response = await running.post({ scenario: 'x'.repeat(1500) });
  assert.equal(response.status, 413);
  const body = await response.json() as { error: string };
  assert.match(body.error, /too large/);
  assert.equal(running.controller.getSnapshot().run?.status, 'idle');
});
