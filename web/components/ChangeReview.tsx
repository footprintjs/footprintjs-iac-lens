import { useState } from 'react';
import type { RevisionReviewView } from '../../src/core/revision-review.ts';
import { DetailsPanel } from './DetailsPanel.tsx';
import { Icon } from './Icon.tsx';
import './change-review.css';

function summary(view: RevisionReviewView): string {
  if (!view.resources.length) return '';
  const changes = view.affected.filter(row => row.action !== 'verify').length;
  const checks = view.affected.filter(row => row.action === 'verify').length;
  return [changes ? `${changes} ${changes === 1 ? 'change' : 'changes'}` : '',
    checks ? `${checks} ${checks === 1 ? 'check' : 'checks'}` : '',
    view.unchanged.length ? `${view.unchanged.length} unchanged` : ''].filter(Boolean).join(' · ');
}
function json(value: unknown): string { return value === undefined ? '(not present)' : JSON.stringify(value, null, 2); }

/** Small version bar in Simple; exact resource and JSON differences stay behind Details. */
export function ChangeReview({ view, disabled, onReview, onApply }: {
  view: RevisionReviewView; disabled: boolean; onReview(): void; onApply(): void;
}) {
  const [details, setDetails] = useState(false);
  return <>
    <section className={`change-review revision-${view.state.status}`} aria-label="Version and changes">
      <div className="change-review-version"><span className="change-review-icon"><Icon name="file" size={19}/></span>
        <div><span className="change-review-label">Version</span><strong><span>{view.currentLabel ?? 'Not deployed'}</span>
          {view.candidateLabel && <><Icon name="arrow" size={13}/><span>{view.candidateLabel}</span></>}
        </strong></div>
      </div>
      <div className="change-review-summary" aria-live="polite"><strong>{view.headline}</strong><span>{summary(view)}</span></div>
      <div className="change-review-actions">
        <button className="change-review-details" onClick={() => setDetails(true)}>Details</button>
        <button className="simple-button simple-secondary" disabled={disabled || !view.canReview} onClick={onReview}>
          {view.state.status === 'reviewing' ? 'Reviewing…' : 'Review changes'}
        </button>
        {view.state.candidate && <button className="simple-button simple-primary" disabled={disabled || !view.canApply} onClick={onApply}>
          <Icon name="play" size={14}/>{view.state.status === 'applying' ? 'Updating…' : view.applyLabel}
        </button>}
      </div>
    </section>
    {details && <DetailsPanel title="Version and changes" onClose={() => setDetails(false)}>
      <div className="revision-details">
        <p>Only planned changes are highlighted. Resource progress still comes from the native FootPrint recording.</p>
        <dl>{view.state.current && <><dt>Current revision</dt><dd>{view.state.current.label ?? view.state.current.id}<code>{view.state.current.digest}</code></dd></>}
          {view.state.candidate && <><dt>Candidate revision</dt><dd>{view.state.candidate.label ?? view.state.candidate.id}<code>{view.state.candidate.digest}</code></dd></>}
          {view.state.runId && <><dt>Recorded run</dt><dd><code>{view.state.runId}</code></dd></>}
        </dl>
        {view.state.error && <p className="revision-details-error" role="status">{view.state.error}</p>}
        {view.resources.length === 0 ? <p>Review changes to load the current deployment plan.</p> : <div className="revision-resource-list">{view.resources.map(row => <article key={row.resourceId} className={`revision-resource revision-action-${row.action}`}>
          <header><strong>{row.title}</strong><span>{row.label}</span><code>{row.resourceId}</code></header>
          {row.changes?.length ? <div className="revision-field-list">{row.changes.map((field, index) => <div key={`${field.path}:${index}`} className="revision-field">
            <code className="revision-field-path">{field.path}</code><div><section><span>Before</span><pre>{json(field.before)}</pre></section><section><span>After</span><pre>{json(field.after)}</pre></section></div>
          </div>)}</div> : row.action !== 'noop' && <p>{row.change === 'drift' ? 'The live resource differs from the desired definition.' : row.action === 'verify' ? 'Readiness will be verified without a planned configuration change.' : 'The host has not supplied field-level differences.'}</p>}
        </article>)}</div>}
      </div>
    </DetailsPanel>}
  </>;
}
