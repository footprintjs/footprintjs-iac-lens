import type { TopologyTechnology } from 'footprintjs-iac/system-topology';
import { Icon } from '../../components/Icon.tsx';
import { technologyIcon } from './technology-icons.ts';
/** Declared product labels are preserved. Unknown brands use the category symbol. */
export function TechnologyMark({ technology, category }: { technology?: TopologyTechnology; category?: string }) {
  const icon = category === 'storage' ? 'storage' : category === 'network' ? 'network' : category === 'identity' ? 'identity' : 'compute';
  const productIcon = technologyIcon(technology?.id);
  return <span className="topology-technology">{productIcon ? <img src={productIcon} width="17" height="17" alt="" aria-hidden="true"/> : <Icon name={icon} size={17}/>}<span>{technology?.label ?? 'Generic component'}{technology?.version ? ` ${technology.version}` : ''}</span></span>;
}
