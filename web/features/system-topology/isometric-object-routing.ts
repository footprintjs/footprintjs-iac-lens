import type {Rect,TopologyPoint,TopologyRoute} from './topology-route-geometry.ts';

export interface IsometricArtworkPort {point:TopologyPoint;side:'left'|'right'}
export interface IsometricRouteObject {id:string;body:Rect;ground:TopologyPoint;ports?:readonly IsometricArtworkPort[]}
export interface IsometricRouteConnection {id:string;from:string;to:string}
interface Terminal {point:TopologyPoint;escape:TopologyPoint;penalty:number}
interface Search {key:string;x:number;y:number;direction:number;cost:number;score:number;terminal:number}
const X=Math.sqrt(3)/2*1.35,Y=.675,EPS=.00001;
const project=(point:TopologyPoint):TopologyPoint=>({x:(point.x-point.y)*X,y:(point.x+point.y)*Y});
const plane=(point:TopologyPoint):TopologyPoint=>({x:(point.y/Y+point.x/X)/2,y:(point.y/Y-point.x/X)/2});
const corners=(rect:Rect)=>[{x:rect.x,y:rect.y},{x:rect.x+rect.width,y:rect.y},{x:rect.x+rect.width,y:rect.y+rect.height},{x:rect.x,y:rect.y+rect.height}];

/** Exact screen-space collision check; plane AABBs would block usable diagonal corridors. */
export function isometricSegmentCrosses(a:TopologyPoint,b:TopologyPoint,rect:Rect,padding=5):boolean {
 let low=0,high=1;
 for(const axis of ['x','y']as const){
  const delta=b[axis]-a[axis],min=rect[axis]-padding,max=rect[axis]+(axis==='x'?rect.width:rect.height)+padding;
  if(Math.abs(delta)<EPS){if(a[axis]<=min+EPS||a[axis]>=max-EPS)return false;continue;}
  const first=(min-a[axis])/delta,last=(max-a[axis])/delta;
  low=Math.max(low,Math.min(first,last));high=Math.min(high,Math.max(first,last));
  if(low>=high-EPS)return false;
 }
 return low<1-EPS&&high>EPS;
}

function wireCost(a:TopologyPoint,b:TopologyPoint,used:readonly TopologyRoute[]):number {
 let cost=0;
 for(const route of used)for(let index=1;index<route.points.length;index++){
  const c=plane(route.points[index-1]!),d=plane(route.points[index]!);
  const horizontal=Math.abs(a.y-b.y)<EPS,otherHorizontal=Math.abs(c.y-d.y)<EPS;
  if(horizontal===otherHorizontal){
   const gap=Math.abs(horizontal?a.y-c.y:a.x-c.x),overlap=horizontal?Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x)):Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y));
   if(overlap>0&&gap<12)cost+=overlap*(12-gap)*2;
  }else{
   const h=horizontal?a:c,hEnd=horizontal?b:d,v=horizontal?c:a,vEnd=horizontal?d:b;
   if(v.x>Math.min(h.x,hEnd.x)+EPS&&v.x<Math.max(h.x,hEnd.x)-EPS&&h.y>Math.min(v.y,vEnd.y)+EPS&&h.y<Math.max(v.y,vEnd.y)-EPS)cost+=40;
  }
 }
 return cost;
}

