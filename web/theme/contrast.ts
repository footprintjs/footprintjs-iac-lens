/** Choose the more readable label for a plain supplied accent; arbitrary CSS expressions keep the host fallback. */
export function accentForeground(accent: string | undefined): string {
  let channels: number[] | undefined;
  if (accent && /^#[\da-f]{3}$/i.test(accent)) channels = [...accent.slice(1)].map(value=>parseInt(value+value,16));
  else if (accent && /^#[\da-f]{6}$/i.test(accent)) channels = [1,3,5].map(index=>parseInt(accent.slice(index,index+2),16));
  else if (accent) {
    const match = /^rgb\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*\)$/i.exec(accent);
    if (match) channels = match.slice(1).map(Number);
  }
  if (!channels || channels.some(value=>value<0||value>255)) return '#ffffff';
  const luminance = channels.map(value=>{
    const channel=value/255;return channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4;
  }).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index]!,0);
  return (luminance+0.05)/0.05 > 1.05/(luminance+0.05) ? '#000000' : '#ffffff';
}
