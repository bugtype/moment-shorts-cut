import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoProject,createProjectDocument} from '../dist/core/project.mjs';
test('CLI template inspection writes a content report without changing the source project',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'moment-template-inspect-'));
 try{
  const source=path.join(dir,'project.json'),out=path.join(dir,'report.json'),raw=JSON.stringify(createProjectDocument(createDemoProject()));await fs.writeFile(source,raw);
  const cli=fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),args={templateId:'hook-result',withContent:true};
  const run=(args,extra=[])=>spawnSync(process.execPath,[cli,'exec','template.inspect','--project',source,'--json',JSON.stringify(args),...extra],{encoding:'utf8'});
  let r=run(args);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).data.cards.length,4);
  r=run(args,['--out',out]);assert.equal(r.status,0,r.stderr);const report=JSON.parse(await fs.readFile(out,'utf8'));assert.equal(report.template.id,'hook-result');assert.equal(Object.hasOwn(report,'project'),false);
  const saved=await fs.readFile(out,'utf8');r=run({templateId:'missing'},['--out',out,'--overwrite']);assert.notEqual(r.status,0);assert.equal(await fs.readFile(out,'utf8'),saved);
  r=run(args,['--out',out,'--overwrite','--dry-run']);assert.equal(r.status,0,r.stderr);assert.equal(await fs.readFile(out,'utf8'),saved);assert.equal(await fs.readFile(source,'utf8'),raw);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
