import type { OnboardingVersionAction, OnboardingVersionSnapshot } from '../../../../src/core/onboarding-versions.ts';
import { currentSetupReview, setupBlockerLabels, setupChangeLabels, setupOwnerLabels } from './model.ts';

/** Only registered IDs and the current native sealed review cross the browser boundary. */
export function VersionReview({ view, selected, setSelected, disabled, technical, onTechnical, onAction }: {
  view: OnboardingVersionSnapshot; selected: string; setSelected(id: string): void; disabled: boolean; technical: boolean; onTechnical(): void;
  onAction?(input: OnboardingVersionAction): void;
}) {
  const review = currentSetupReview(view, selected), incomplete = !view.busy && view.status === 'incomplete';
  return <div className="setup-version-review">
    <p>Review the desired setup before activating it. Resource changes still go through the deployment review afterward.</p>
    <label>Available setup<select aria-label="Available setup version" value={selected} disabled={disabled || incomplete} onChange={event => setSelected(event.target.value)}>{view.versions.map(version => <option key={version.id} value={version.id}>{version.label}{version.id === view.activeVersionId ? ' · Current' : ''}</option>)}</select></label>
    {selected === view.activeVersionId && <p>This setup is already active.</p>}
    {review && <section className={'setup-version-diff ' + (review.eligible ? 'setup-update-eligible' : 'setup-update-blocked')} aria-label="Reviewed setup changes">
      <h3>{view.busy ? 'Recording the setup update…' : review.eligible ? review.noop ? 'No setup changes' : 'Setup changes ready for review' : 'Update blocked'}</h3>
      {review.changes.length ? <ul>{review.changes.map(change => <li key={change.field}><strong>{setupChangeLabels[change.field]}</strong><span>Changes in this setup</span></li>)}</ul> : <p>The registered setup digests are unchanged.</p>}
      {!view.busy && review.blockers.length > 0 && <ul className="setup-version-blockers" aria-label="Update blockers">{review.blockers.map((blocker, index) => <li key={blocker.ownerId + ':' + index}><strong>{setupOwnerLabels[blocker.kind]}</strong><span>{setupBlockerLabels[blocker.status]}</span><small>Owner: <code>{blocker.ownerId}</code>{blocker.runId && <> · Native run: <code>{blocker.runId}</code></>}</small></li>)}</ul>}
      <button type="button" className="setup-version-text-button" onClick={onTechnical}>{technical ? 'Hide technical diff' : 'Show technical diff'}</button>
      {technical && <><dl><dt>From version</dt><dd><code>{review.fromVersionId}</code></dd><dt>To version</dt><dd><code>{review.toVersionId}</code></dd><dt>Registry head</dt><dd>{review.head}</dd><dt>Sealed review</dt><dd><code>{review.reviewId}</code></dd>{review.recording && <><dt>Native review run</dt><dd><code>{review.recording.runId}</code></dd></>}</dl><table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>{review.changes.map(change => <tr key={change.field}><td>{setupChangeLabels[change.field]}</td><td><code>{change.before}</code></td><td><code>{change.after}</code></td></tr>)}</tbody></table></>}
      <p className="setup-version-impact">Activation selects the desired setup. It does not create, replace, restart or delete resources. Next, check setup and review the native deployment plan.</p>
    </section>}
    {incomplete && <p role="status" className="setup-version-warning">The original update has an unconfirmed outcome. Inspect it before reviewing another setup.</p>}
    {!view.busy && view.error && <p role="status" className="setup-version-warning">{view.error}</p>}
    <footer><button type="button" className="button button-secondary" disabled={disabled || !onAction} onClick={() => onAction?.({ action: 'refresh' })}>Read status</button>
      {incomplete && view.canReconcile && view.review ? <button type="button" className="button button-primary" disabled={disabled || !onAction} onClick={() => onAction?.({ action: 'reconcile-activation', reviewId: view.review!.reviewId })}>Inspect update outcome</button>
        : <><button type="button" className="button button-secondary" disabled={disabled || !view.canReview || selected === view.activeVersionId || !onAction} onClick={() => onAction?.({ action: 'review-version', versionId: selected })}>Review setup update</button>
          <button type="button" className="button button-primary" disabled={disabled || !review || !view.canActivate || !review.eligible || !onAction} onClick={() => { if (review) onAction?.({ action: 'activate-version', reviewId: review.reviewId }); }}>Activate reviewed setup</button></>}
    </footer>
  </div>;
}
