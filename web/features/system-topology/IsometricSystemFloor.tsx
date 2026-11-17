import type {SystemGraphData} from './create-system-graph.ts';
import {isometricSystemPath} from './create-isometric-system-graph.ts';

/** Decorative depth and a native verification outline; it performs no progress estimation. */
export function IsometricSystemFloor({points,status,boundary=false,progress}:{points:NonNullable<SystemGraphData['isometric']>['floor'];status:string;boundary?:boolean;progress?:{completed:number;total:number;indeterminate:boolean}}){
  if(points.length!==4)return null;
  const at=(index:number,depth=0)=>`${points[index]!.x},${points[index]!.y+depth}`;
  const complete=progress&&!progress.indeterminate&&progress.total>0?Math.min(1,Math.max(0,progress.completed/progress.total)):undefined;
  return <svg className={`topology-isometric-floor topology-${status}${boundary?' floor-boundary':' floor-component'}`} data-physical-floor={boundary?'boundary':'component'} aria-hidden="true" focusable="false">
    <polygon className="isometric-depth depth-left" points={[at(3),at(2),at(2,8),at(3,8)].join(' ')}/>
    <polygon className="isometric-depth depth-right" points={[at(1),at(2),at(2,8),at(1,8)].join(' ')}/>
    <polygon className="isometric-plane" points={points.map((_,index)=>at(index)).join(' ')}/>
    {boundary&&complete!==undefined&&<path className="isometric-progress" d={isometricSystemPath([...points,points[0]!])} pathLength={1} strokeDasharray={`${complete} ${1-complete}`} data-observed-progress={complete}/>}
  </svg>;
}
