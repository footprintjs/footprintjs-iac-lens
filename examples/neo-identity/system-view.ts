import type { IdentityTarget } from 'footprint-iac/integration/identity';
import type { SystemBlockDefinition, SystemViewDefinition } from '../../src/core/index.ts';

export function neoIdentitySystemView(target: IdentityTarget, full = true): SystemViewDefinition {
  const blocks: SystemBlockDefinition[] = [
    { id: 'placement', label: 'Placement and isolation', family: 'other', units: [
      { id: 'prepared-cluster', label: 'Prepared local cluster', mode: 'existing', resourceIds: [],
        description: 'Existing cluster; this review creates no new cluster and preserves other applications.' },
      ...(full ? [{ id: 'namespace', label: 'Application namespace', resourceIds: ['neo-namespace'], description: target.namespace }] : []),
    ] },
    { id: 'identity', label: 'Identity and access', family: 'identity', units: [
      { id: 'directory', label: 'Directory', resourceIds: ['identity-directory'], description: 'LDAP directory adapter with validated TLS.' },
      { id: 'broker', label: 'Sign-in provider', resourceIds: ['identity-provider'], description: 'OIDC broker backed by the directory.' },
      ...(full ? [{ id: 'policy', label: 'Permission policy configuration', resourceIds: ['neo-access-policy', 'neo-app'],
        description: 'Mounted policy configuration; allowed and denied behavior is measured separately.' }] : []),
    ] },
  ];
  if (full) blocks.push(
    { id: 'compute', label: 'Compute', family: 'compute', units: [
      { id: 'application', label: 'Neo application', mode: 'embedded', resourceIds: ['neo-app'], description: 'Application container in the managed Deployment.' },
      { id: 'collector', label: 'Collector tools', mode: 'embedded', resourceIds: ['neo-app'], description: 'Same-Pod tool container; listens only on loopback.' },
    ] },
    { id: 'storage', label: 'Storage', family: 'storage', units: [
      { id: 'seeded-data', label: 'Local seeded data', mode: 'embedded', resourceIds: ['neo-app'], description: 'SQLite fixture inside the Pod; no persistent volume is provisioned.' },
      { id: 'session-state', label: 'Session state', mode: 'embedded', resourceIds: ['neo-app'], description: 'In-process test session state; restart persistence is not claimed.' },
    ] },
    { id: 'network', label: 'Network', family: 'network', units: [
      { id: 'service', label: 'Application service', resourceIds: ['neo-service'], description: 'Managed private Service. Connection health is separate from resource readiness.' },
    ] },
  );
  return { blocks };
}
