import type { OnboardingVersionSnapshot } from '../../../../src/core/onboarding-versions.ts';

export function VersionHistory({ view }: { view: OnboardingVersionSnapshot }) {
  return <section className="setup-version-history" aria-label="Recorded configuration history"><p>Each retained version keeps its own workflow and native references. Historical readiness does not promote the current setup.</p>
    {[...view.history].reverse().map(entry => { const version = view.versions.find(version => version.id === entry.versionId)!; return <details key={entry.head}><summary><strong>{version.label}</strong><span>Head {entry.head} · {entry.versionId === view.activeVersionId ? 'Current version' : 'Historical version'} · Recorded {entry.workflow.status}</span></summary>
      <dl><dt>Version ID</dt><dd><code>{entry.versionId}</code></dd><dt>Configuration digest</dt><dd><code>{version.definition.configurationDigest}</code></dd><dt>Release digest</dt><dd><code>{version.releaseDigest}</code></dd><dt>Checks digest</dt><dd><code>{version.checksDigest}</code></dd><dt>Profile digest</dt><dd><code>{version.profileDigest}</code></dd>{entry.recording && <><dt>Activation run</dt><dd><code>{entry.recording.runId}</code></dd></>}{entry.workflow.recording && <><dt>Workflow run</dt><dd><code>{entry.workflow.recording.runId}</code></dd></>}</dl>
      {entry.workflow.checks.length > 0 && <table><thead><tr><th>Recorded check</th><th>Result</th></tr></thead><tbody>{entry.workflow.checks.map(check => <tr key={check.id}><td>{check.label}<small>{check.id}</small></td><td>{check.status}</td></tr>)}</tbody></table>}
    </details>; })}
  </section>;
}
