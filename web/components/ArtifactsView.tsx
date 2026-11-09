import { useState } from 'react';
import type { OutputArtifact } from '../../src/core/types.ts';
import { Icon } from './Icon.tsx';

function download(artifact: OutputArtifact) {
  const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mediaType ?? 'text/plain' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = artifact.path.split('/').at(-1) ?? 'artifact.txt';
  document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}
export function ArtifactsView({ artifacts }: { artifacts: OutputArtifact[] }) {
  const [path, setPath] = useState<string>();
  const selected = artifacts.find(artifact => artifact.path === path) ?? artifacts[0];
  if (!selected) return <div className="empty-state"><span className="empty-icon"><Icon name="file" size={30}/></span><h3>Deployment outputs, with their origins</h3><p>Generated native files and their source mappings will appear here when a supported output binding is available.</p><span className="source-chip">Generated artifacts are separate from deployment readiness</span></div>;
  return <div className="artifacts-view"><aside className="artifact-files"><h4>GENERATED FILES <span>{artifacts.length}</span></h4>{artifacts.map(artifact => <button key={artifact.id ?? artifact.path} className={artifact.path === selected.path ? 'artifact-file selected' : 'artifact-file'} onClick={() => setPath(artifact.path)}><Icon name="file" size={18}/><span className="full-identifier">{artifact.path}<small>{artifact.target ?? artifact.mediaType ?? 'Native artifact'}</small></span></button>)}<p>Files are generated from the validated desired model. Downloading a file does not deploy it.</p></aside>
    <section className="artifact-content"><div className="artifact-toolbar"><div><h3>{selected.path}</h3><span>{selected.mediaType ?? 'text/plain'}</span></div><button className="button button-secondary" onClick={() => download(selected)}><Icon name="download" size={16}/>Download</button></div><pre tabIndex={0}>{selected.content}</pre>{selected.sha256 && <footer><strong>SHA-256</strong><code className="full-identifier">{selected.sha256}</code></footer>}</section></div>;
}
