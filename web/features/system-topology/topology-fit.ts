export interface TopologySize {width:number;height:number}
/** Camera sizing only: retain native layout coordinates, route paths and observed facts. */
export function fitSystemTopology(geometry:TopologySize,viewport:TopologySize):TopologySize&{scale:number} {
 const measured=[geometry.width,geometry.height,viewport.width,viewport.height].every(value=>Number.isFinite(value)&&value>0);
 const scale=measured?Math.min(1,viewport.width/geometry.width,viewport.height/geometry.height):1;
 return {scale,width:geometry.width*scale,height:geometry.height*scale};
}
