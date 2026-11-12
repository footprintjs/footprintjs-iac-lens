import { join } from 'node:path';
import { createNeoResourceFlow, type NeoResourceFlowOptions } from 'footprint-iac/integration/identity';
import type { ControllerOptions } from '../../src/server/controller.ts';
import { neoFlowArtifacts, neoFlowRecording } from './artifacts.ts';
import { createNeoWorkspace } from './workspace.ts';
import { neoWorkspaceOutputs } from './workspace-outputs.ts';

/** This example binds fixed local adapters; the browser can start or choose a configured profile only. */
export async function createNeoResourceFlowHost(targetPath: string, options: NeoResourceFlowOptions): Promise<ControllerOptions> {
  const flow = await createNeoResourceFlow(targetPath, options);
  const { workspace, history } = await createNeoWorkspace(flow);
  const outputs = await neoWorkspaceOutputs(flow.consumerGraph);
  return { directory: join(flow.directory, 'lens'), resourceFlow: {
    workflow: flow.workflow,
    workspace,
    target: { id: flow.target.id, context: flow.target.context, namespace: flow.target.namespace, label: 'Neo' },
    neoUrl: `http://127.0.0.1:${flow.target.neoPort}/?test`,
    artifacts: async () => [...await neoFlowArtifacts(flow.directory, await flow.workflow.snapshot(), [flow.acquisitionGraph, flow.consumerGraph, flow.graph]), ...outputs, ...history.artifacts],
    recording: state => neoFlowRecording(flow.directory, state),
  } };
}
