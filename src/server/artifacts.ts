import { bindSystem, system } from 'footprintjs-iac';
import { awsObjectStorageProfile, cloudFormationOutput, kubernetesOutput, synthesize } from 'footprintjs-iac/synthesis';
import type { InfraGraph } from 'footprintjs-iac';
import type { OutputArtifact } from '../core/types.ts';

/** Native files are compiled from the whole requested graph, never from changed operations. */
export async function graphArtifacts(graph: InfraGraph): Promise<OutputArtifact[]> {
  const files: OutputArtifact[] = [{ id: 'intent-graph', path: 'infra-graph.json',
    content: JSON.stringify(graph, null, 2) + '\n', mediaType: 'application/json', target: 'Internal resource graph' }];
  if (graph.resources.every(resource => resource.provider === 'kubernetes')) {
    const result = await synthesize(graph, { outputs: [kubernetesOutput({ format: 'json' }), kubernetesOutput({ format: 'yaml' })] });
    for (const artifact of result.artifacts) for (const file of artifact.files) files.push({
      id: artifact.adapterId + ':' + file.path, ...file, target: 'Kubernetes · structural validation',
    });
  }
  return files;
}

/** Export-only example with a visibly synthetic account; this never calls AWS. */
export async function cloudFormationExample(): Promise<OutputArtifact[]> {
  const design = system('object-storage-output-example').addStorage('state', group => group
    .addStore('objects', store => store.dataModel('object').sharing('shared').durability('persistent').retainOnRemoval())).build();
  const bound = bindSystem(design, awsObjectStorageProfile({ accountId: '123456789012', region: 'us-east-1' }));
  const result = await synthesize(bound.graph, { outputs: [cloudFormationOutput({ format: 'json' }), cloudFormationOutput({ format: 'yaml' })] });
  return result.artifacts.flatMap(artifact => artifact.files.map(file => ({
    id: artifact.adapterId + ':' + file.path, ...file, target: 'CloudFormation example · export only · synthetic account',
  })));
}
