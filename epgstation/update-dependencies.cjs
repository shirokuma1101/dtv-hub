// Apply the dependency compatibility changes to the pinned upstream source.
const fs = require('fs');
const root = '/app';
// EPGStation constructs hook environments explicitly. Forward only the webhook
// setting rather than exposing the entire server environment to child processes.
const hookFile = root + '/src/model/operator/externalCommand/ExternalCommandManageModel.ts';
let hookSource = fs.readFileSync(hookFile, 'utf8');
if (!hookSource.includes("DISCORD_WEBHOOK_URL: process.env['DISCORD_WEBHOOK_URL']")) {
  const hookPath = "PATH: process.env['PATH'],";
  if (hookSource.split(hookPath).length - 1 !== 3) throw new Error('Unexpected hook environment integration');
  hookSource = hookSource.replaceAll(hookPath, hookPath + "\n                    DISCORD_WEBHOOK_URL: process.env['DISCORD_WEBHOOK_URL'] || '',");
  fs.writeFileSync(hookFile, hookSource);
}
if (!hookSource.includes("GOOGLE_CALENDAR_ID: process.env['GOOGLE_CALENDAR_ID']")) {
  const marker = "DISCORD_WEBHOOK_URL: process.env['DISCORD_WEBHOOK_URL'] || '',";
  if (hookSource.split(marker).length - 1 !== 3) throw new Error('Unexpected calendar hook integration');
  hookSource = hookSource.replaceAll(marker, marker + "\n                    GOOGLE_CALENDAR_ID: process.env['GOOGLE_CALENDAR_ID'] || '',\n                    GOOGLE_CALENDAR_INSTANCE: process.env['GOOGLE_CALENDAR_INSTANCE'] || 'dtv-hub',");
  fs.writeFileSync(hookFile, hookSource);
}
const file = root + '/src/model/api/video/VideoApiModel.ts';
let source = fs.readFileSync(file, 'utf8');
if (!source.includes("import * as fileType from 'file-type';") && !source.includes("const fileType = require('file-type');")) {
  throw new Error('Unexpected upstream file-type integration');
}
// Node 22 supports require() of synchronous ES modules. Avoid TypeScript's
// CommonJS transform of import(), and use the current file-type API.
source = source.replace("import * as fileType from 'file-type';", "const fileType = require('file-type');")
  .replace('fileType.fromFile(filePath)', 'fileType.fileTypeFromFile(filePath)');
fs.writeFileSync(file, source);
const framework = root + '/node_modules/openapi-framework/dist/src/util.js';
const util = fs.readFileSync(framework, 'utf8');
if (!util.includes('jsYaml.safeLoad(') && !util.includes('jsYaml.load(')) throw new Error('Unexpected openapi-framework YAML integration');
// js-yaml 5 removed the deprecated safeLoad alias. load() uses the safe schema.
fs.writeFileSync(framework, util.replaceAll('jsYaml.safeLoad(', 'jsYaml.load('));
// TypeORM 0.3.31 rejects delete(Entity, {}). Use an explicit DELETE query,
// preserving the existing transaction (clear() would use TRUNCATE on MySQL).
const db = root + '/src/model/db';
for (const name of fs.readdirSync(db).filter(name => name.endsWith('.ts'))) {
  const path = db + '/' + name;
  const text = fs.readFileSync(path, 'utf8');
  fs.writeFileSync(path, text.replace(
    /queryRunner\.manager\.delete\((\w+), \{\}\)/g,
    'queryRunner.manager.createQueryBuilder().delete().from($1).execute()',
  ));
}
const programFile = db + '/ProgramDB.ts';
const programSource = fs.readFileSync(programFile, 'utf8');
if (!programSource.includes('await queryRunner.manager.createQueryBuilder().delete().from(Program).execute();')) {
  if (!programSource.includes('await queryRunner.manager.delete(Program, deleteOption);')) {
    throw new Error('Unexpected ProgramDB delete integration');
  }
  fs.writeFileSync(programFile, programSource.replace(
    'await queryRunner.manager.delete(Program, deleteOption);',
    `if (deleteChannelIds.length === 0) {
                await queryRunner.manager.createQueryBuilder().delete().from(Program).execute();
            } else {
                await queryRunner.manager.delete(Program, deleteOption);
            }`,
  ));
}
