// Run against a disposable loopback AWS emulator with the AWS CLI installed.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { infra } from 'footprintjs-iac/graph';
import { ConnectionCheckError } from 'footprintjs-iac/connections';
import { runConnectionReview } from '../../src/server/run-connections.ts';

const [endpoint, caBundle, output] = process.argv.slice(2);
const url = new URL(endpoint);
assert(url.protocol === 'https:' && url.hostname === '127.0.0.1' && url.port && url.href === url.origin + '/');
assert(caBundle && output, 'Pass the local HTTPS endpoint, emulator CA and output directory');
const directory = resolve(output);
const token = randomUUID().slice(0, 8);
const name = id => 'infrachart-edge-' + token + '-' + id;
const scratch = await mkdtemp(join(tmpdir(), 'aws-edge-fixture-'));
const exec = promisify(execFile);
const config = { PATH: process.env.PATH, HOME: scratch, AWS_EC2_METADATA_DISABLED: 'true',
  AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null', AWS_PAGER: '',
  AWS_ACCESS_KEY_ID: 'local-fixture', AWS_SECRET_ACCESS_KEY: 'local-fixture', AWS_MAX_ATTEMPTS: '1' };
async function aws(...args) {
  const { stdout } = await exec('aws', ['--region', 'us-east-1', '--endpoint-url', url.origin,
    '--ca-bundle', caBundle, '--output', 'json', ...args], { env: config, timeout: 20000 });
  return stdout.trim() ? JSON.parse(stdout) : {};
}

const details = { operation: 'GetObject', protocol: { application: 'HTTPS', transport: 'TCP', port: Number(url.port) },
  route: { network: 'IPv4', via: ['Laptop loopback', 'Local AWS emulator'] } };
const graph = infra('local-aws-connections').resource('reader', 'host', { kind: 'Local reader' })
  .resource('docs', 'aws', { kind: 'S3 bucket' }).resource('items', 'aws', { kind: 'DynamoDB table' })
  .resource('dlq', 'aws', { kind: 'SQS queue' }).resource('jobs', 'aws', { kind: 'SQS queue' })
  .dependsOn('jobs', 'dlq').connect('reader', 'docs', 'communicatesWith', 'Read report', details).build();
const bucket = name('docs'), table = name('items'), key = 'report.txt';
const seed = join(scratch, 'report.txt'), downloaded = join(scratch, 'download.txt');
const put = () => aws('s3api', 'put-object', '--bucket', bucket, '--key', key, '--body', seed);
const removeObject = () => aws('s3api', 'delete-object', '--bucket', bucket, '--key', key);
const adapter = { async check(request) {
  assert.equal(request.relation.details.operation, 'GetObject');
  const start = performance.now();
  function observation(result) {
    return { method: 'S3 GetObject', target: 'Local reports bucket', observedAt: Date.now(),
      latencyMs: performance.now() - start, details: { result, scope: 'Object read at the local emulator' } };
  }
  try {
    await aws('s3api', 'get-object', '--bucket', bucket, '--key', key, downloaded);
    assert.equal(await readFile(downloaded, 'utf8'), 'InfraChart connection fixture');
    return observation('Object returned');
  } catch (error) {
    if (!String(error.stderr).includes('(NoSuchKey)')) throw Error('Local object check could not be completed');
    throw new ConnectionCheckError('The report object is missing', observation('NoSuchKey'));
  }
} };
await mkdir(directory, { recursive: true });
const cleanup = new AsyncDisposableStack();
cleanup.defer(() => rm(scratch, { recursive: true, force: true }));
try {
  await writeFile(seed, 'InfraChart connection fixture');
  await aws('s3api', 'create-bucket', '--bucket', bucket);
  cleanup.defer(() => aws('s3api', 'delete-bucket', '--bucket', bucket));
  const dlq = (await aws('sqs', 'create-queue', '--queue-name', name('dlq'))).QueueUrl;
  cleanup.defer(() => aws('sqs', 'delete-queue', '--queue-url', dlq));
  const arn = (await aws('sqs', 'get-queue-attributes', '--queue-url', dlq, '--attribute-names', 'QueueArn')).Attributes.QueueArn;
  const policy = JSON.stringify({ deadLetterTargetArn: arn, maxReceiveCount: '3' });
  const jobs = (await aws('sqs', 'create-queue', '--queue-name', name('jobs'), '--attributes', JSON.stringify({ RedrivePolicy: policy }))).QueueUrl;
  cleanup.defer(() => aws('sqs', 'delete-queue', '--queue-url', jobs));
  const attrs = (await aws('sqs', 'get-queue-attributes', '--queue-url', jobs, '--attribute-names', 'RedrivePolicy')).Attributes;
  assert.equal(JSON.parse(attrs.RedrivePolicy).deadLetterTargetArn, arn);
  await aws('dynamodb', 'create-table', '--table-name', table, '--billing-mode', 'PAY_PER_REQUEST',
    '--attribute-definitions', 'AttributeName=id,AttributeType=S', '--key-schema', 'AttributeName=id,KeyType=HASH');
  cleanup.defer(() => aws('dynamodb', 'delete-table', '--table-name', table));
  assert.equal((await aws('dynamodb', 'describe-table', '--table-name', table)).Table.TableName, table);
  await put();
  cleanup.defer(removeObject);
  const frames = [];
  for (const [phase, expected] of [['Connected', 'connected'], ['Failed', 'failed'], ['Recovered', 'connected']]) {
    if (phase === 'Failed') await removeObject();
    if (phase === 'Recovered') await put();
    const run = await runConnectionReview({ graph, directory, adapter, update() {} });
    assert.equal(run.checks[0]?.status, expected);
    assert.deepEqual(run.events.map(e => e.status), ['checking', expected]);
    assert(run.recording && run.report.traceStatus.flushed && !run.report.captureError);
    assert.equal(run.report.traceStatus.failed, 0);
    frames.push({ phase, id: run.id, checks: run.checks, events: run.events, status: run.status });
    console.log(phase, run.checks[0].observation.details.result, run.checks[0].runtimeStageId);
  }
  await writeFile(join(directory, 'review.json'), JSON.stringify({ graph, frames }, null, 2));
} finally { await cleanup.disposeAsync(); }
