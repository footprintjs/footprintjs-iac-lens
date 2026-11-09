import type { ServerResponse } from 'node:http';
import type { DashboardController } from './controller.ts';

/** Snapshot transport can reconnect without losing earlier recorded resource events. */
export function streamState(response: ServerResponse, controller: DashboardController): () => void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
  response.write('retry: 1500\n\n');
  let pending = false;
  const send = () => {
    if (response.destroyed) return;
    if (response.writableNeedDrain) { pending = true; return; }
    pending = false;
    const state = controller.getSnapshot();
    response.write(`id: ${state.revision}\nevent: state\ndata: ${JSON.stringify(state)}\n\n`);
  };
  const unsubscribe = controller.subscribe(send);
  const drain = () => { if (pending) send(); };
  response.on('drain', drain);
  const heartbeat = setInterval(() => { if (!response.destroyed && !response.writableNeedDrain) response.write(': connected\n\n'); }, 15_000);
  heartbeat.unref(); send();
  return () => { unsubscribe(); clearInterval(heartbeat); response.off('drain', drain); };
}
