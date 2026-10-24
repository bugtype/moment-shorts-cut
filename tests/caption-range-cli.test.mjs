import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoProject,createProjectDocument,readProjectDocument} from '../dist/core/project.mjs';
test('CLI range removal previews or writes atomically without truncating an overflow',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'moment-caption-range-'));
 try{
  const source=path.join(dir,'input.json'),out=path.join(dir,'output.json'),p=createDemoProject(),raw=JSON.stringify(createProjectDocument(p));await fs.writeFile(source,raw);await fs.writeFile(out,'keep');
  const cli=fileURLToPath(new URL('../cli/moment.mjs',import.meta.url));
  const run=(args,extra=[])=>spawnSync(process.execPath,[cli,'exec','captions.remove','--project',source,'--json',JSON.stringify(args),'--out',out,'--overwrite',...extra],{encoding:'utf8'});
  let result=run({captionIndex:1,count:3});assert.notEqual(result.status,0);assert.equal(await fs.readFile(out,'utf8'),'keep');
  result=run({captionIndex:1,count:2},['--dry-run']);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).data.totalCaptions,1);assert.equal(await fs.readFile(out,'utf8'),'keep');
  result=run({captionIndex:1,count:2});assert.equal(result.status,0,result.stderr);const next=readProjectDocument(JSON.parse(await fs.readFile(out,'utf8')));assert.deepEqual(next.captions,[p.captions[0]]);assert.equal(await fs.readFile(source,'utf8'),raw);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