function routeOne(sources:readonly Terminal[],targets:readonly Terminal[],rectangles:readonly Rect[],used:readonly TopologyRoute[]):TopologyPoint[]|undefined {
 if(!sources.length||!targets.length)return;
 const starts=sources.map(port=>plane(port.escape)),ends=targets.map(port=>plane(port.escape));
 const expanded=rectangles.flatMap(rect=>corners({x:rect.x-12,y:rect.y-12,width:rect.width+24,height:rect.height+24}).map(plane));
 const coordinates=(axis:'x'|'y')=>{
  const values=[...expanded.map(point=>point[axis]),...starts.map(point=>point[axis]),...ends.map(point=>point[axis]),...used.flatMap(route=>route.points.flatMap(point=>{const value=plane(point)[axis];return[value-14,value+14];}))];
  const low=Math.min(...values)-120,high=Math.max(...values)+120;
  return[...new Set([low,high,...values])].sort((a,b)=>a-b);
 };
 const xs=coordinates('x'),ys=coordinates('y'),key=(x:number,y:number,direction:number)=>`${x}:${y}:${direction}`;
 const queue:Search[]=[],best=new Map<string,number>(),previous=new Map<string,string>(),states=new Map<string,Search>();
 const heuristic=(point:TopologyPoint)=>Math.min(...ends.map((end,index)=>Math.abs(point.x-end.x)+Math.abs(point.y-end.y)+targets[index]!.penalty));
 const push=(row:Search)=>{let index=queue.length;queue.push(row);while(index){const parent=(index-1)>>1;if(queue[parent]!.score<=row.score)break;queue[index]=queue[parent]!;index=parent;}queue[index]=row;};
 const pop=()=>{const first=queue[0]!,last=queue.pop()!;if(queue.length){let index=0;while(index*2+1<queue.length){let child=index*2+1;if(child+1<queue.length&&queue[child+1]!.score<queue[child]!.score)child++;if(queue[child]!.score>=last.score)break;queue[index]=queue[child]!;index=child;}queue[index]=last;}return first;};
 starts.forEach((point,index)=>{
  const before=plane(sources[index]!.point),direction=Math.abs(before.x-point.x)<EPS?2:1;
  const x=xs.indexOf(point.x),y=ys.indexOf(point.y),id=key(x,y,direction),cost=sources[index]!.penalty;
  if(cost>=(best.get(id)??Infinity))return;
  const row={key:id,x,y,direction,cost,score:cost+heuristic(point),terminal:index};best.set(id,cost);states.set(id,row);push(row);
 });
 let final:Search|undefined,target:number|undefined,finalCost=Infinity,visits=0;
 while(queue.length&&visits++<100000){
  const current=pop();if(current.cost!==best.get(current.key))continue;if(current.score>=finalCost)break;
  const point={x:xs[current.x]!,y:ys[current.y]!};
  for(const [index,end]of ends.entries())if(Math.abs(point.x-end.x)<EPS&&Math.abs(point.y-end.y)<EPS){
   const after=plane(targets[index]!.point),direction=Math.abs(after.x-end.x)<EPS?2:1,cost=current.cost+targets[index]!.penalty+(current.direction===direction?0:28);
   if(cost<finalCost){final=current;target=index;finalCost=cost;}
  }
  for(const [dx,dy,direction]of [[1,0,1],[-1,0,1],[0,1,2],[0,-1,2]]as const){
   const x=current.x+dx,y=current.y+dy;if(x<0||y<0||x>=xs.length||y>=ys.length)continue;
   const next={x:xs[x]!,y:ys[y]!},screenA=project(point),screenB=project(next);
   if(rectangles.some(rect=>isometricSegmentCrosses(screenA,screenB,rect)))continue;
   const cost=current.cost+Math.abs(next.x-point.x)+Math.abs(next.y-point.y)+(current.direction!==direction?28:0)+wireCost(point,next,used),id=key(x,y,direction);
   if(cost>=(best.get(id)??Infinity))continue;
   const row={key:id,x,y,direction,cost,score:cost+heuristic(next),terminal:current.terminal};best.set(id,cost);previous.set(id,current.key);states.set(id,row);push(row);
  }
 }
 if(!final||target===undefined)return;
 const points:TopologyPoint[]=[targets[target]!.point];let current:Search|undefined=final;
 while(current){points.push(project({x:xs[current.x]!,y:ys[current.y]!}));const prior=previous.get(current.key);current=prior?states.get(prior):undefined;}
 points.push(sources[final.terminal]!.point);points.reverse();
 const compact:TopologyPoint[]=[];
 for(const point of points){
  if(compact.length&&Math.hypot(point.x-compact.at(-1)!.x,point.y-compact.at(-1)!.y)<EPS)continue;
  while(compact.length>=2){
   const first=plane(compact.at(-2)!),middle=plane(compact.at(-1)!),last=plane(point);
   if(!(Math.abs(first.x-middle.x)<EPS&&Math.abs(middle.x-last.x)<EPS||Math.abs(first.y-middle.y)<EPS&&Math.abs(middle.y-last.y)<EPS))break;
   compact.pop();
  }
  compact.push(point);
 }
 return compact;
}

