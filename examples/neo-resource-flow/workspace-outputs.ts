import type { InfraGraph } from 'footprintjs-iac';
import { graphArtifacts } from '../../src/server/artifacts.ts';

/** Render the complete consumer phase, including resources that a later plan leaves unchanged. */
export async function neoWorkspaceOutputs(consumerGraph: InfraGraph) {
  return (await graphArtifacts(consumerGraph)).map(artifact => ({ ...artifact,
    id: 'consumer-output:' + artifact.id, path: 'consumer/' + artifact.path }));
}
