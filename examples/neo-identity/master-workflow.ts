import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createIdentityGraph, identityEngine, loadIdentityTarget, type IdentityTarget } from 'footprint-iac/integration/identity';
import { FileMasterStore, MasterWorkflow } from 'footprint-iac/master/workflow';
import { previewDeploymentChart } from 'footprint-iac/progress/preview';
import type { ControllerOptions, RevisionWorkflowOptions } from '../../src/server/index.ts';
import type { OutputArtifact } from '../../src/core/types.ts';
import { neoIdentitySystemView } from './system-view.ts';
import { neoBaselineRevision, neoCandidateRevision, neoMasterBinding, readNeoMasterCandidate, sameNeoMasterTarget } from './master-candidate.ts';
import { neoMasterChecks } from './master-checks.ts';
import { readNeoMasterDeployment } from './master-deployment.ts';
import { readMasterJson, writeMasterJson } from './master-files.ts';
import { restoreNeoMasterForward } from './master-forward.ts';
import { publishNeoMasterTarget } from './master-publication.ts';
import { masterReviewSummary } from './master-summary.ts';

/** Trusted test seams are fixed at host composition; the browser can supply a review ID only. */
export interface NeoMasterHostOptions {
  loadTarget?: (path: string) => Promise<IdentityTarget>;
  engine?: typeof identityEngine;
  checks?: typeof neoMasterChecks;
  restoreForward?: typeof restoreNeoMasterForward;
}

