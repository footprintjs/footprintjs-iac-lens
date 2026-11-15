import type { IncomingMessage } from 'node:http';
import { readMigrationAction,type MigrationAction } from '../core/migration.ts';
import { RequestError } from './controller.ts';
export async function readMigrationRequest(request:IncomingMessage):Promise<MigrationAction>{
  if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']??''))throw new RequestError(415,'Send application/json');
  let bytes=0;const chunks:Buffer[]=[];for await(const chunk of request){bytes+=chunk.length;if(bytes>2048)throw new RequestError(413,'Migration request is too large');chunks.push(Buffer.from(chunk));}
  try{return readMigrationAction(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{throw new RequestError(400,'Choose only a registered migration action');}
}
