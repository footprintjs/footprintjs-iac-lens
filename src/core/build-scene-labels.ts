import type { DeploymentFlowCapability, DeploymentFlowNode } from './deployment-flow.ts';

export type BuildSceneKind = 'compute' | 'storage' | 'network' | 'identity' | 'space' | 'policy' | 'resource';

const titles: Record<BuildSceneKind, string> = {
  compute: 'Program', storage: 'Storage', network: 'Network', identity: 'Sign-in', space: 'Space', policy: 'Access', resource: 'Resource',
};

/** Short consumer names take precedence; provider vocabulary belongs in Details. */
export function buildSceneLabel(label: string, kind: BuildSceneKind): string {
  const value = label.trim().replace(/\s+/g, ' ');
  if (/^(?:application |app )?namespace$/i.test(value)) return 'Space';
  if (/^(?:application |app )?(?:service|endpoint|network)$/i.test(value)) return 'Network';
  if (/^(?:identity )?directory$/i.test(value)) return 'Directory';
  if (/^(?:sign[ -]?in|identity|authentication) provider$/i.test(value)) return 'Sign-in';
  if (/^(?:permission|access|identity)? ?polic(?:y|ies)(?: configuration)?$/i.test(value)) return 'Access';
  if (/^(?:application runtime|(?:neo |application |app )?(?:application|app|runtime)|compute)$/i.test(value)) return 'Program';
  if (/^(?:embedded )?(?:sqlite|database)(?: data| storage)?$|^(?:local |seeded |local seeded )?data$/i.test(value)) return 'Data';
  if (/^(?:session|session state|session storage|sessions)$/i.test(value)) return 'Sessions';
  if (/^(?:collector )?tools$/i.test(value)) return 'Tools';
  if (/^(?:persistent|persistence) storage$/i.test(value)) return 'Storage';
  if (!value) return titles[kind];
  return [...value].length > 36 ? [...value].slice(0, 35).join('') + '…' : value;
}

export function capabilityKind(capability: DeploymentFlowCapability): BuildSceneKind {
  if (capability.family === 'identity') return /polic|permission|access/i.test(capability.label) ? 'policy' : 'identity';
  return capability.family === 'other' ? 'resource' : capability.family;
}

/** A declared one-resource managed capability names a physical unit, unlike an embedded feature. */
export function buildScenePurpose(node: DeploymentFlowNode): { title: string; kind: BuildSceneKind } {
  const capability = node.capabilities.find(item => item.mode === 'managed' && item.resourceIds.length === 1);
  const physicalKind = String(node.resource.spec.kind ?? node.resource.spec.Type ?? '');
  const role = String(node.resource.spec.role ?? '');
  let kind: BuildSceneKind;
  if (/namespace|resourcegroup|project|vpc|virtualnetwork/i.test(physicalKind)) kind = 'space';
  else if (capability) kind = capabilityKind(capability);
  else if (/directory|provider|identity|authentication/i.test(role)) kind = 'identity';
  else if (/configmap|configuration|config$/i.test(physicalKind)
    && node.capabilities.some(item => item.mode === 'managed' && capabilityKind(item) === 'policy')) kind = 'policy';
  else if (/polic|permission|rolebinding/i.test(physicalKind)) kind = 'policy';
  else if (/database|store|storage|bucket|volume|disk/i.test(physicalKind)) kind = 'storage';
  else if (/service|network|ingress|gateway|loadbalancer/i.test(physicalKind)) kind = 'network';
  else if (/deployment|statefulset|daemonset|pod|container|function|server|instance|compute|job/i.test(physicalKind)) kind = 'compute';
  else if (node.capabilities.some(item => item.family === 'compute')) kind = 'compute';
  else kind = 'resource';
  const title = capability ? buildSceneLabel(capability.label, kind)
    : role === 'directory' ? 'Directory' : titles[kind];
  return { title, kind };
}
