import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoProject,createProjectDocument} from '../dist/core/project.mjs';
test('CLI preview needs no output path; optional output is report, never replacement project',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'moment-preflight-'));
 try{
  const source=path.join(dir,'project.json'),out=path.join(dir,'report.json'),raw=JSON.stringify(createProjectDocument(createDemoProject()));await fs.writeFile(source,raw);
  const cli=fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),operations=[{command:'project.update',arguments:{patch:{speed:2}}}];
  const run=(operations,extra=[])=>spawnSync(process.execPath,[cli,'exec','project.preview','--project',source,'--json',JSON.stringify({operations}),...extra],{encoding:'utf8'});
  let r=run(operations);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).data.after.outputDuration,6);
  r=run(operations,['--out',out]);assert.equal(r.status,0,r.stderr);const report=JSON.parse(await fs.readFile(out,'utf8'));assert.equal(report.wouldCommit,true);assert.equal(Object.hasOwn(report,'project'),false);
  const saved=await fs.readFile(out,'utf8');r=run([{command:'timeline.move',arguments:{clipIndex:99,toIndex:0}}],['--out',out,'--overwrite']);assert.notEqual(r.status,0);assert.equal(await fs.readFile(out,'utf8'),saved);
  r=run(operations,['--out',out,'--overwrite','--dry-run']);assert.equal(r.status,0,r.stderr);assert.equal(await fs.readFile(out,'utf8'),saved);assert.equal(await fs.readFile(source,'utf8'),raw);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
