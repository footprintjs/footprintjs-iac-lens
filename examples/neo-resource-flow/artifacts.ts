import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { loadEvidence, type InfraGraph } from 'footprintjs-iac';
import type { ResourceFlowState } from 'footprintjs-iac/resource-flow';
import type { OutputArtifact, Recording } from '../../src/core/types.ts';

async function readBoundedJson(path: string) {
  const info = await stat(path);
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw Error('Native workflow output is too large');
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
function segmentPath(directory: string, path: string): string {
  if (dirname(resolve(path)) !== resolve(directory) || !basename(path).endsWith('.json')) throw Error('Native segment belongs to another flow');
  return path;
}
export async function neoFlowArtifacts(directory: string, state: ResourceFlowState, graphs: readonly InfraGraph[]): Promise<OutputArtifact[]> {
  const artifacts: OutputArtifact[] = graphs.map((graph, index) => ({ id: 'neo-flow-graph-' + index,
    path: ['resource-flow/acquisition.json', 'resource-flow/consumer.json', 'resource-flow/system.json'][index]!, mediaType: 'application/json',
    content: JSON.stringify(graph, null, 2) + '\n' }));
  for (const segment of state.segments) {
    const content = await readBoundedJson(segmentPath(directory, segment.evidencePath));
    artifacts.push({ id: 'neo-flow-segment-' + segment.runId, path: 'resource-flow/segments/' + basename(segment.evidencePath),
      mediaType: 'application/json', content: JSON.stringify(content, null, 2) + '\n' });
  }
  for (const group of ['infra', 'connections', 'identity']) {
    const folder = join(directory, group);
    let names: string[];
    try { names = await readdir(folder); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const name of names.filter(name => /^[a-f0-9-]+\.json$/.test(name)).sort()) {
      const content = await readBoundedJson(join(folder, name));
      artifacts.push({ id: 'neo-flow-' + group + '-' + name, path: 'resource-flow/' + group + '/' + name,
        mediaType: 'application/json', content: JSON.stringify(content, null, 2) + '\n' });
    }
  }
  return artifacts;
}
export async function neoFlowRecording(directory: string, state: ResourceFlowState): Promise<Recording | undefined> {
  const segment = state.segments.at(-1); if (!segment) return;
  const evidence = await loadEvidence(segmentPath(directory, segment.evidencePath));
  if (evidence.runId !== segment.runId || !evidence.structure) throw Error('The native workflow recording does not match its segment');
  return { snapshot: evidence.snapshot, structure: evidence.structure, controlDeps: evidence.controlDeps,
    narrativeEntries: Array.isArray(evidence.narrative) ? evidence.narrative : [] };
}
