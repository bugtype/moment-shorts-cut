import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoProject,createProjectDocument} from '../dist/core/project.mjs';
const cli=fileURLToPath(new URL('../cli/moment.mjs',import.meta.url));
test('CLI clip pages omit caption text and preserve input/output on invalid or dry-run requests',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'moment-clips-'));
 try{
  const p=createDemoProject();p.clips=[{start:8,end:12},{start:0,end:4}];p.speed=2;
  p.captions=Array.from({length:10000},()=>({start:0,end:1,text:'not included in clip page'}));
  const source=path.join(dir,'project.json'),out=path.join(dir,'page.json'),bytes=JSON.stringify(createProjectDocument(p));await fs.writeFile(source,bytes);await fs.writeFile(out,'sentinel');
  const run=(args,extra=[])=>spawnSync(process.execPath,[cli,'exec','timeline.list','--project',source,'--json',JSON.stringify(args),...extra],{encoding:'utf8'});
  let r=run({offset:1,limit:1});assert.equal(r.status,0,r.stderr);let page=JSON.parse(r.stdout).data;
  assert.equal(page.clips[0].outputStart,2);assert.equal(page.clips[0].sourceStart,0);assert.equal(r.stdout.includes('not included'),false);
  r=run({limit:51},['--out',out,'--overwrite']);assert.notEqual(r.status,0);assert.equal(await fs.readFile(out,'utf8'),'sentinel');
  r=run({offset:1},['--out',out,'--overwrite','--dry-run']);assert.equal(r.status,0,r.stderr);assert.equal(await fs.readFile(out,'utf8'),'sentinel');
  r=run({offset:1},['--out',out,'--overwrite']);assert.equal(r.status,0,r.stderr);page=JSON.parse(await fs.readFile(out,'utf8'));assert.equal(page.clips[0].clipIndex,1);assert.equal(Object.hasOwn(page,'project'),false);
  assert.equal(await fs.readFile(source,'utf8'),bytes);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
