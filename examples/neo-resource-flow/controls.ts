import { loadEvidence } from 'footprintjs-iac';
import type { createNeoResourceFlow } from 'footprintjs-iac/integration/identity';
import type { HostActionControl, HostActionReceipt } from '../../src/core/host-actions.ts';

type NeoFlow = Awaited<ReturnType<typeof createNeoResourceFlow>>;

/** The example host chooses the owned resource and reversible action; the browser supplies no parameters. */
export function createNeoHostControls(flow: Pick<NeoFlow, 'pauseIdentityService' | 'restoreIdentityService'>): readonly HostActionControl[] {
  const execute = async (operation: NeoFlow['pauseIdentityService']): Promise<HostActionReceipt> => {
    const result = await operation(), native = result.result;
    const receipt: HostActionReceipt = { ok: native.ok, runId: native.runId, evidencePath: native.evidencePath, resourceId: result.resourceId,
      ...(result.correlationCaptureError ? { captureError: result.correlationCaptureError } : {}) };
    try {
      if (!native.evidencePath) throw Error('The action did not retain its native recording');
      const evidence = await loadEvidence(native.evidencePath);
      if (evidence.runId !== native.runId) throw Error('The action recording does not match its receipt');
      receipt.tracePath = evidence.tracePath;
      receipt.recording = { snapshot: evidence.snapshot, structure: evidence.structure ?? {},
        controlDeps: evidence.controlDeps,
        narrativeEntries: Array.isArray(evidence.narrative) ? evidence.narrative : [],
        provenance: { runId: evidence.runId, stack: evidence.stack, ...(evidence.graph ? { graphDigest: evidence.graph.digest } : {}) } };
    } catch { receipt.captureError = [receipt.captureError, 'The native action recording could not be displayed. Its operation receipt is retained.'].filter(Boolean).join(' '); }
    return receipt;
  };
  return [
    { id: 'pause-sign-in', label: 'Pause sign-in service', description: 'Stop only this trial’s owned sign-in provider, retaining its identity and data.',
      execute: () => execute(flow.pauseIdentityService) },
    { id: 'restore-sign-in', label: 'Restore sign-in service', description: 'Start the same owned provider again. Run fresh checks to measure recovery.',
      execute: () => execute(flow.restoreIdentityService) },
  ];
}
