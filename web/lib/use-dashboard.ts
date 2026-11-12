import { useCallback, useEffect, useMemo, useState } from 'react';
import { createDashboardClient } from '../../src/core/client.ts';
import type { DashboardState, Scenario } from '../../src/core/types.ts';
import type { ResourceFlowAction } from '../../src/core/resource-flow.ts';

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
  return { state, connected, error, posting, run, resourceFlow, dismissError: () => setError(undefined) };
}
