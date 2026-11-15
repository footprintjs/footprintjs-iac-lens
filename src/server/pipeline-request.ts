import type { IncomingMessage } from 'node:http';
import { readPipelineAction, type PipelineAction } from '../core/pipeline.ts';
import { RequestError } from './controller.ts';
export async function readPipelineRequest(request:IncomingMessage):Promise<PipelineAction>{
  if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']??''))throw new RequestError(415,'Send application/json');
  let bytes=0;const chunks:Buffer[]=[];
  for await(const chunk of request){bytes+=chunk.length;if(bytes>16_384)throw new RequestError(413,'Pipeline request is too large');chunks.push(Buffer.from(chunk));}
  try{return readPipelineAction(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{throw new RequestError(400,'Choose only registered pipeline settings');}
}
