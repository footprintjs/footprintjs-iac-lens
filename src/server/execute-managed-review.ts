import { loadEvidence, type ApplyResult, type InfraGraph } from 'footprintjs-iac';
import type { DeploymentRecorder, DeploymentSnapshot, DeploymentSchedulePreview } from 'footprintjs-iac/progress';
import type { DashboardRun, DashboardState } from '../core/types.ts';

/** Trusted composition only: no graph, callback, credentials or target comes from HTTP. */
export interface ManagedReviewOptions {
  graph: InfraGraph;
  recorder: DeploymentRecorder;
  schedulePreview?: DeploymentSchedulePreview;
  apply(): Promise<ApplyResult>;
  label?: string;
  mode?: 'managed' | 'kubernetes';
  target?: DashboardState['target'];
  /** A host-selected local application link, displayed only after a successful review. */
  neoUrl?: string;
}

export function pendingManagedResources(graph: InfraGraph): DashboardRun['resources'] {
  return graph.resources.map(resource => ({ id: resource.id, resourceId: resource.id, status: 'pending' }));
}

function project(graph: InfraGraph, snapshot: DeploymentSnapshot): DashboardRun['resources'] {
  return graph.resources.map(resource => ({
    ...(snapshot.resources[resource.id] ?? { resourceId: resource.id, status: 'pending' as const }), id: resource.id,
  }));
}

/** Only the configured native recorder supplies progress; results never manufacture ready events. */
export async function executeManagedReview(options: ManagedReviewOptions, update: (run: DashboardRun) => void): Promise<DashboardRun> {
  let run: DashboardRun = { id: '', status: 'running', mode: options.mode ?? 'managed',
    startedAt: new Date().toISOString(), resources: pendingManagedResources(options.graph), events: [] };
  const seenRuns = new Set<string>();
  let unsubscribe = () => {};
  let unsubscribeChart = () => {};
  let unsubscribeRecording = () => {};
  try {
    options.recorder.clear?.();
    const empty = options.recorder.getSnapshot();
    if (empty.runId !== null || empty.events.length !== 0) throw Error('Progress did not reset');
    unsubscribeChart = options.recorder.subscribeChart(chart => {
      run = { ...run, id: chart.runId, chart }; update(run);
    });
    unsubscribeRecording = options.recorder.subscribeRecording?.(recording => {
      if (recording.provenance.runId !== run.id || recording.provenance.stack !== options.graph.name
        || recording.provenance.graphDigest !== options.graph.digest) return;
      run = { ...run, recording }; update(run);
    }) ?? (() => {});
    unsubscribe = options.recorder.subscribe(event => {
      seenRuns.add(event.runId);
      const snapshot = options.recorder.getSnapshot();
      run = { ...run, id: event.runId, resources: project(options.graph, snapshot), events: [...snapshot.events] };
      update(run);
    });
    const result = await options.apply();
    const snapshot = options.recorder.getSnapshot();
    const errors: string[] = [];
    const matchingProgress = seenRuns.size === 1 && snapshot.runId === result.runId && snapshot.events.length > 0;
    if (!matchingProgress) errors.push('The configured native progress recorder did not capture one matching deployment run.');
    if (snapshot.ignoredEvents > 0) errors.push('Native progress rejected events; capture is incomplete.');
    if (snapshot.ignoredCharts > 0) errors.push('Native chart publication was rejected; capture is incomplete.');
    if (snapshot.chart && (snapshot.chart.runId !== result.runId || snapshot.chart.stack !== options.graph.name
      || snapshot.chart.graphDigest !== options.graph.digest)) errors.push('Native chart belongs to a different run or graph.');
    run = { ...run, id: snapshot.runId ?? result.runId,
      resources: matchingProgress ? project(options.graph, snapshot) : pendingManagedResources(options.graph), events: [...snapshot.events] };
    const terminal = run.resources.every(resource => ['ready', 'failed', 'skipped', 'deleted'].includes(resource.status));
    if (!terminal) errors.push('Native resource progress is incomplete; missing outcomes remain pending.');
    if (result.ok && run.resources.some(resource => resource.status !== 'ready')) errors.push('Successful apply did not confirm every declared resource ready.');
    // A partial live observation cannot substitute for the saved owning capture.
    delete run.recording;
    let matchingEvidence = false;
    try {
      const evidence = await loadEvidence(result.evidencePath);
      matchingEvidence = evidence.runId === result.runId && evidence.stack === options.graph.name
        && evidence.graph?.digest === options.graph.digest && result.plan.stack === options.graph.name;
      if (!matchingEvidence) errors.push('Native evidence belongs to a different run or graph.');
      else if (!evidence.structure) errors.push('Native chart structure was not captured.');
      else run.recording = { snapshot: evidence.snapshot, structure: evidence.structure, controlDeps: evidence.controlDeps,
        narrativeEntries: Array.isArray(evidence.narrative) ? evidence.narrative : [],
        provenance: { runId: result.runId, stack: options.graph.name, graphDigest: options.graph.digest } };
    } catch { errors.push('Native deployment evidence could not be loaded; capture is incomplete.'); }
    if (!matchingEvidence) run.resources = pendingManagedResources(options.graph);
    if (result.traceStatus && (result.traceStatus.failed > 0 || result.traceStatus.flushed === false)) {
      errors.push('Native JSONL capture is incomplete; replay may have gaps.');
    }
    return { ...run, status: result.ok && errors.length === 0 ? 'passed' : 'failed', finishedAt: new Date().toISOString(),
      report: { ok: result.ok, evidencePath: result.evidencePath, tracePath: result.tracePath,
        traceStatus: result.traceStatus, failure: result.failure, results: result.results,
        ...(errors.length ? { captureError: errors.join(' ') } : {}) } };
  } catch {
    return { ...run, recording: undefined, status: 'failed', finishedAt: new Date().toISOString(),
      report: { error: 'The configured deployment could not complete. Inspect its trusted local evidence.' } };
  } finally { unsubscribe(); unsubscribeChart(); unsubscribeRecording(); }
}
