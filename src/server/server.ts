import {readReleaseAutomationRequest} from './release-automation-request.ts';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import type { Scenario } from '../core/types.ts';
import { DashboardController, RequestError, type ControllerOptions } from './controller.ts';
import { admitRequest, json, readRunRequest, readResourceFlowRequest } from './request.ts';
import { serveStatic } from './static.ts';
import { streamState } from './events.ts';
import { readConnectionProfileRequest } from './connection-profile-request.ts';
import { readHostActionRequest } from './host-action-request.ts';
import { readMigrationRequest } from './migration-request.ts';
import { readPipelineRequest } from './pipeline-request.ts';
import { readDeliveryRequest } from './delivery-request.ts';
import { readApplicationRequest } from './application-request.ts';
import { readAgentPlatformRequest } from './agent-platform-request.ts';
import { readOnboardingRequest } from './onboarding-request.ts';
import { readOnboardingVersionRequest } from './onboarding-version-request.ts';

export interface DashboardOptions extends ControllerOptions { staticDirectory: string; port?: number }

/** Loopback-only consumer server; every resource mutation still belongs to InfraEngine. */
export async function startDashboard(options: DashboardOptions): Promise<{
  url: string; server: Server; controller: DashboardController; close(): Promise<void>;
}> {
  const controller = new DashboardController(options);
  await controller.initialize();
  const streams = new Map<import('node:http').ServerResponse, () => void>();
  let port = 0;
  const server = createServer((request, response) => {
    void (async () => {
      admitRequest(request, port);
      const path = new URL(request.url ?? '/', `http://127.0.0.1:${port}`).pathname;
      if (request.method === 'GET' && path === '/api/state') return json(response, 200, controller.getSnapshot());
      if (request.method === 'GET' && path === '/api/events') {
        if (streams.size >= 32) throw new RequestError(429, 'Too many viewer connections');
        const stop = streamState(response, controller); streams.set(response, stop);
        response.on('close', () => { stop(); streams.delete(response); }); return;
      }
      if (request.method === 'POST' && path === '/api/application') {
        controller.applicationAction(await readApplicationRequest(request));
        return json(response, 202, { accepted: true });
      }
      if (request.method === 'POST' && path === '/api/onboarding') {
        controller.onboardingAction(await readOnboardingRequest(request));
        return json(response, 202, { accepted: true });
      }
      if (request.method === 'POST' && path === '/api/onboarding/versions') {
        controller.onboardingVersionAction(await readOnboardingVersionRequest(request));
        return json(response, 202, { accepted: true });
      }
      if (request.method === 'POST' && path === '/api/agent-platform') {
        await controller.agentPlatformAction(await readAgentPlatformRequest(request));
        return json(response, 202, { accepted: true });
      }
      if (request.method === 'POST' && path === '/api/run') {
        const body = await readRunRequest(request);
        controller.start(body.scenario as Scenario, body.reviewId); return json(response, 202, { accepted: true });
      }
      if (request.method === 'POST' && path === '/api/resource-flow') {
        controller.startResourceFlow(await readResourceFlowRequest(request));
        return json(response, 202, { accepted: true });
      }
      if (request.method === 'POST' && path === '/api/connection-profiles') {
        return json(response, 200, await controller.connectionProfileAction(await readConnectionProfileRequest(request)));
      }
      if (request.method === 'POST' && path === '/api/host-action') {
        controller.hostAction(await readHostActionRequest(request)); return json(response, 202, { accepted: true });
      }
      if(request.method==='POST'&&path==='/api/releases'){await controller.releaseAutomationAction(await readReleaseAutomationRequest(request));return json(response,202,{accepted:true});}
      if(request.method==='POST'&&path==='/api/migration'){await controller.migrationAction(await readMigrationRequest(request));return json(response,202,{accepted:true});}
      if (request.method === 'POST' && path === '/api/pipeline') {
        await controller.pipelineAction(await readPipelineRequest(request)); return json(response,202,{accepted:true});
      }
      if (request.method === 'POST' && path === '/api/delivery') {
        controller.startDelivery(await readDeliveryRequest(request)); return json(response, 202, { accepted: true });
      }
      if (request.method === 'GET' && path === '/health') return json(response, 200, { status: 'ok', service: 'footprintjs-iac-lens' });
      if (request.method !== 'GET') throw new RequestError(405, 'Method not allowed');
      return serveStatic(response, resolve(options.staticDirectory), path);
    })().catch(error => {
      if (!response.headersSent) json(response, error instanceof RequestError ? error.status : 500,
        { error: error instanceof Error ? error.message : String(error) });
      else response.end();
    });
  });
  server.requestTimeout = 15_000;
  const listen = (selected: number) => new Promise<void>((accept, reject) => {
    const ready = () => { server.off('error', fail); accept(); };
    const fail = (error: Error) => { server.off('listening', ready); reject(error); };
    server.once('error', fail); server.once('listening', ready); server.listen(selected, '127.0.0.1');
  });
  try { await listen(options.port ?? 0); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && options.port) await listen(0); else throw error; }
  port = (server.address() as import('node:net').AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, server, controller,
    async close() {
      await controller.whenIdle();
      controller.dispose();
      for (const [response, stop] of streams) { stop(); response.end(); }
      server.closeIdleConnections();
      await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
    } };
}
