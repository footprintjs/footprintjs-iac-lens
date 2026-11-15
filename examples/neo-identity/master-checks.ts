import { neoIdentityCheckAdapter, neoIdentityChecks, neoIdentityConnectionAdapter, type IdentityTarget } from 'footprintjs-iac/integration/identity';
import type { InfraGraph } from 'footprintjs-iac';
import type { ConnectionReviewOptions } from '../../src/server/run-connections.ts';
import type { IdentityReviewOptions } from '../../src/server/run-identity.ts';

/** Candidate adapters must be constructed after successful publication, when canonical admission agrees. */
export function neoMasterChecks(target: IdentityTarget, graph: InfraGraph): {
  connectionReview: ConnectionReviewOptions; identityReview: IdentityReviewOptions;
} {
  let connection: ReturnType<typeof neoIdentityConnectionAdapter> | undefined;
  let identity: ReturnType<typeof neoIdentityCheckAdapter> | undefined;
  return {
    connectionReview: { label: 'Real Neo identity connections',
      description: 'Measured paths through the running Neo system.',
      scopes: Object.fromEntries(graph.relations.flatMap((relation, index) => relation.kind !== 'communicatesWith' ? [] : [[`communication:${index}`,
        relation.from === 'identity-provider' ? 'A real credential grant through the sign-in service and uncached directory.'
          : relation.from === 'neo-app' ? 'A signing-key request from a Ready Neo Pod to its sign-in service.'
            : 'An in-cluster Service health request through its Neo backends.',
      ]])),
      adapter: { async check(request) {
        const adapter = await (connection ??= neoIdentityConnectionAdapter(target).catch(error => { connection = undefined; throw error; }));
        return adapter.check(request);
      } },
    },
    identityReview: { stack: graph.name, label: 'Real LDAP login and Neo access checks', checks: neoIdentityChecks,
      resourceBindings: {
        'directory-available': ['identity-directory'], 'login-alice': ['identity-provider', 'identity-directory'],
        'login-wrong-password': ['identity-provider', 'identity-directory'], 'anonymous-refused': ['neo-app'],
        'reader-allowed': ['neo-app', 'neo-access-policy', 'identity-provider'],
        'guest-denied': ['neo-app', 'neo-access-policy', 'identity-provider'], 'tampered-token-refused': ['neo-app'],
      }, adapter: { id: 'neo-versioned-identity', async check(request) {
        const adapter = await (identity ??= neoIdentityCheckAdapter(target).catch(error => { identity = undefined; throw error; }));
        return adapter.check(request);
      } },
    },
  };
}
