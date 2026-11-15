import type {ReleaseAutomationAction} from '../../src/core/release-automation.ts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createDashboardClient } from '../../src/core/client.ts';
import type { DashboardState, Scenario } from '../../src/core/types.ts';
import type { ResourceFlowAction } from '../../src/core/resource-flow.ts';
import type { ConnectionProfileAction } from '../../src/core/connection-profiles.ts';
import type { HostActionInput } from '../../src/core/host-actions.ts';
import type { MigrationAction } from '../../src/core/migration.ts';
import type { PipelineAction } from '../../src/core/pipeline.ts';
import type { DeliveryAction } from '../../src/core/delivery.ts';

export function useDashboard(baseUrl = '') {
  const [state, setState] = useState<DashboardState>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();
  const [posting, setPosting] = useState(false);
  const client = useMemo(() => createDashboardClient({ baseUrl, openStream(url, callbacks) {
    const stream = new EventSource(url);
    const update = (event: MessageEvent<string>) => callbacks.state(event.data);
    stream.addEventListener('state', update as EventListener); stream.onmessage = update;
    stream.onopen = () => callbacks.connected(true); stream.onerror = () => callbacks.connected(false);
    return () => stream.close();
  } }), [baseUrl]);
  useEffect(() => {
    setState(undefined); setConnected(false);
    return client.subscribe({ state: setState, connected: setConnected, error: error => setError(error.message) });
  }, [client]);
  const run = useCallback(async (scenario: Scenario, reviewId?: string) => {
    setPosting(true); setError(undefined);
    try {
      await client.run(scenario, reviewId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPosting(false); }
  }, [client]);
  const resourceFlow = useCallback(async (input: ResourceFlowAction) => {
    setPosting(true); setError(undefined);
    try { await client.resourceFlow(input); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPosting(false); }
  }, [client]);
  const connectionProfile = useCallback(async (input: ConnectionProfileAction) => {
    setPosting(true);
    try { return await client.connectionProfile(input); }
    finally { setPosting(false); }
  }, [client]);
  const hostAction = useCallback(async (input: HostActionInput) => {
    setPosting(true); setError(undefined);
    try { await client.hostAction(input); }
    catch { setError('The configured action was refused. Check that the workflow is complete and no task is running.'); }
    finally { setPosting(false); }
  }, [client]);
  const delivery = useCallback(async (input: DeliveryAction) => {
    setPosting(true); setError(undefined);
    try { await client.delivery(input); }
    catch { setError('The delivery was refused. Check the configured version and wait for any current task.'); }
    finally { setPosting(false); }
  }, [client]);
  const pipeline=useCallback(async(input:PipelineAction)=>{
    setPosting(true);setError(undefined);
    try{await client.pipeline(input);}catch(cause){setError(cause instanceof Error?cause.message:'The pipeline action was refused.');}
    finally{setPosting(false);}
  },[client]);
  const migration=useCallback(async(input:MigrationAction)=>{setPosting(true);setError(undefined);try{await client.migration(input);}catch(cause){setError(cause instanceof Error?cause.message:'The migration action was refused.');}finally{setPosting(false);}},[client]);
  const releaseAutomation=useCallback(async(input:ReleaseAutomationAction)=>{setPosting(true);setError(undefined);try{await client.releaseAutomation(input);}catch(cause){setError(cause instanceof Error?cause.message:'Release action refused.');}finally{setPosting(false);}},[client]);
  return { releaseAutomation, state, connected, error, posting, run, resourceFlow, connectionProfile, hostAction, delivery, pipeline, migration, dismissError: () => setError(undefined) };
}
