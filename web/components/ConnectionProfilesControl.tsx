import { useState } from 'react';
import type { ConnectionProfileAction, ConnectionProfileActionResult, ConnectionProfilesView } from '../../src/core/connection-profiles.ts';
import { CONNECTION_PROFILE_CAPACITY } from '../../src/core/connection-profiles.ts';
import { ConnectionProfileForm } from './ConnectionProfileForm.tsx';
import { DetailsPanel } from './DetailsPanel.tsx';
import './connection-profiles.css';

export type ConnectionProfileHandler = (input: ConnectionProfileAction) => Promise<ConnectionProfileActionResult>;
export function ConnectionProfilesControl({ view, selected, locked, disabled, onSelect, onAction }: {
  view: ConnectionProfilesView; selected?: string; locked: boolean; disabled: boolean;
  onSelect(id: string): void; onAction?: ConnectionProfileHandler;
}) {
  const [adding, setAdding] = useState(false), [error, setError] = useState<string>();
  const busy = disabled || view.busy;
  const chosen = view.profiles.find(profile => profile.id === selected);
  const tested = view.lastTest?.profileId === selected ? view.lastTest : undefined;
  const full = view.profiles.length >= CONNECTION_PROFILE_CAPACITY;
  return <>
    <div className="connection-profile-bar" aria-label="Saved connection setup">
      <label>Connection<select aria-label="Saved connection" value={chosen?.id ?? ''} disabled={busy || locked} onChange={event => onSelect(event.target.value)}>
        <option value="">Choose a saved connection</option>{view.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label} · v{profile.revision}</option>)}
      </select></label>
      {onAction && !locked && <button disabled={busy || full} onClick={() => { setError(undefined); setAdding(true); }}>Add connection</button>}
      {onAction && chosen && <button disabled={busy} onClick={() => { setError(undefined); void onAction({ action: 'test', profileId: chosen.id }).catch(() => setError('The connection check could not complete.')); }}>Test connection</button>}
      <span className={tested?.ok === false && tested.code !== 'connection-check-unavailable' ? 'connection-profile-failed' : 'connection-profile-note'} role="status">{error ?? (busy ? 'Checking connection…' : tested ? tested.code === 'connection-check-unavailable' ? 'Connection check unavailable' : tested.ok ? 'Connection check passed' : 'Connection check failed' : locked ? 'Connection pinned for this workflow' : full ? 'Connection limit reached. Choose a saved connection.' : view.requiredAtStart && !chosen ? 'Choose a connection before starting' : 'Saved by this host')}</span>
    </div>
    {adding && <DetailsPanel title="Add connection" onClose={() => { setAdding(false); setError(undefined); }}>
      {error && <p className="connection-profile-failed" role="alert">{error}</p>}
      <ConnectionProfileForm schemas={view.schemas} disabled={busy || full} onSave={async registration => {
        if (!onAction) return;
        setError(undefined);
        try { const result = await onAction({ action: 'register', registration }); if (result.action === 'register') { onSelect(result.profile.id); setAdding(false); } }
        catch { setError('The connection was refused. Check the fields and allowed target.'); }
      }}/>
    </DetailsPanel>}
  </>;
}
