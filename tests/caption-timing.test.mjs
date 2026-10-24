import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {shiftCaptionTiming} from '../dist/core/caption-timing.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {createDemoProject,createProjectDocument,projectSubtitles} from '../dist/core/project.mjs';
import {createAppFixture} from './fixtures/app.mjs';

function project(){const p=createDemoProject();p.speed=2;p.clips=[{start:0,end:6},{start:0,end:6}];p.captions=[{start:1,end:2,text:'source',speaker:'0',keywords:'source',timing:'estimated'},{start:3,end:4,text:'timeline',basis:'timeline'}];return p;}
test('shift changes only selected pre-speed basis, preserving metadata/order/repeated occurrence mapping',()=>{
 const p=project(),before=structuredClone(p),r=prepareCommand(p,'captions.timing.shift',{basis:'source',delta:.5});
 assert.deepEqual(r.data,{updated:true,shiftedCaptions:1,outputDuration:6});
 assert.deepEqual(r.project,{...before,captions:[{...before.captions[0],start:1.5,end:2.5},before.captions[1]]});
 assert.deepEqual(p,before);assert.match(projectSubtitles(r.project),/00:00:00,750 --> 00:00:01,250/);
 assert.match(projectSubtitles(r.project),/00:00:03,750 --> 00:00:04,250/);
 const t=prepareCommand(p,'captions.timing.shift',{basis:'timeline',delta:-1});assert.equal(t.project.captions[1].start,2);assert.deepEqual(t.project.captions[0],p.captions[0]);
 assert.equal(shiftCaptionTiming([{start:1,end:2,text:'x'}],{basis:'source',delta:-1},2).captions[0].start,0);
 assert.equal(shiftCaptionTiming([{start:1,end:2,text:'x'}],{basis:'source',delta:1},3).captions[0].end,3);
});
test('zero/no matches skip commit; invalid bounds reject atomically and ineffective tiny shifts skip history',()=>{
 const p=project(),before=structuredClone(p);
 for(const args of [{basis:'source',delta:0},{basis:'source',delta:-0}]){const r=prepareCommand(p,'captions.timing.shift',args);assert.equal(r.project,undefined);assert.equal(r.data.updated,false);}
 assert.equal(prepareCommand(p,'captions.timing.shift',{basis:'source',delta:Number.MIN_VALUE}).project,undefined);
 const empty=shiftCaptionTiming([],{basis:'source',delta:2},12);assert.equal(empty.shiftedCaptions,0);
 for(const args of [{basis:'source',delta:-2},{basis:'source',delta:20},{basis:'output',delta:1},{basis:'source',delta:Infinity},{basis:'source',delta:NaN},{basis:'source',delta:'1'},{basis:'source'}, {delta:1}])assert.throws(()=>prepareCommand(p,'captions.timing.shift',args));
 const cues=[{start:1,end:2,text:'first'},{start:11,end:12,text:'last'}],copy=structuredClone(cues);
 assert.throws(()=>shiftCaptionTiming(cues,{basis:'source',delta:.1},12));assert.deepEqual(cues,copy);
 assert.equal(shiftCaptionTiming([{start:.3,end:.5,text:'x'}],{basis:'source',delta:-.1-.2},1).captions[0].start,0);
 assert.throws(()=>shiftCaptionTiming([{start:0,end:1,text:'x'}],{basis:'source',delta:-1e-10},86400));
 assert.throws(()=>shiftCaptionTiming([{start:86398,end:86400,text:'x',basis:'timeline'}],{basis:'timeline',delta:1},172800));
 assert.equal(shiftCaptionTiming([{start:0,end:.2,text:'x'}],{basis:'source',delta:.1},.3).captions[0].end,.3);
 assert.throws(()=>shiftCaptionTiming([{start:0,end:.2,text:'x'}],{basis:'source',delta:.100001},.3));assert.deepEqual(p,before);
});
test('actual app UI shift is one undoable edit, preserves draft, rejects busy, no-ops and IME',async()=>{
 const f=await createAppFixture(),{context,evaluate,element}=f;context.seed=project();
 vm.runInContext('state=seed;history=[];future=[];selected=0;renderTimeline();renderInspector();switchPanel("captions");',context);
 element('#trimStart').value='1.50';element('#trimEnd').value='3.50';element('#trimStart').focus();
 const input=value=>{element('#captionShiftDelta').value=value;element('#captionShiftDelta').onchange();};
 const before=evaluate('state');input('0');element('#shiftCaptionTiming').onclick();assert.equal(evaluate('history.length'),0);
 input('.5');element('#shiftCaptionTiming').onclick();assert.equal(evaluate('history.length'),1);assert.equal(evaluate('state.captions[0].start'),1.5);
 assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.50','3.50']);
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);
 vm.runInContext('undo(true)',context);const shifted=evaluate('state');
 const stale=element('#shiftCaptionTiming').onclick;vm.runInContext('renderPanel()',context);stale();assert.deepEqual(evaluate('state'),shifted);
 element('#panelContent').oncompositionstart();element('#shiftCaptionTiming').onclick();assert.deepEqual(evaluate('state'),shifted);element('#panelContent').oncompositionend();
 vm.runInContext('exporting=true',context);element('#toast').textContent='unchanged';element('#shiftCaptionTiming').onclick();assert.deepEqual(evaluate('state'),shifted);assert.equal(element('#toast').textContent,'unchanged');
 vm.runInContext('exporting=false',context);input('');element('#shiftCaptionTiming').onclick();assert.deepEqual(evaluate('state'),shifted);
});
test('real CLI shift dry-run/save reflects selected clock and rejects invalid output atomically',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-shift-'));try{
  const source=path.join(dir,'source.json'),out=path.join(dir,'out.json');await fs.writeFile(source,JSON.stringify(createProjectDocument(project())));
  const run=(delta,flags)=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','captions.timing.shift','--project',source,'--json',JSON.stringify({basis:'source',delta}),...flags],{encoding:'utf8'});
  let r=run(.5,['--dry-run']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).preview.project.captions[0].start,1.5);
  r=run(.5,['--out',out]);assert.equal(r.status,0,r.stderr);const saved=await fs.readFile(out,'utf8');r=run(-100,['--out',out,'--overwrite']);assert.equal(r.status,1);assert.equal(await fs.readFile(out,'utf8'),saved);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
