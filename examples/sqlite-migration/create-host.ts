import { join,resolve } from 'node:path';
import { createSqliteConversationFixture } from 'footprintjs-iac/migration/sqlite';
import { MigrationWorkflow,FileMigrationStore,FileMigrationLocks,offlineTransferStrategy,compileMigrationPlan,loadMigrationRecording } from 'footprintjs-iac/migration/node';
import { loadChangeAssessmentRecording,readChangeAssessmentReport,type ChangeAssessmentReport } from 'footprintjs-iac/change-assessment/node';
import type { ControllerOptions,PreparedMigration } from '../../src/server/index.ts';
import { migrationFingerprint } from '../../src/server/migration-binding.ts';
import { createSqliteAssessment } from './assessment.ts';
import { sqliteScenario,type SqliteMigrationScenario } from './scenario.ts';

/** Real local SQLite and an explicitly cooperating application; no Neo, cloud or arbitrary application claims. */
export async function createSqliteMigrationHost(directory:string,options:{scenario?:SqliteMigrationScenario}={}):Promise<{host:ControllerOptions;fixture:Awaited<ReturnType<typeof createSqliteConversationFixture>>}>{
  directory=resolve(directory);const scenario=options.scenario??'normal';
  const fixture=await createSqliteConversationFixture({directory:join(directory,'consumer'),...sqliteScenario(scenario)});
  const assessment=await createSqliteAssessment(directory,fixture),planId='conversation-schema-v2';
  const prepare=async(selected:string,input:ChangeAssessmentReport):Promise<PreparedMigration>=>{
    if(selected!==planId)throw Error('Choose the registered conversation migration');const report=readChangeAssessmentReport(input),change=report.changes.find(change=>change.id==='conversation-schema-change');
    if(report.target.scopeDigest!==migrationFingerprint(assessment.resources.source.scope)||change?.disposition!=='replace'||change.data!=='stateful'||change.previousDigest!==migrationFingerprint(assessment.definition.changes[0]!.previous)||change.desiredDigest!==migrationFingerprint(assessment.definition.changes[0]!.desired))throw Error('This replacement is not established by the admitted provider assessment');
    const resources=await fixture.adapter.resources();if(change.observed.identityDigest!==migrationFingerprint(resources.source.identity))throw Error('The assessed SQLite source identity changed before plan preparation');
    const definition={version:1 as const,id:'conversation-migration-'+scenario,label:'Protected conversation data move',assessmentDigest:report.digest,changeId:change.id,configurationDigest:fixture.adapter.configurationDigest,...resources,strategyId:'offline-transfer',adapterId:fixture.adapter.id};
    const registry={strategies:[offlineTransferStrategy()],adapters:[fixture.adapter]},plan=compileMigrationPlan(definition,registry);
    return{plan,workflow:new MigrationWorkflow({definition,registry,assessment:report,store:new FileMigrationStore(join(directory,'migration')),locks:new FileMigrationLocks(join(directory,'migration-locks'))})};
  };
  const stored=await assessment.workflow.snapshot(),current=stored.status==='complete'&&stored.report?{planId,prepared:await prepare(planId,stored.report)}:undefined;
  return{fixture,host:{directory:join(directory,'lens'),migration:{id:'sqlite-conversation-migration',label:'Move conversation data',scopeLabel:'Real SQLite · Cooperative consumer · Local files only',plans:[{id:planId,label:scenario==='normal'?'Schema v2 data move':scenario==='bad-data'?'Failing data-check example':'Failing app-check example',description:'Pause cooperating writers, keep a verified backup, move and check data, then approve the application switch.'}],assessment:assessment.workflow,prepare,...(current?{current}:{}),
    async loadAssessmentRecording(state){if(!state.recording)return;const loaded=await loadChangeAssessmentRecording(state.recording.evidencePath,{runId:state.recording.runId,executionId:state.executionId!,definitionDigest:state.definitionDigest});return{snapshot:loaded.snapshot,structure:loaded.structure,controlDeps:loaded.controlDeps as Record<string,unknown>,narrativeEntries:Array.isArray(loaded.narrativeEntries)?loaded.narrativeEntries:[]};},
    async loadRecording(state){const receipt=state.recordings.at(-1);if(!receipt)return;const loaded=await loadMigrationRecording(receipt.evidencePath,{runId:receipt.runId,executionId:state.executionId!,definitionDigest:state.definitionDigest});return{snapshot:loaded.snapshot,structure:loaded.structure,controlDeps:loaded.controlDeps as Record<string,unknown>,narrativeEntries:Array.isArray(loaded.narrativeEntries)?loaded.narrativeEntries:[]};}}}};
}
