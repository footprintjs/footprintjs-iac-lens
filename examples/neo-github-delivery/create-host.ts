import { dirname, join, resolve } from 'node:path';
import { createGitHubSourceAdapter } from 'footprintjs-iac/delivery/git';
import { createNeoGithubDelivery } from 'footprintjs-iac/integration/identity/github-delivery';
import type { ControllerOptions } from '../../src/server/index.ts';
import type { DeliveryPublication } from '../../src/server/delivery.ts';
import { neoIdentitySystemView } from '../neo-identity/system-view.ts';
import { createNeoDeliveryProjection, neoDeliveryBaselineRun } from './projection.ts';
import { hydrateNeoDeliveryChecks } from './hydration.ts';
import { masterReviewSummary } from '../neo-identity/master-summary.ts';

export const NEO_GITHUB_DELIVERY_REF = 'demo/neo-master-upgrade-v2-20261111';

/** The manual browser action selects this preconfigured delivery, never a repository, command or target. */
export async function createNeoGithubDeliveryHost(targetPath: string, options: { id?: string } = {}): Promise<ControllerOptions> {
  targetPath = resolve(targetPath);
  const sourceAdapter = createGitHubSourceAdapter({ directory: join(dirname(targetPath), 'github-source-cache'),
    repository: 'sanjay1909/neo-agentfootprint', allowedRefs: [NEO_GITHUB_DELIVERY_REF] });
  const flow = await createNeoGithubDelivery({ targetPath, sourceAdapter,
    source: { repository: sourceAdapter.repository, ref: NEO_GITHUB_DELIVERY_REF }, ...(options.id ? { id: options.id } : {}) });
  const run = await neoDeliveryBaselineRun(flow.baseline), project = createNeoDeliveryProjection();
  const retainedChecks: DeliveryPublication = {
    ...await hydrateNeoDeliveryChecks(await flow.workflow.snapshot(), flow.directory, flow.baseline.graph),
    revisionReview: { ...masterReviewSummary(await flow.master.getState()), canApply: false },
  };
  const publicationListeners = new Set<(patch: DeliveryPublication) => void>();
  let queue = Promise.resolve();
  flow.subscribe(event => {
    queue = queue.then(async () => {
      const patch = await project(event);
      for (const listener of publicationListeners) listener(patch);
    }).catch(() => {
      for (const listener of publicationListeners) listener({ appAccess: { status: 'failed', message: 'A native delivery observation could not be displayed. Inspect retained evidence.' } });
    });
  });
  return { directory: join(flow.directory, 'lens'), systemView: neoIdentitySystemView(flow.target),
    initialReview: { graph: flow.baseline.graph, run,
      target: { id: flow.target.id, context: flow.target.context, namespace: flow.target.namespace, label: 'Neo' },
      neoUrl: `http://127.0.0.1:${flow.target.neoPort}/?test` },
    delivery: { id: (await flow.workflow.snapshot()).definition.id, buttonLabel: 'Deploy from GitHub', workflow: {
      snapshot: flow.workflow.snapshot.bind(flow.workflow), subscribe: flow.workflow.subscribe.bind(flow.workflow),
      async start() { const state = await flow.workflow.start(); await queue; return state; },
    },
      subscribePublication(listener) {
        publicationListeners.add(listener);
        if (Object.keys(retainedChecks).length) listener(retainedChecks);
        return () => { publicationListeners.delete(listener); };
      } },
  };
}
