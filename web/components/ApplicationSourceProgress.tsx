import type { ApplicationSourceView } from '../../src/core/application-source.ts';
import { Icon } from './Icon.tsx';

const labels = { resolve: 'Choose version', fetch: 'Get code', build: 'Build package', publish: 'Store package' };
const outcomes = { pending: 'Code is waiting', running: 'Preparing application code', ready: 'Code is ready', failed: 'Code needs attention', incomplete: 'Code result not confirmed' };

/** Recorded source stages are independent of resource creation and application promotion. */
export function ApplicationSourceProgress({ source }: { source: ApplicationSourceView }) {
  return <section className="application-source" aria-label="Application code">
    <header><strong>{outcomes[source.status]}</strong><span>{source.label}</span></header>
    <ol className="application-setup-steps application-source-steps" aria-label="Code preparation progress">{source.stages.map((stage, index) => {
      const status = source.status === 'incomplete' && stage.status === 'running' ? 'unknown' : stage.status;
      return <li key={stage.id} className={'application-step-' + status} aria-label={labels[stage.id] + ': ' + status}>
        <span>{stage.status === 'passed' ? <Icon name="check" size={12}/> : index + 1}</span><strong>{labels[stage.id]}</strong></li>;
    })}</ol>
  </section>;
}
export function ApplicationSourceDetails({ source }: { source: ApplicationSourceView }) {
  return <section><h3>Recorded source input</h3><dl>
    <div><dt>Adapter</dt><dd>{source.providerId}</dd></div><div><dt>Repository</dt><dd>{source.repository}</dd></div>
    <div><dt>Selected version</dt><dd>{source.ref}</dd></div><div><dt>Target</dt><dd>{source.binding.strategyId} / {source.binding.targetId}</dd></div>
    {source.commit && <div><dt>Exact commit</dt><dd><code>{source.commit}</code></dd></div>}
    {source.tree && <div><dt>Source tree</dt><dd><code>{source.tree}</code></dd></div>}
    <div><dt>Source definition</dt><dd><code>{source.definitionDigest}</code></dd></div>
    {source.receiptDigest && <div><dt>Exact prepared receipt</dt><dd><code>{source.receiptDigest}</code></dd></div>}
    <div><dt>Build recipe</dt><dd><code>{source.recipeDigest}</code></dd></div>
    <div><dt>Configuration</dt><dd><code>{source.configurationDigest}</code></dd></div>
    <div><dt>Native recording</dt><dd>{source.recording ? <code>{source.recording.runId}</code> : 'Not confirmed'}</dd></div>
  </dl><p>Preparing code does not confirm deployment. The selected application review and runtime checks determine readiness.</p></section>;
}
