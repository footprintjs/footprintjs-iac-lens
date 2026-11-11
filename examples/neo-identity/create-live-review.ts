import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { previewDeploymentChart } from 'footprint-iac/progress/preview';
import { createIdentityGraph, identityEngine, neoIdentityCheckAdapter, neoIdentityChecks,
  neoIdentityConnectionAdapter, type IdentityTarget } from 'footprint-iac/integration/identity';
import type { ControllerOptions } from '../../src/server/controller.ts';
import { neoIdentitySystemView } from './system-view.ts';

/** One immutable graph, one native apply, one recorder and one dashboard for the whole system. */
export async function createNeoLiveReview(target: IdentityTarget): Promise<ControllerOptions> {
  const graph = createIdentityGraph(target, { includeNeo: true });
  const { engine, recorder } = identityEngine(target);
  const schedulePreview = previewDeploymentChart(await engine.plan(graph), { graphDigest: graph.digest, maxConcurrency: 1 });
  return {
    directory: join(target.directory, 'lens-live-app'), systemView: neoIdentitySystemView(target),
    managedReview: { graph, recorder, schedulePreview, mode: 'managed', label: 'Build Neo',
      target: { id: target.id, context: target.context, namespace: target.namespace, label: 'Neo' },
      neoUrl: `http://127.0.0.1:${target.neoPort}/?test`,
      async apply() {
        const result = await engine.apply(graph);
        await writeFile(join(target.directory, 'deployment.json'), JSON.stringify({ graph, result,
          events: recorder.getEvents() }, null, 2) + '\n', { mode: 0o600 });
        return result;
      },
    },
    identityReview: { stack: graph.name, label: 'Real LDAP login and Neo access checks', checks: neoIdentityChecks,
      resourceBindings: {
        'directory-available': ['identity-directory'], 'login-alice': ['identity-provider', 'identity-directory'],
        'login-wrong-password': ['identity-provider', 'identity-directory'], 'anonymous-refused': ['neo-app'],
        'reader-allowed': ['neo-app', 'neo-access-policy', 'identity-provider'],
        'guest-denied': ['neo-app', 'neo-access-policy', 'identity-provider'], 'tampered-token-refused': ['neo-app'],
      }, adapter: await neoIdentityCheckAdapter(target),
    },
    connectionReview: { adapter: await neoIdentityConnectionAdapter(target), label: 'Real Neo identity connections',
      description: 'Measured connections in this local system. Resource readiness and connection checks are separate.',
      scopes: Object.fromEntries(graph.relations.flatMap((relation, index) => relation.kind !== 'communicatesWith' ? [] : [[`communication:${index}`,
        relation.from === 'identity-provider' ? 'A real credential grant through the owned sign-in service and its uncached directory.'
          : relation.from === 'neo-app' ? 'A signing-key HTTP request from a Ready owned Neo Pod to the declared owned sign-in service.'
            : 'An in-cluster Service health request through its owned Neo backends.',
      ]])),
    },
  };
}