/** Adopt the real recording, stage one immutable candidate, then expose review and sealed apply. */
export async function createNeoVersionedReview(targetPath: string, candidatePath: string,
  options: NeoMasterHostOptions = {}): Promise<ControllerOptions> {
  const current = await (options.loadTarget ?? loadIdentityTarget)(resolve(targetPath));
  if (resolve(targetPath) !== join(current.directory, 'target.json')) throw Error('Pin the prepared canonical Neo target.json');
  const canonicalBytes = await readFile(targetPath, 'utf8');
  const candidate = await readNeoMasterCandidate(candidatePath, current);
  const directory = join(current.directory, 'master'), viewerDirectory = join(current.directory, 'lens-versioned');
  const store = new FileMasterStore(directory);
  const { engine, recorder } = (options.engine ?? identityEngine)(current);
  // Archive a complete returned native result before the master can promote its applied pointer.
  const native = { plan: engine.plan.bind(engine), async apply(...args: Parameters<typeof engine.apply>) {
    const result = await engine.apply(...args);
    await writeMasterJson(join(directory, 'runs', result.runId + '.json'), {
      graph: args[0], result, events: recorder.getEvents(),
    });
    return result;
  } };
  const workflow = new MasterWorkflow({ engine: native, store, target: neoMasterBinding(current) });
  let state = await workflow.getState();
  const appliedAttempt = state.attempts.findLast(attempt => attempt.status === 'applied');
  const recorded = await readNeoMasterDeployment(appliedAttempt?.kind === 'apply' && appliedAttempt.runId
    ? join(directory, 'runs', appliedAttempt.runId + '.json') : join(current.directory, 'deployment.json'));
  if (recorded.deployment.graph.digest !== createIdentityGraph(current, { includeNeo: true }).digest) {
    throw Error('Canonical Neo bindings and applied native recording disagree; inspect retained publication evidence');
  }
  if (!state.appliedDigest) {
    state = await workflow.adopt(neoBaselineRevision(current, recorded.deployment.graph), recorded.deployment.result);
    await writeMasterJson(join(directory, 'runs', recorded.deployment.result.runId + '.json'), recorded.deployment);
  } else if (state.revisions.find(revision => revision.digest === state.appliedDigest)?.graph.digest !== recorded.deployment.graph.digest) {
    throw Error('The applied master revision does not match the running Neo recording');
  }
  const prior = state.revisions.find(revision => revision.revisionId === 'neo-' + candidate.receipt.sourceTree.slice(0, 12));
  const revision = neoCandidateRevision(candidate, prior?.parentDigest ?? state.appliedDigest!);
  if (state.candidateDigest && state.candidateDigest !== revision.digest) throw Error('A different master candidate is staged; inspect it before replacing it');
  if (state.appliedDigest !== revision.digest) state = await workflow.stage(revision, { expectedAppliedDigest: state.appliedDigest });
  await writeMasterJson(join(directory, 'candidate.json'), revision);
  const checks = options.checks ?? neoMasterChecks;
  const revisionWorkflow: RevisionWorkflowOptions = {
    async snapshot() { return masterReviewSummary(await workflow.getState()); },
    async review() {
      let state = await workflow.getState();
      if (state.candidateDigest !== revision.digest) state = await workflow.stage(revision, { expectedAppliedDigest: state.appliedDigest });
      const review = await workflow.preview();
      state = await workflow.getState();
      await writeMasterJson(join(directory, 'reviews', review.reviewId + '.json'), review);
      return { summary: masterReviewSummary(state, review),
        managedReview: { graph: revision.graph, recorder, mode: 'kubernetes', label: 'Update Neo',
          target: { id: current.id, context: current.context, namespace: current.namespace, label: 'Neo' },
          neoUrl: `http://127.0.0.1:${current.neoPort}/?test`,
          schedulePreview: previewDeploymentChart(review.plan, { graphDigest: revision.graph.digest, maxConcurrency: 1 }),
          async apply() {
            const state = await workflow.getState();
            const expected = state.appliedDigest === revision.digest ? candidate.target : current;
            if (!sameNeoMasterTarget(await readMasterJson(targetPath), expected)) {
              throw Error('Canonical Neo bindings changed after review; inspect the current target before applying');
            }
            // MasterWorkflow rechecks candidate/head and the engine rechecks this exact plan under its state lock.
            const result = await workflow.apply(review.reviewId);
            return result;
          },
        },
        ...checks(candidate.target, revision.graph),
        async afterApply() {
          const state = await workflow.getState();
          await publishNeoMasterTarget({ current, candidate: candidate.target, revision, state, canonicalBytes, directory });
          const attempt = state.attempts.at(-1)!;
          const result = await readMasterJson(join(directory, 'runs', attempt.runId + '.json'));
          await writeMasterJson(join(current.directory, 'deployment.json'), result);
          await (options.restoreForward ?? restoreNeoMasterForward)(candidate.target);
        },
      };
    },
    async completed(prepared, run) {
      const state = await workflow.getState(), summary = masterReviewSummary(state);
      return { ...prepared.summary, ...summary,
        resources: prepared.summary.resources, reviewId: prepared.summary.reviewId,
        canApply: false, runId: run.id || summary.runId,
        ...(state.appliedDigest === revision.digest ? { status: 'applied' as const }
          : { status: 'failed' as const, error: 'The native update did not converge. The applied master revision is retained.' }) };
    },
    async artifacts(): Promise<OutputArtifact[]> {
      const state = await workflow.getState();
      return [{ id: 'master-state', path: 'master/master.json', mediaType: 'application/json', content: JSON.stringify(state, null, 2) + '\n' },
        ...state.revisions.map(revision => ({ id: 'master-revision-' + revision.digest, path: 'master/revisions/' + revision.revisionId + '.json',
          mediaType: 'application/json', content: JSON.stringify(revision, null, 2) + '\n' }))];
    },
  };
  return { directory: viewerDirectory, systemView: neoIdentitySystemView(current), revisionWorkflow,
    initialReview: { graph: recorded.deployment.graph, run: recorded.run,
      neoUrl: `http://127.0.0.1:${current.neoPort}/?test`,
      target: { id: current.id, context: current.context, namespace: current.namespace, label: 'Neo' } },
    ...checks(current, recorded.deployment.graph),
  };
}
