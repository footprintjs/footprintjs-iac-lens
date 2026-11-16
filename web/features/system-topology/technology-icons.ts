import kubernetes from './icons/kubernetes.svg' with { type: 'text' };
import nodejs from './icons/nodedotjs.svg' with { type: 'text' };
import python from './icons/python.svg' with { type: 'text' };
import sqlite from './icons/sqlite.svg' with { type: 'text' };
/** Tiny pinned CC0 subset. Sources, hashes and license are beside these assets. */
const icon = (source: string, colour: string) => `data:image/svg+xml,${encodeURIComponent(source.replace('<svg ', `<svg fill="${colour}" `))}`;
const node = icon(nodejs, '#5FA04E');
const known: Readonly<Record<string, string>> = Object.freeze({
  kubernetes: icon(kubernetes, '#326CE5'), nodejs: node, nodedotjs: node, 'node.js': node, node,
  python: icon(python, '#3776AB'), sqlite: icon(sqlite, '#0F80CC'),
});
export function technologyIcon(id: string | undefined): string | undefined {
  return id && Object.hasOwn(known, id.toLowerCase()) ? known[id.toLowerCase()] : undefined;
}