/** Object-mode wires are planned in the physical plane, with strict caption/header clearance. */
export function routeIsometricObjectConnections(connections:readonly IsometricRouteConnection[],objects:readonly IsometricRouteObject[],headers:readonly Rect[]):ReadonlyMap<string,TopologyRoute> {
 const byId=new Map(objects.map(object=>[object.id,object])),ordered=[...connections].sort((a,b)=>a.id.localeCompare(b.id)),routes=new Map<string,TopologyRoute>();
 const rectangles=[...objects.map(object=>object.body),...headers];
 const candidates=new Map<string,Terminal[]>(),endpointKey=(objectId:string,edgeId:string)=>JSON.stringify([objectId,edgeId]);
 const occupied=new Set<TopologyPoint>();
 for(const object of objects){
  const related=ordered.filter(edge=>edge.from===object.id||edge.to===object.id),slots=new Map<number,number>([[-1,0],[1,0]]),assigned=new Map<string,{side:number;slot:number}>();
  const preferred=(edge:IsometricRouteConnection)=>{const other=byId.get(edge.from===object.id?edge.to:edge.from);return other&&other.ground.x<object.ground.x?-1:1;};
  const make=(point:TopologyPoint,side:number,penalty:number):Terminal[]=>{
   const run=side*((side<0?object.body.x-12:object.body.x+object.body.width+12)-point.x);
   const escape={x:point.x+side*run,y:point.y-run/Math.sqrt(3)};
   const caption={x:object.body.x,y:object.ground.y+1,width:object.body.width,height:object.body.y+object.body.height-object.ground.y-1};
   if(isometricSegmentCrosses(point,escape,caption)||rectangles.some(rect=>rect!==object.body&&isometricSegmentCrosses(point,escape,rect)))return[];
   return[{point,escape,penalty}];
  };
  if(object.ports){
   for(const edge of related){
    const preferredSide=preferred(edge);
    const terminals=object.ports.flatMap(port=>{
     const side=port.side==='left'?-1:1;
     return make(port.point,side,side===preferredSide?0:65);
    });
    candidates.set(endpointKey(object.id,edge.id),terminals);
   }
   continue;
  }
  // Reserve eight distinct ports per side around the drawing. A
  // denser graph retains excess relationships in the explicit unplaced UI.
  for(const edge of related){
   const side=preferred(edge),chosen=(slots.get(side)??0)<8?side:(slots.get(-side)??0)<8?-side:undefined;
   if(chosen===undefined)continue;
   const slot=slots.get(chosen)!;slots.set(chosen,slot+1);assigned.set(edge.id,{side:chosen,slot});
  }
  const fallback=(side:number,slot:number,penalty:number)=>make({x:object.ground.x+side*52,y:object.ground.y-8-slot*10},side,penalty);
  for(const edge of related){
   const primary=assigned.get(edge.id);if(!primary)continue;
   const options=fallback(primary.side,primary.slot,primary.side===preferred(edge)?0:65),alternate=-primary.side,slot=slots.get(alternate)!;
   if(slot<8){slots.set(alternate,slot+1);options.push(...fallback(alternate,slot,65));}
   candidates.set(endpointKey(object.id,edge.id),options);
  }
 }
 for(const edge of ordered){
  const from=byId.get(edge.from),to=byId.get(edge.to);
  const available=(objectId:string)=>(candidates.get(endpointKey(objectId,edge.id))??[]).filter(port=>!occupied.has(port.point));
  const points=from&&to?routeOne(available(from.id),available(to.id),rectangles,[...routes.values()]):undefined;
  // Retain the physical edge for the viewer's explicit unplaced-connection UI.
  // A layout limitation is neither provider failure nor permission to cross art.
  if(!points){routes.set(edge.id,{path:'',x:0,y:0,points:[],labelHidden:true});continue;}
  occupied.add(points[0]!);
  occupied.add(points.at(-1)!);
  let longest=0,label={x:points[0]!.x,y:points[0]!.y};
  for(let index=1;index<points.length;index++){const a=points[index-1]!,b=points[index]!,length=Math.hypot(b.x-a.x,b.y-a.y);if(length>longest){longest=length;label={x:(a.x+b.x)/2,y:(a.y+b.y)/2};}}
  routes.set(edge.id,{...label,points,path:points.map((point,index)=>`${index?'L':'M'} ${point.x} ${point.y}`).join(' '),labelHidden:false});
 }
 return routes;
}
