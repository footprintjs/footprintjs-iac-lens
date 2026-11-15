import {resolve} from 'node:path';
import {startDashboard} from '../src/server/index.ts';
import {readNeoReleaseWatcherConfig} from './neo-release-automation/config.ts';
import {createNeoReleaseWatcherHost} from './neo-release-automation/create-host.ts';

const[path,...args]=process.argv.slice(2);
if(!path||args.length>1||args.some(arg=>!/^--port=\d+$/.test(arg)))throw Error('Usage: node examples/neo-release-automation.ts /private/neo-release-host.json [--port=0]');
const port=Number(args[0]?.slice(7)??0);if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('Choose a loopback port');
const config=await readNeoReleaseWatcherConfig(resolve(path)),prepared=await createNeoReleaseWatcherHost(config);
const app=await startDashboard({...prepared.options,port,staticDirectory:resolve(import.meta.dirname,'../dist/web')});
console.log('Real local Neo environments · recorded preflight before every application change · CI off.');
console.log('InfraChart Lens: '+app.url);
console.log(config.automatic.enabled?'Automatic published-release deployment is enabled while this host runs.':'Automatic deployment is disabled; choose a version in Lens.');
let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,active:Promise<unknown>=Promise.resolve();
const poll=()=>{if(stopped)return;active=prepared.host.snapshot().then(state=>state.attempts.some(attempt=>['reserved','resolving','preparing','deploying'].includes(attempt.status))?undefined:prepared.host.tick()).catch(()=>{console.error('Release check deferred. Inspect retained state if this persists.');}).finally(()=>{if(!stopped)timer=setTimeout(poll,config.intervalMs);});};
poll();
for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{stopped=true;if(timer)clearTimeout(timer);void active.then(()=>app.close()).then(()=>process.exit(0));});
