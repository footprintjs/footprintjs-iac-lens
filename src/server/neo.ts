import { readFile, realpath, access } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { bindSystem, type BindingResult, type SystemDesign } from 'footprint-iac';
import { createNeoSystem, neoKubernetesProfile, NEO_NAMESPACE } from 'footprint-iac/integration/neo';

export interface NeoTarget {
  context: string; kubeconfig: string; stateDirectory: string; design: SystemDesign;
  binding: BindingResult; url?: string;
  freshClaimPath?: string;
}

export async function ownedPath(coreRoot: string, path: unknown): Promise<string> {
  if (typeof path !== 'string') throw new Error('Neo review metadata is missing its local path');
  const root = await realpath(resolve(coreRoot, '.artifacts'));
  const selected = await realpath(resolve(path));
  const inside = relative(root, selected);
  if (inside === '..' || inside.startsWith('..' + sep) || inside.startsWith(sep)) {
    throw new Error('Neo paths must belong to the configured core checkout artifacts');
  }
  return selected;
}

/** Only the explicitly prepared local Neo fixture can be selected by this viewer. */
export async function loadNeoTarget(coreRoot: string): Promise<NeoTarget> {
  const report = JSON.parse(await readFile(resolve(coreRoot, '.artifacts/neo/review/latest.json'), 'utf8'));
  if (!['kind-footprint-iac-test', 'kind-footprint-iac-review'].includes(report.context)
    || report.namespace !== NEO_NAMESPACE || report.status !== 'passed') {
    throw new Error('Prepare a successful isolated Neo capability review before enabling it in Lens');
  }
  const kubeconfig = await ownedPath(coreRoot, report.kubeconfig);
  const stateDirectory = await ownedPath(coreRoot, report.stateDirectory);
  await access(kubeconfig);
  const config = JSON.parse(execFileSync('kubectl', ['--kubeconfig', kubeconfig, '--context', report.context,
    'config', 'view', '--minify', '--output=json'], { encoding: 'utf8', timeout: 15_000 }));
  if (!/^https:\/\/127\.0\.0\.1:\d+$/.test(config.clusters?.[0]?.cluster?.server ?? '')
    || config.clusters?.length !== 1 || config.users?.some((entry: { user?: Record<string, unknown> }) => entry.user?.exec || entry.user?.['auth-provider'])) {
    throw new Error('Neo review must target the prepared loopback kind cluster without external authentication helpers');
  }
  const images = report.context === 'kind-footprint-iac-review' ? report.images : undefined;
  const design = createNeoSystem();
  const binding = bindSystem(design, neoKubernetesProfile({ context: report.context,
    ...(images ? { nodeImage: images.nodeImage, pythonImage: images.pythonImage } : {}) }));
  const url = typeof report.baseUrl === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(report.baseUrl) ? report.baseUrl : undefined;
  return { context: report.context, kubeconfig, stateDirectory, design, binding, ...(url ? { url } : {}) };
}
