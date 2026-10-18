// Apply the dependency compatibility changes to the pinned upstream source.
const fs = require('fs');
const root = '/app';
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
