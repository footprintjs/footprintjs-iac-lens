import type { CSSProperties } from 'react';

export function Icon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  const paths: Record<string, JSX.Element> = {
    compute: <><rect x="4" y="4" width="16" height="16" rx="4"/><rect x="8" y="8" width="8" height="8" rx="1"/><path d="M9 1v3m6-3v3M9 20v3m6-3v3M1 9h3m-3 6h3m16-6h3m-3 6h3"/></>,
    storage: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></>,
    network: <><rect x="8" y="2" width="8" height="6" rx="1.5"/><rect x="1" y="16" width="8" height="6" rx="1.5"/><rect x="15" y="16" width="8" height="6" rx="1.5"/><path d="M12 8v5H5v3m7-3h7v3"/></>,
    identity: <><path d="m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5z"/><path d="m8 12 3 3 5-6"/></>,
    graph: <><rect x="2" y="2" width="7" height="7" rx="2"/><rect x="15" y="15" width="7" height="7" rx="2"/><rect x="2" y="15" width="7" height="7" rx="2"/><path d="M5.5 9v6M9 5.5h9.5V15"/></>,
    evidence: <><path d="M7 3H4v18h16V3h-3M9 3h6v4H9zM8 12h8m-8 4h5"/></>,
    file: <><path d="M14 2H5v20h14V7zM14 2v6h5M8 13h8m-8 4h6"/></>,
    play: <path d="m9 5 11 7-11 7z"/>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    external: <><path d="M14 3h7v7m0-7L10 14M9 4H4v16h16v-5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">{paths[name] ?? paths.graph}</svg>;
}
