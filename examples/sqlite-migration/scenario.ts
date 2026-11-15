import { migrationFingerprint } from '../../src/server/migration-binding.ts';
import { conversationMigrationV2 } from 'footprintjs-iac/migration/sqlite';
import type { SqliteMigrationProgram,SqliteMigrationAdapterOptions } from 'footprintjs-iac/migration/sqlite';
export type SqliteMigrationScenario='normal'|'bad-data'|'consumer-failure';
/** Deliberately failing profiles are registered host programs, never browser-provided SQL. */
export function sqliteScenario(scenario:SqliteMigrationScenario):{migration?:SqliteMigrationProgram;verifyConsumer?:SqliteMigrationAdapterOptions['verifyConsumer']}{
  if(scenario==='bad-data')return{migration:{id:'deliberately-broken-data-example',digest:migrationFingerprint({version:1,example:'change-one-preserved-message'}),run(database){conversationMigrationV2.run(database);database.prepare("UPDATE messages SET body=body||' [changed]' WHERE id='message-alice-1'").run();}}};
  if(scenario==='consumer-failure')return{verifyConsumer:{id:'deliberately-failing-app-check',digest:migrationFingerprint({version:1,example:'consumer-check-fails'}),async run(){return false;}}};
  return{};
}
