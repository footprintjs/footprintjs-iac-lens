import { ChangeAssessmentWorkflow,FileChangeAssessmentStore,DeclaredContractAssessmentAdapter,conservativeChangeStrategy } from 'footprintjs-iac/change-assessment/node';
import type { Resource } from 'footprintjs-iac';
import type { createSqliteConversationFixture } from 'footprintjs-iac/migration/sqlite';
import { join } from 'node:path';
import { migrationFingerprint } from '../../src/server/migration-binding.ts';
export async function createSqliteAssessment(directory:string,fixture:Awaited<ReturnType<typeof createSqliteConversationFixture>>){
  const measured=await fixture.adapter.inspectSource(),resources=await fixture.adapter.resources();
  const spec={engine:'sqlite',schemaVersion:measured.schemaVersion,schemaContract:'conversation-v'+measured.schemaVersion,sourceSchemaDigest:measured.schemaDigest};
  const previous:Resource={id:'conversation-store',provider:'owned-sqlite',spec,lifecycle:{retainOnRemoval:true}},desired:Resource={...previous,spec:{...spec,schemaVersion:2,schemaContract:'conversation-v2'}};
  const adapter=new DeclaredContractAssessmentAdapter({id:'sqlite-schema-contract',provider:'owned-sqlite',scope:resources.source.scope,mutablePaths:[],replacementPaths:['/spec/schemaVersion','/spec/schemaContract'],
    async observe(){const observed=await fixture.adapter.inspectSource(),current={engine:'sqlite',schemaVersion:observed.schemaVersion,schemaContract:'conversation-v'+observed.schemaVersion,sourceSchemaDigest:observed.schemaDigest};
      return{exists:true,owned:true,ready:true,physicalId:observed.identity,revision:observed.schemaDigest,fingerprint:migrationFingerprint(current)};}});
  const definition={version:1 as const,id:'conversation-change-assessment',label:'Conversation store schema review',target:{id:'conversation-app',scope:resources.source.scope},configurationDigest:migrationFingerprint({version:1,sourceSchema:measured.schemaDigest,providerContract:'registered-offline-schema-replacement'}),
    changes:[{id:'conversation-schema-change',label:'Conversation store',adapterId:adapter.id,strategyId:'conservative',data:'stateful' as const,previous,desired}]};
  return{workflow:new ChangeAssessmentWorkflow({definition,registry:{adapters:[adapter],strategies:[conservativeChangeStrategy()]},store:new FileChangeAssessmentStore(join(directory,'assessment'))}),resources,definition};
}
