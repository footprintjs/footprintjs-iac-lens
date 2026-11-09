import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { bindSystem } from 'footprint-iac';
import { createNeoSystem, neoKubernetesProfile, NEO_NAMESPACE } from 'footprint-iac/integration/neo';
import { ownedPath, type NeoTarget } from './neo.ts';

interface PreparedNeo {
  version: 1; stage: 'prepared'; clusterName: string; context: string; namespace: string;
  kubeconfig: string; stateDirectory: string; sourceCommit: string;
  images: { nodeImage: string; pythonImage: string };
}

/** Fresh means prepared infrastructure with no previously managed app, never a passed review. */
export function preparedNeo(value: unknown): PreparedNeo {
  const target = value as Partial<PreparedNeo> | null;
  if (!target || target.version !== 1 || target.stage !== 'prepared'
    || !/^footprint-iac-recording-[a-f0-9]{8}$/.test(target.clusterName ?? '')
    || target.context !== 'kind-' + target.clusterName || target.namespace !== NEO_NAMESPACE
    || !/^[a-f0-9]{40}$/.test(target.sourceCommit ?? '')
    || typeof target.kubeconfig !== 'string' || typeof target.stateDirectory !== 'string'
    || !/^footprint-iac\/neo-node:review-[a-f0-9]{64}$/.test(target.images?.nodeImage ?? '')
    || !/^footprint-iac\/neo-python:review-[a-f0-9]{64}$/.test(target.images?.pythonImage ?? '')) {
    throw new Error('Run the core neo:prepare-fresh command before opening a fresh Neo dashboard');
  }
  return target as PreparedNeo;
}

type Inspect = (command: string, args: string[]) => string;
const inspect: Inspect = (command, args) => execFileSync(command, args,
  { encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 });

/** Admission is local and fixed at server startup; the HTTP API cannot select a target. */
export async function loadFreshNeoTarget(coreRoot: string, run: Inspect = inspect): Promise<NeoTarget> {
  const target = preparedNeo(JSON.parse(await readFile(resolve(coreRoot, '.artifacts/neo/fresh/latest.json'), 'utf8')));
  const kubeconfig = await ownedPath(coreRoot, target.kubeconfig);
  const stateDirectory = await ownedPath(coreRoot, target.stateDirectory);
  if ((await readdir(stateDirectory)).length !== 0) throw new Error('Fresh Neo inventory must be empty; prepare another fresh target');
  const config = JSON.parse(run('kubectl', ['--kubeconfig', kubeconfig, 'config', 'view', '--output=json']));
  if (config['current-context'] !== target.context || config.contexts?.length !== 1
    || config.contexts[0]?.name !== target.context || config.clusters?.length !== 1 || config.users?.length !== 1
    || config.contexts[0]?.context?.cluster !== config.clusters[0]?.name
    || config.contexts[0]?.context?.user !== config.users[0]?.name
    || !/^https:\/\/127\.0\.0\.1:\d+$/.test(config.clusters[0]?.cluster?.server ?? '')
    || config.users[0]?.user?.exec || config.users[0]?.user?.['auth-provider']) {
    throw new Error('Fresh Neo requires its private, single-context loopback kind kubeconfig');
  }
  const containers = JSON.parse(run('docker', ['inspect', target.clusterName + '-control-plane']));
  const labels = containers[0]?.Config?.Labels;
  const api = new URL(config.clusters[0].cluster.server);
  const ports = containers[0]?.NetworkSettings?.Ports?.['6443/tcp'];
  if (containers.length !== 1 || labels?.['io.x-k8s.kind.cluster'] !== target.clusterName
    || labels?.['io.x-k8s.kind.role'] !== 'control-plane'
    || !Array.isArray(ports) || !ports.some(port => port.HostIp === '127.0.0.1' && port.HostPort === api.port)) {
    throw new Error('Fresh Neo cluster ownership labels and API port must match its preparation');
  }
  const namespace = JSON.parse(run('kubectl', ['--kubeconfig', kubeconfig, '--context', target.context,
    'get', 'namespace', NEO_NAMESPACE, '--ignore-not-found', '--output=json']) || 'null');
  if (namespace) throw new Error('Fresh Neo namespace already exists; prepare another fresh target');
  const design = createNeoSystem();
  return { context: target.context, kubeconfig, stateDirectory, design,
    freshClaimPath: resolve(dirname(stateDirectory), 'apply-claim.json'),
    binding: bindSystem(design, neoKubernetesProfile({ context: target.context, ...target.images })) };
}
