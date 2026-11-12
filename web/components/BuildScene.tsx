import { useId } from 'react';
import type { projectBuildScene } from '../../src/core/build-scene.ts';
import type { RevisionResourceView } from '../../src/core/revision-review.ts';
import { BuildGlyph } from './BuildGlyph.tsx';
import type { ResourceFlowState } from '../../src/core/resource-flow.ts';

type Scene = ReturnType<typeof projectBuildScene>;
type SceneNode = Scene['nodes'][number];

function caption(node: SceneNode) {
  if (node.uncertain) return 'Unconfirmed';
  if (node.status === 'deploying') return isChecking(node) ? 'Checking' : node.action === 'update' ? 'Updating' : 'Building';
  if (node.status === 'ready' && node.action === 'find') return 'Found';
  return { pending: 'Waiting', ready: 'Ready', failed: 'Needs attention', skipped: 'Skipped', deleted: 'Removed' }[node.status];
}

function isChecking(node: SceneNode) { return /^(?:noop|no-op|verify|check|read|observe|find)$/i.test(node.action ?? ''); }

/** Stable positions come from the native flow; links below show observed communication. */
export function BuildScene({ scene, execution = 'idle', workflowStatus, changes }: { scene: Scene; execution?: 'idle' | 'running' | 'passed' | 'failed'; workflowStatus?: ResourceFlowState['status']; changes?: readonly RevisionResourceView[] }) {
  const markerId = `build-arrow-${useId().replace(/:/g, '')}`;
  const descriptionId = `${markerId}-description`;
  const changeMap = new Map(changes?.map(change => [change.resourceId, change]));
  const columns = [...new Set(scene.nodes.map(node => node.column))].sort((a, b) => a - b);
  const rows = Math.max(0, ...scene.nodes.map(node => node.row)) + 1;
  const width = Math.max(800, 150 + columns.length * 176);
  const height = Math.max(380, rows * 218 + 155);
  const locations = new Map(scene.nodes.map(node => [node.id, {
    x: 150 + columns.indexOf(node.column) * 176,
    y: 42 + node.row * 218,
  }]));
  const captured = scene.nodes.some(node => node.step !== undefined);
  const codeExecution = workflowStatus === 'running' ? 'running' : workflowStatus === 'passed' ? 'passed' : workflowStatus === 'failed' ? 'failed' : workflowStatus ? 'idle' : execution;
  const codeStatus = codeExecution === 'running' ? 'deploying' : (captured || workflowStatus) && codeExecution === 'passed' ? 'ready' : (captured || workflowStatus) && codeExecution === 'failed' ? 'failed' : 'pending';
  return <div className="simple-scene" role="group" aria-label="Your system being built">
    <svg className="simple-scene-canvas" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Build flow and live connections" aria-describedby={descriptionId}>
      <desc id={descriptionId}>{scene.nodes.map(node => `${node.title}: ${caption(node)}${node.step && !workflowStatus ? `, recorded step ${node.step}` : ''}${changeMap.has(node.id) ? `; planned ${changeMap.get(node.id)!.label.toLowerCase()}` : ''}.`).join(' ')} {scene.edges.map(edge => `${scene.nodes.find(node => node.id === edge.from)?.title ?? edge.from} to ${scene.nodes.find(node => node.id === edge.to)?.title ?? edge.to}: ${edge.status}.`).join(' ')}</desc>
      <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1l8 4-8 4" fill="none" stroke="currentColor" strokeWidth="1.5"/></marker></defs>
      {scene.flowEdges.map(edge => {
        const from = locations.get(edge.from), to = locations.get(edge.to);
        if (!from || !to) return null;
        const x1 = from.x + 140, y1 = from.y + 86, x2 = to.x + 16, y2 = to.y + 86;
        const mid = (x1 + x2) / 2;
        return <path key={edge.id} className={`simple-build-link build-link-${edge.kind}`} d={`M${x1},${y1}H${mid}V${y2}H${x2}`} markerEnd={`url(#${markerId})`}><title>{edge.kind === 'dependency' ? 'Required first' : edge.kind === 'native-schedule' ? 'Planned build flow' : 'Recorded build order'}</title></path>;
      })}
      {scene.edges.map((edge, index) => {
        const from = locations.get(edge.from), to = locations.get(edge.to);
        if (!from || !to) return null;
        const x1 = from.x + 78, x2 = to.x + 78, y1 = from.y + 185, y2 = to.y + 185;
        const bottom = Math.max(y1, y2) + 45 + (index % 3) * 18;
        return <g key={edge.id} className={`simple-wire wire-${edge.status}`}><title>{`${edge.status}: ${scene.nodes.find(node => node.id === edge.from)?.title ?? ''} to ${scene.nodes.find(node => node.id === edge.to)?.title ?? ''}`}</title>
          <path d={`M${x1},${y1}C${x1},${bottom} ${x2},${bottom} ${x2},${y2}`} markerEnd={`url(#${markerId})`}/>
          <circle cx={(x1 + x2) / 2} cy={.125 * (y1 + y2) + .75 * bottom} r="5"/>
        </g>;
      })}
      <foreignObject x="0" y="42" width="142" height="220"><div className={`simple-object simple-code${scene.phase === 'starting' ? ' object-active' : ''}`}>
        <span className="simple-step">START</span><BuildGlyph kind="code" status={codeStatus}/><strong>Your code</strong><span className="simple-object-caption">{workflowStatus === 'paused' ? 'Paused' : codeStatus === 'deploying' ? 'Running' : codeStatus === 'failed' ? 'Stopped' : codeStatus === 'ready' ? 'Finished' : codeExecution === 'idle' ? 'Ready to run' : 'Unconfirmed'}</span>
      </div></foreignObject>
      {scene.nodes.map(node => {
        const position = locations.get(node.id)!;
        const active = scene.activeIds.includes(node.id);
        const embedded = node.embedded.find(unit => unit.kind === 'storage') ?? node.embedded[0];
        const change = changeMap.get(node.id);
        return <foreignObject key={node.id} x={position.x} y={position.y} width="156" height="216"><div className={`simple-object object-${node.status}${active ? ' object-active' : ''}${node.uncertain ? ' object-uncertain' : ''}${change ? change.affected ? ' revision-affected' : ' revision-unchanged' : ''}`} aria-label={`${node.title}: ${caption(node)}${change ? `; planned ${change.label.toLowerCase()}` : ''}`}>
          <span className="simple-step"><span>{workflowStatus ? '' : node.step ? String(node.step).padStart(2, '0') : '·'}</span>{change && <span className="simple-change-label">{change.label}</span>}</span>
          <BuildGlyph kind={node.kind} status={node.uncertain && node.status === 'deploying' ? 'pending' : node.status} checking={isChecking(node)}/>
          <strong>{node.title}</strong><span className="simple-object-caption">{caption(node)}</span>
          {embedded && <span className="simple-embedded" aria-label={`Inside ${node.title}: ${node.embedded.map(unit => unit.title).join(', ')}`}><BuildGlyph kind={embedded.kind} status={embedded.status} small/><span>{embedded.kind === 'storage' ? 'Data' : embedded.title} inside</span></span>}
        </div></foreignObject>;
      })}
    </svg>
    <div className="simple-scene-key"><span><i className="key-build"/>Build flow</span>{scene.edges.length > 0 && <span><i className="key-connection"/>Connections</span>}</div>
  </div>;
}
