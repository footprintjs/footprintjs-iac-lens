import type {TopologyNodeView,TopologyBoundaryView} from 'footprintjs-iac/system-topology';
import * as ExplainableUI from 'footprint-explainable-ui/flowchart';
import type {RecordedDeploymentStep} from '../../../src/core/topology-deployment-step.ts';
import type {DiagramSymbolDefinition} from '../../../src/core/system-symbols.ts';
import {componentArtworkSize,type TopologyBox} from './topology-layout.ts';
import {DiagramSymbol} from './DiagramSymbol.tsx';
import {TechnologyMark} from './TechnologyMark.tsx';
import {TopologyNodeEvidence} from './TopologyNodeEvidence.tsx';
import type {objectActivity} from './object-activity.ts';

const categories={compute:'Compute',storage:'Storage',network:'Network',identity:'Identity & access',other:'Component'};

/** The drawing is the object. Recorded captions and progress are unframed annotations. */
export function TopologyObjectNode({node,box,symbol,onSelect,step,onRecordedStep,executionFocus,activity}:{node:TopologyNodeView;box:TopologyBox;symbol:DiagramSymbolDefinition;executionFocus?:boolean;step?:RecordedDeploymentStep;onSelect?():void;onRecordedStep?(step:RecordedDeploymentStep):void;activity?:ReturnType<typeof objectActivity>}) {
 const label=`${categories[node.category]} · ${node.label} · ${node.originLabel} · ${node.statusLabel}`;
 // Released peers without the appearance helper continue to render the existing artwork and native evidence.
 const Appearance = ExplainableUI.DiagramNodeAppearance;
 const art = <DiagramSymbol symbol={symbol} className="topology-object-art" size={componentArtworkSize}/>;
 const content=<>
  <div className="topology-object-artwork" style={componentArtworkSize} data-operation-scope={activity?.shared?'shared':undefined}>
   {Appearance?<Appearance appearance={activity?.appearance}>{art}</Appearance>:art}
  </div>
  <strong title={node.label}>{node.label}</strong>
  <span className="topology-object-meta"><span className={`topology-origin origin-${node.origin}`}>{node.originLabel}</span><span className="topology-node-category">{categories[node.category]}</span></span>
  <span className="topology-node-context"><TechnologyMark technology={node.technology} category={node.category}/><span className="topology-node-status" aria-live="polite" title={node.statusLabel}><i/>{node.statusLabel}{node.evidenceScope==='shared-resource'&&<small title="One shared provider operation"> · shared operation</small>}</span></span></>;
 return <div className={`topology-object topology-${node.status}`} data-system-object="component" style={{left:box.x,top:box.y,width:box.width,height:box.height}}
  data-component-id={node.id} data-origin={node.origin} data-execution-focus={executionFocus?'true':undefined}>
  {onSelect?<button type="button" className="topology-object-summary" aria-label={label} onClick={onSelect}>{content}</button>:<div className="topology-object-summary" aria-label={label}>{content}</div>}
  <TopologyNodeEvidence node={node} step={step} onRecordedStep={onRecordedStep}/>
 </div>;
}

const boundaryLabels={pending:'Waiting',installing:'Installing',starting:'Starting',checking:'Checking',connected:'Connected',ready:'Ready',failed:'Needs attention',unknown:'Not verified',incomplete:'Recording incomplete',skipped:'Skipped',removed:'Removed'};

/** Physical boundary artwork has its own measured slot, beside its native label. */
export function TopologyObjectBoundary({boundary,box,symbol,onSelect,executionFocus}:{boundary:TopologyBoundaryView;box:TopologyBox;symbol:DiagramSymbolDefinition;executionFocus?:boolean;onSelect?():void}) {
 const status=boundary.status==='pending'&&!boundary.observed?'Placement declared':boundaryLabels[boundary.status];
 const progress=boundary.progress,label=`${boundary.label} · ${boundary.kind} · ${status}`;
 const content=<><DiagramSymbol symbol={symbol} className="topology-boundary-object-art"/><span className="topology-object-boundary-caption"><strong title={boundary.label}>{boundary.label}</strong><span>{boundary.technology?<TechnologyMark technology={boundary.technology}/>:boundary.kind}</span><small>{status}</small></span></>;
 return <div className={`topology-object-boundary topology-${boundary.status}`} data-system-object="boundary" data-boundary-id={boundary.id} data-parent-id={boundary.parentId} data-execution-focus={executionFocus?'true':undefined} style={{left:box.x,top:box.y,width:box.width,height:box.height}}>
  {onSelect?<button type="button" className="topology-object-boundary-summary" onClick={onSelect} aria-label={label}>{content}</button>:<div className="topology-object-boundary-summary" aria-label={label}>{content}</div>}
  <div className="topology-object-boundary-progress" role="progressbar" aria-label={`${boundary.label}: recorded component progress`} aria-valuemin={0} aria-valuemax={progress.total||undefined} aria-valuenow={progress.indeterminate?undefined:progress.completed} aria-valuetext={progress.indeterminate?'Not fully verified':`${progress.completed} of ${progress.total} observed`}>
   <i style={{width:`${progress.total?Math.min(100,100*progress.completed/progress.total):0}%`}}/>
  </div>
 </div>;
}
