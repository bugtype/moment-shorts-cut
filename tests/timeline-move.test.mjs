import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareCommand} from '../dist/core/commands.mjs';
import {createDemoProject,createProjectDocument,projectSubtitles} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {newCard} from '../dist/effects.mjs';
const fixture=()=>{
 const p=createDemoProject();p.speed=2;p.clips=[{start:0,end:.1},{start:1,end:1.2},{start:2,end:2.3}];
 p.overlays=[{...newCard(1),id:'preserved',start:.123456789,end:.234567891}];
 p.design.title.start=.1234567;p.design.title.end=.2345678;p.design.credit.start=.2;p.design.credit.end=null;
 p.audioOffset=.123;p.captions=[{start:0,end:.1,text:'first',speaker:'1',keywords:'raw',timing:'estimated'},{start:2,end:2.3,text:'last'},{start:.1,end:.2,text:'timeline',basis:'timeline'}];return p;
};
const move=(p,clipIndex,toIndex)=>prepareCommand(p,'timeline.move',{clipIndex,toIndex});
test('every move uses final index, detached clips and exact unchanged authored state/output-layer numbers',()=>{
 for(let from=0;from<3;from++)for(let to=0;to<3;to++){
  const p=fixture(),before=structuredClone(p),r=move(p,from,to);
  assert.equal(r.data.updated,from!==to);assert.deepEqual(p,before);
  if(from===to){assert.equal(Object.hasOwn(r,'project'),false);continue;}
  const expected=structuredClone(p),[clip]=expected.clips.splice(from,1);expected.clips.splice(to,0,clip);
  assert.deepEqual(r.project,expected);assert.notEqual(r.project.clips[to],p.clips[from]);
  r.project.captions[0].text='detached';assert.deepEqual(p,before);
 }
});
test('fractional accumulation never proportionally retimes layers; source occurrences move, timeline cues do not',()=>{
 const p=fixture(),r=move(p,2,0);
 assert.deepEqual(r.project.design,p.design);assert.deepEqual(r.project.overlays,p.overlays);
 assert.deepEqual(r.project.captions,p.captions);assert.equal(r.project.audioOffset,p.audioOffset);
 assert.equal(projectSubtitles(p,{format:'txt'}),'first\n\ntimeline\n\nlast\n');
 assert.equal(projectSubtitles(r.project,{format:'txt'}),'last\n\ntimeline\n\nfirst\n');
});
test('repeated identical ranges retain index semantics, singleton no-op, 1000-clip boundary works',()=>{
 const p=fixture();p.clips=[{start:0,end:1},{start:0,end:1}];const r=move(p,0,1);
 assert.equal(r.data.updated,true);assert.deepEqual(r.project,p);
 p.clips=[{start:0,end:1}];assert.equal(move(p,0,0).data.updated,false);
 p.clips=Array.from({length:1000},(_,i)=>({start:i%10,end:i%10+.5}));
 const moved=move(p,999,0);assert.equal(moved.project.clips.length,1000);assert.deepEqual(moved.project.clips[0],p.clips[999]);
});
test('all invalid indices and unsupported fields reject without input mutation',()=>{
 const p=fixture(),before=structuredClone(p);
 for(const key of ['clipIndex','toIndex'])for(const value of [-1,3,1000,.5,NaN,Infinity,null,'1',undefined]){
  const args={clipIndex:0,toIndex:1,[key]:value};
  assert.throws(()=>prepareCommand(p,'timeline.move',args),error=>error.code==='INVALID_ARGUMENT');assert.deepEqual(p,before);
 }
 assert.throws(()=>prepareCommand(p,'timeline.move',{clipIndex:0,toIndex:1,extra:true}));
});
test('service no-op skips commit; sequential batch moves commit once and later failure is atomic',async()=>{
 let p=fixture(),commits=0;const service=createEditorService({getProject:()=>p,commitProject:next=>{p=next;commits++;}});
 assert.equal((await service.execute('timeline.move',{clipIndex:0,toIndex:0})).data.updated,false);assert.equal(commits,0);
 const before=structuredClone(p),ops=[{command:'timeline.move',arguments:{clipIndex:2,toIndex:0}},{command:'timeline.move',arguments:{clipIndex:1,toIndex:2}}];
 const result=await service.execute('project.batch',{operations:ops});assert.equal(result.ok,true);assert.equal(commits,1);
 assert.deepEqual(p.clips,[before.clips[2],before.clips[1],before.clips[0]]);
 const saved=structuredClone(p);const rejected=await service.execute('project.batch',{operations:[ops[0],{command:'timeline.move',arguments:{clipIndex:99,toIndex:0}}]});
 assert.equal(rejected.ok,false);assert.equal(commits,1);assert.deepEqual(p,saved);
 const noops=await service.execute('project.batch',{operations:[{command:'timeline.move',arguments:{clipIndex:0,toIndex:0}}]});
 assert.equal(noops.data.updated,false);assert.equal(commits,1);
});
test('CLI dry-run/write roundtrip and invalid move leave existing file unchanged',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-move-'));
 try{
  const input=path.join(dir,'in.json'),out=path.join(dir,'out.json'),p=fixture();await fs.writeFile(input,JSON.stringify(createProjectDocument(p)));
  const run=(args,flags)=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','timeline.move','--project',input,'--json',JSON.stringify(args),...flags],{encoding:'utf8'});
  let r=run({clipIndex:2,toIndex:0},['--dry-run']);assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout).preview.project,move(p,2,0).project);
  r=run({clipIndex:2,toIndex:0},['--out',out]);assert.equal(r.status,0,r.stderr);const saved=await fs.readFile(out,'utf8');assert.deepEqual(JSON.parse(saved).project,move(p,2,0).project);
  r=run({clipIndex:2,toIndex:3},['--out',out,'--overwrite']);assert.equal(r.status,1);assert.equal(await fs.readFile(out,'utf8'),saved);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
