import {useEffect} from 'react';
import {useNodes,useUpdateNodeInternals} from '@xyflow/react';

/** Re-measure actual DOM nodes when a controlled native publication replaces them. */
export function StandardChartMeasurements() {
 const nodes=useNodes(),updateNodeInternals=useUpdateNodeInternals();
 useEffect(()=>{
  // EUI 0.46 replaces controlled nodes without their measured metadata. A node
  // whose size did not change may receive no new ResizeObserver notification.
  // Ask xyflow to read its real DOM bounds and handles; retain EUI's layout.
  if(nodes.length)updateNodeInternals(nodes.filter(node=>!node.hidden).map(node=>node.id));
 },[nodes,updateNodeInternals]);
 return null;
}
