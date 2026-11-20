import {useId} from 'react';
import {EdgeLabelRenderer,type EdgeProps} from '@xyflow/react';
import {connectionColour,connectionColours} from './connection-colours.ts';
import {useSystemGraph} from './SystemGraphNodes.tsx';

const labels={untested:'Not checked',checking:'Checking',connected:'Connected',failed:'Failed',unknown:'Unconfirmed',incomplete:'Incomplete'};
/** Route and status come from physical topology, not EUI execution-edge overlays. */
export function SystemGraphConnection({id}:EdgeProps){
  const {view,placement,onSelect}=useSystemGraph(),edge=view.connections.find(row=>row.id===id),route=placement.routes.get(id);
  const markerBase=`system-edge-${useId().replace(/:/g,'')}`;
  if(!edge||!route?.path)return null;
  const marker=`${markerBase}-${edge.status}`,markerSize='objects' in placement?12:8;
  const color=connectionColour(edge,connectionColours(view.connections)),label=labels[edge.status];
  const content=<>{edge.status==='connected'&&<i className="topology-edge-swatch" aria-hidden="true" style={{background:color}}/>}{label}</>;
  return <>
    <defs><marker id={marker} markerUnits="userSpaceOnUse" markerWidth={markerSize} markerHeight={markerSize} viewBox="0 0 8 8" refX="8" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 Z" fill={color}/></marker></defs>
    {edge.kind==='communicatesWith' && onSelect && <path d={route.path} fill="none" stroke="transparent" strokeWidth={15} style={{pointerEvents:'stroke',cursor:'pointer'}} onClick={()=>onSelect({kind:'connection',id})}/>}
    <g pointerEvents="none" style={{color}} className={`topology-edge edge-${edge.status}${edge.kind==='dependsOn'?' edge-dependency':''}`}>
      <path className="topology-wire-halo" d={route.path}/><path className="topology-wire-line" d={route.path} markerEnd={`url(#${marker})`}/><title>{`${edge.label??edge.kind}: ${label}`}</title>
      {route.labelAnchor&&!route.labelHidden&&<path className="topology-wire-label-leader" d={`M ${route.labelAnchor.x} ${route.labelAnchor.y} L ${route.x} ${route.y}`}/>}
    </g>
    {edge.kind==='communicatesWith'&&!route.labelHidden&&<EdgeLabelRenderer>{onSelect?<button type="button" className={`topology-edge-label nodrag nopan edge-${edge.status}`} style={{left:route.x,top:route.y,pointerEvents:'auto'}}
      onClick={()=>onSelect({kind:'connection',id})} title={edge.label} aria-label={`${edge.label??edge.kind}: ${label}`} aria-live="polite">{content}</button>
      :<span className={`topology-edge-label edge-${edge.status}`} style={{left:route.x,top:route.y}} title={edge.label} aria-label={`${edge.label??edge.kind}: ${label}`}>{content}</span>}</EdgeLabelRenderer>}
  </>;
}
