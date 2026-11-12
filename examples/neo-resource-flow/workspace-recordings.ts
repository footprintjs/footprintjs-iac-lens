import { loadEvidence, type InfraGraph } from 'footprint-iac';
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { ResourceFlowWorkspaceFrame } from '../../src/core/resource-flow-workspace.ts';
import type { Recording } from '../../src/core/types.ts';

/** Only fixed, target-owned evidence paths from the trusted wrapper are read. */
export function createNeoWorkspaceRecordingReader(stateDirectory: string, flowDirectory: string, graph: InfraGraph) {
  const cache = new Map<string, Recording>();
  async function read(path: string, runId: string, folder: string, graphDigest?: string): Promise<Recording> {
    if (dirname(resolve(path)) !== resolve(folder) || !basename(path).endsWith('.json')) throw Error('Native recording is outside its fixed evidence directory');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024 || await realpath(path) !== resolve(path)) throw Error('Native recording is not a bounded owned file');
    const key = path + ':' + runId;
    const cached = cache.get(key); if (cached) return cached;
    const evidence = await loadEvidence(path);
    if (evidence.runId !== runId || evidence.stack !== graph.name || !evidence.structure
      || (graphDigest !== undefined && evidence.graph?.digest !== graphDigest)) throw Error('Native recording does not match this child run');
    const recording = { snapshot: evidence.snapshot, structure: evidence.structure,
      provenance: { runId: evidence.runId, stack: evidence.stack, ...(evidence.graph ? { graphDigest: evidence.graph.digest } : {}) },
      narrativeEntries: Array.isArray(evidence.narrative) ? evidence.narrative : [] };
    cache.set(key, recording); return recording;
  }
  return async (frame: ResourceFlowWorkspaceFrame): Promise<ResourceFlowWorkspaceFrame> => {
    let incomplete = false;
    for (const child of frame.children) {
      const report = child.run.report as { evidencePath?: string } | undefined;
      if (!report?.evidencePath) continue;
      try { child.run.recording = await read(report.evidencePath, child.run.id, stateDirectory, child.graphDigest); }
      catch { incomplete = true; }
    }
    for (const [kind, run] of [['connections', frame.connections], ['identity', frame.identity]] as const) {
      if (!run?.report?.evidencePath) continue;
      try { run.recording = await read(run.report.evidencePath, run.id, resolve(flowDirectory, kind), kind === 'connections' ? graph.digest : undefined); }
      catch { incomplete = true; }
    }
    return { ...frame, ...(incomplete ? { error: 'Some native recording files could not be matched. Resource observations remain separate from recording availability.' } : {}) };
  };
}
