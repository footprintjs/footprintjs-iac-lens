import type { DashboardState } from '../../src/core/types.ts';

export function AppAccess({ state, neoUrl }: { state: DashboardState; neoUrl?: string }) {
  const access = state.appAccess;
  if (!access) return <p>See what is connected. Follow every deployment.</p>;
  return <p role="status" aria-live="polite" title={access.message}>
    {access.status === 'checking' ? 'Deployment ready. Checking local app access…'
      : access.status === 'ready' && neoUrl ? <>Neo is available at <a className="app-access-url" href={neoUrl} target="_blank" rel="noreferrer">{neoUrl}</a></>
        : 'Deployment ready. The local app link could not be opened.'}
  </p>;
}
