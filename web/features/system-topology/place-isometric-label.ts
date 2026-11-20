import {labelRect,overlaps,type Rect,type TopologyPoint,type TopologyRoute} from './topology-route-geometry.ts';

/** Floor-wire badges stay upright and clear of elevated cards and boundary headings. */
export function placeIsometricLabel(route:TopologyRoute,obstacles:readonly Rect[],used:readonly TopologyRoute[],expanded=false,clearance?:(rect:Rect,leader?:{from:TopologyPoint;to:TopologyPoint})=>boolean):TopologyRoute {
  if(!route.path||route.labelHidden)return route;
  const candidates:(TopologyPoint&{anchor?:TopologyPoint})[]=[{x:route.x,y:route.y}];
  for(let index=1;index<route.points.length;index++){
    const a=route.points[index-1]!,b=route.points[index]!;
    const length=Math.hypot(b.x-a.x,b.y-a.y);if(length<36)continue;
    const offsets=expanded?[0,-26,26,-44,44,-66,66,-88,88,-112,112,-144,144]:[0,-26,26,-44,44,-66,66];
    for(const offset of offsets)for(const fraction of [.5,.35,.65,.2,.8]){
      const anchor={x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction};
      candidates.push({x:anchor.x-(b.y-a.y)/length*offset,y:anchor.y+(b.x-a.x)/length*offset,...offset?{anchor}:{}});
    }
  }
  for(const point of candidates){
    const rect=labelRect(point);
    const leader=point.anchor?{from:point.anchor,to:{x:point.x,y:point.y}}:undefined;
    if(obstacles.some(obstacle=>overlaps(rect,obstacle,5))||clearance&&!clearance(rect,leader))continue;
    if(used.some(other=>!other.labelHidden&&overlaps(rect,labelRect(other),5)))continue;
    const {anchor,...label}=point;
    return{...route,...label,...anchor?{labelAnchor:anchor}:{}};
  }
  return{...route,labelHidden:true};
}
