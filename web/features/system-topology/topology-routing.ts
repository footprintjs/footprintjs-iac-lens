import type { TopologyBox } from './topology-layout.ts';
export interface TopologyPoint { x: number; y: number }
export interface TopologyRoute { path: string; x: number; y: number; points: readonly TopologyPoint[]; labelHidden?: boolean }
interface Rect { x: number; y: number; width: number; height: number }
interface Port { edge: TopologyPoint; out: TopologyPoint; penalty: number }
interface Search { key: string; x: number; y: number; direction: number; cost: number; score: number; port: number }
const inside = (p: TopologyPoint, r: Rect, pad = 2) => p.x > r.x - pad && p.x < r.x + r.width + pad && p.y > r.y - pad && p.y < r.y + r.height + pad;
function blocked(a: TopologyPoint, b: TopologyPoint, rectangles: readonly Rect[]): boolean {
  return rectangles.some(r => a.x === b.x
    ? a.x > r.x - 2 && a.x < r.x + r.width + 2 && Math.max(a.y,b.y) > r.y - 2 && Math.min(a.y,b.y) < r.y + r.height + 2
    : a.y > r.y - 2 && a.y < r.y + r.height + 2 && Math.max(a.x,b.x) > r.x - 2 && Math.min(a.x,b.x) < r.x + r.width + 2);
}
function ports(box: TopologyBox, preferred: 'top' | 'bottom'): Port[] {
  const {x,y,width:w,height:h}=box,cx=x+w/2,cy=y+h/2;
  return [
    {side:'top',edge:{x:cx,y},out:{x:cx,y:y-6}}, {side:'bottom',edge:{x:cx,y:y+h},out:{x:cx,y:y+h+6}},
    {side:'left',edge:{x,y:cy},out:{x:x-6,y:cy}}, {side:'right',edge:{x:x+w,y:cy},out:{x:x+w+6,y:cy}},
  ].map(row=>({...row,penalty:row.side===preferred?0:row.side==='top'||row.side==='bottom'?120:100}));
}
/** A bounded visibility grid: nodes and boundary titles are obstacles, never SVG-scaled text. */
export function routeTopologyConnection(from: TopologyBox,to: TopologyBox,boxes: ReadonlyMap<string,TopologyBox>,used: readonly TopologyRoute[]=[],bottomTarget=false): TopologyRoute {
  const all=[...boxes.values()],rectangles:Rect[]=all.map(box=>({...box,height:box.kind==='boundary'?28:box.height}));
  const width=Math.max(...all.map(box=>box.x+box.width))+10,height=Math.max(...all.map(box=>box.y+box.height))+18;
  const vertical=from.y+from.height<=to.y||to.y+to.height<=from.y;
  const sources=ports(from,vertical&&from.y>to.y?'top':'bottom');
  const targets=bottomTarget?ports(to,'bottom').filter(port=>port.edge.x===to.x+to.width/2&&port.edge.y===to.y+to.height):ports(to,vertical&&to.y>from.y?'top':'bottom');
  const coordinates=(axis:'x'|'y')=>{
    const limit=axis==='x'?width:height;
    const raw=[4,limit-4,...rectangles.flatMap(r=>[r[axis]-6,r[axis]+(axis==='x'?r.width:r.height)+6]),...sources.map(p=>p.out[axis]),...targets.map(p=>p.out[axis])].filter(v=>v>=2&&v<=limit-2);
    const sorted=[...new Set(raw)].sort((a,b)=>a-b);return [...new Set([...sorted,...sorted.slice(1).map((v,i)=>(v+sorted[i]!)/2)])].sort((a,b)=>a-b);
  };
  const xs=coordinates('x'),ys=coordinates('y'),key=(x:number,y:number,direction:number)=>`${x}:${y}:${direction}`;
  const queue:Search[]=[],best=new Map<string,number>(),previous=new Map<string,string>(),states=new Map<string,Search>();
  const heuristic=(x:number,y:number)=>Math.min(...targets.map(p=>Math.abs(x-p.out.x)+Math.abs(y-p.out.y)+p.penalty));
  function push(row:Search){let index=queue.length;queue.push(row);while(index){const parent=(index-1)>>1;if(queue[parent]!.score<=row.score)break;queue[index]=queue[parent]!;index=parent;}queue[index]=row;}
  function pop(){const first=queue[0]!,last=queue.pop()!;if(queue.length){let index=0;while(index*2+1<queue.length){let child=index*2+1;if(child+1<queue.length&&queue[child+1]!.score<queue[child]!.score)child++;if(queue[child]!.score>=last.score)break;queue[index]=queue[child]!;index=child;}queue[index]=last;}return first;}
  sources.forEach((port,index)=>{if(inside(port.out,from,2)||rectangles.some(r=>inside(port.out,r))||blocked(port.edge,port.out,rectangles.filter(r=>r.x!==from.x||r.y!==from.y||r.width!==from.width||r.height!==from.height)))return;const x=xs.indexOf(port.out.x),y=ys.indexOf(port.out.y),id=key(x,y,0),cost=port.penalty;const row={key:id,x,y,direction:0,cost,score:cost+heuristic(port.out.x,port.out.y),port:index};best.set(id,cost);states.set(id,row);push(row);});
  let final:Search|undefined,target:Port|undefined,finalCost=Infinity,visits=0;
  while(queue.length&&visits++<30000){
    const current=pop();if(current.cost!==best.get(current.key))continue;if(current.score>=finalCost)break;
    const point={x:xs[current.x]!,y:ys[current.y]!};
    for(const end of targets)if(point.x===end.out.x&&point.y===end.out.y&&current.cost+end.penalty<finalCost){final=current;target=end;finalCost=current.cost+end.penalty;}
    for(const [dx,dy,direction]of [[1,0,1],[-1,0,1],[0,1,2],[0,-1,2]]){
      const x=current.x+dx!,y=current.y+dy!;if(x<0||y<0||x>=xs.length||y>=ys.length)continue;
      const next={x:xs[x]!,y:ys[y]!};if(blocked(point,next,rectangles))continue;
      let overlap=0;for(const route of used)for(let i=1;i<route.points.length;i++){const a=route.points[i-1]!,b=route.points[i]!;if(point.x===next.x&&a.x===b.x&&Math.abs(a.x-point.x)<3)overlap+=Math.max(0,Math.min(Math.max(a.y,b.y),Math.max(point.y,next.y))-Math.max(Math.min(a.y,b.y),Math.min(point.y,next.y)));if(point.y===next.y&&a.y===b.y&&Math.abs(a.y-point.y)<3)overlap+=Math.max(0,Math.min(Math.max(a.x,b.x),Math.max(point.x,next.x))-Math.max(Math.min(a.x,b.x),Math.min(point.x,next.x)));}
      const cost=current.cost+Math.abs(next.x-point.x)+Math.abs(next.y-point.y)+(current.direction&&current.direction!==direction?9:0)+overlap*1.4,id=key(x,y,direction!);
      if(cost>=(best.get(id)??Infinity))continue;const row={key:id,x,y,direction:direction!,cost,score:cost+heuristic(next.x,next.y),port:current.port};best.set(id,cost);previous.set(id,current.key);states.set(id,row);push(row);
    }
  }
  if(!final||!target)return {path:'',x:(from.x+to.x)/2,y:(from.y+to.y)/2,points:[],labelHidden:true};
  const points:TopologyPoint[]=[target.edge];let state:Search|undefined=final;
  while(state){points.push({x:xs[state.x]!,y:ys[state.y]!});const prior=previous.get(state.key);state=prior?states.get(prior):undefined;}
  points.push(sources[final.port]!.edge);points.reverse();
  const compact=points.filter((point,index)=>{const a=points[index-1],b=points[index+1];return !a||!b||!(a.x===point.x&&point.x===b.x||a.y===point.y&&point.y===b.y);});
  const route:TopologyRoute={path:compact.map((p,index)=>`${index?'L':'M'} ${p.x} ${p.y}`).join(' '),x:0,y:0,points:compact};
  const labelled=placeLabel(route,rectangles,used,width,height);
  return labelled.labelHidden&&!bottomTarget?routeTopologyConnection(from,to,boxes,used,true):labelled;
}
function placeLabel(route:TopologyRoute,rectangles:readonly Rect[],used:readonly TopologyRoute[],width:number,height:number):TopologyRoute{
  const candidates:TopologyPoint[]=[];
  for(let i=1;i<route.points.length;i++){const a=route.points[i-1]!,b=route.points[i]!;for(const fraction of [.5,.25,.75]){const p={x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction};candidates.push(p);if(a.x===b.x)candidates.push({x:p.x-38,y:p.y},{x:p.x+38,y:p.y});else candidates.push({x:p.x,y:p.y+6},{x:p.x,y:p.y-6},{x:p.x,y:p.y+12},{x:p.x,y:p.y-12});}}
  const overlaps=(a:Rect,b:Rect)=>a.x<b.x+b.width+2&&a.x+a.width>b.x-2&&a.y<b.y+b.height+2&&a.y+a.height>b.y-2;
  for(const candidate of candidates){const rect={x:candidate.x-31,y:candidate.y-8,width:62,height:16};if(rect.x<2||rect.y<2||rect.x+rect.width>width-2||rect.y+rect.height>height-2)continue;if(rectangles.some(obstacle=>overlaps(rect,obstacle))||used.some(row=>!row.labelHidden&&overlaps(rect,{x:row.x-31,y:row.y-8,width:62,height:16})))continue;return {...route,...candidate};}
  return {...route,labelHidden:true};
}
