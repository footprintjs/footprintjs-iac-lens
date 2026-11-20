import {isometricSegmentCrosses} from './isometric-object-routing.ts';
import {labelRect,type Rect,type TopologyPoint,type TopologyRoute} from './topology-route-geometry.ts';

/** A callout clears other wires and keeps its pointer outside every upright annotation. */
export function createIsometricLabelClearance(id:string,routes:ReadonlyMap<string,TopologyRoute>,obstacles:readonly Rect[],placed:readonly TopologyRoute[]) {
 const foreign=[...routes].filter(([otherId])=>otherId!==id).map(([,route])=>route);
 const occupied=[...obstacles,...placed.filter(route=>!route.labelHidden).map(labelRect)];
 return(rect:Rect,leader?:{from:TopologyPoint;to:TopologyPoint}):boolean=>{
  if(foreign.some(route=>route.points.some((point,index)=>index>0&&isometricSegmentCrosses(route.points[index-1]!,point,rect,3))))return false;
  return !leader||occupied.every(obstacle=>!isometricSegmentCrosses(leader.from,leader.to,obstacle,3));
 };
}
