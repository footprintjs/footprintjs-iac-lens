import type {IncomingMessage} from 'node:http';
import {readReleaseAutomationAction,type ReleaseAutomationAction} from '../core/release-automation.ts';
import {RequestError} from './controller.ts';
export async function readReleaseAutomationRequest(request:IncomingMessage):Promise<ReleaseAutomationAction>{
  if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']??''))throw new RequestError(415,'Send application/json');
  let bytes=0;const chunks:Buffer[]=[];
  for await(const chunk of request){bytes+=chunk.length;if(bytes>4096)throw new RequestError(413,'Release request is too large');chunks.push(Buffer.from(chunk));}
  try{return readReleaseAutomationAction(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{throw new RequestError(400,'Choose a registered release action');}
}
