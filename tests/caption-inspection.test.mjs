import {message as msg} from '../dist/i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectCaptions} from '../dist/core/caption-inspection.mjs';
import {captionOccurrences} from '../dist/captions.mjs';
import {fail} from '../dist/core/validation.mjs';
import {prepareCommand,commandDefinition} from '../dist/core/commands.mjs';
import {createDemoProject,createProjectDocument} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';
import {createAppFixture} from './fixtures/app.mjs';
const project=text=>{const p=createDemoProject();p.captions=[{start:0,end:1,text}];return p;};
const inspect=(p,args={maxGraphemesPerSecond:.1})=>prepareCommand(p,'captions.inspect',args);
test('graphemes exclude only whitespace clusters and count punctuation/markup without altering authored content',()=>{
 const p=project('😀é한🇰🇷👍🏽👨‍👩‍👧‍👦 \n\t.!<b> \u0301'),before=structuredClone(p);
 const result=inspect(p);assert.equal(result.project,undefined);assert.equal(result.data.issues[0].graphemeCount,12);assert.deepEqual(p,before);
 for(const text of ['', ' \r\n\t'])assert.deepEqual(inspect(project(text)).data.issues,[]);
 assert.equal(inspect(project('AB'),{maxGraphemesPerSecond:2}).data.flaggedOccurrences,0);
 assert.equal(inspect(project('AB'),{maxGraphemesPerSecond:1.999999}).data.flaggedOccurrences,1);
});
test('cuts, repeats, speed and timeline cues inspect derived output with stable source references',()=>{
 const p=project('가나다라마바사아자차카타파하');p.captions[0].end=4;
 assert.equal(inspect(p).data.issues[0].graphemesPerSecond,3.5);
 p.clips=[{start:0,end:1},{start:0,end:1}];p.speed=2;p.captions.push({start:0,end:1,text:'AB',basis:'timeline'});
 const r=inspect(p).data;assert.equal(r.totalOccurrences,3);assert.deepEqual(r.issues.map(c=>c.graphemesPerSecond),[28,28,4]);
 assert.deepEqual(r.issues.map(c=>c.occurrenceIndex),[0,2,1]);assert.deepEqual(r.issues.slice(0,2).map(c=>c.clipIndex),[0,1]);assert.equal(Object.hasOwn(r.issues[2],'clipIndex'),false);
 assert.deepEqual(r.issues.slice(0,2).map(c=>[c.start,c.end]),[[0,.5],[.5,1]]);
});
test('top N is bounded with full totals, stable ties, no text payload and empty/trimmed-out cues',()=>{
 const p=project('AB');p.captions=Array.from({length:150},(_,i)=>({start:0,end:1,text:i<2?'ABC':'AB'}));
 const r=inspect(p,{maxGraphemesPerSecond:1,limit:2}).data;assert.equal(r.totalOccurrences,150);assert.equal(r.flaggedOccurrences,150);assert.equal(r.omittedOccurrences,148);assert.deepEqual(r.issues.map(c=>c.captionIndex),[0,1]);assert.ok(r.issues.every(c=>!Object.hasOwn(c,'text')));
 assert.equal(inspect(p,{maxGraphemesPerSecond:1}).data.issues.length,20);
 assert.equal(inspect(p,{maxGraphemesPerSecond:1,limit:100}).data.issues.length,100);
 p.captions=[];assert.equal(inspect(p).data.totalOccurrences,0);
 p.captions=[{start:11,end:12,text:'out'}];p.clips=[{start:0,end:1}];assert.equal(inspect(p).data.totalOccurrences,0);
});
test('invalid inputs, unavailable segmenter and floating underflow reject with no nonfinite JSON',async()=>{
 for(const maxGraphemesPerSecond of [0,-1,NaN,Infinity,'1',null])assert.throws(()=>inspect(project('A'),{maxGraphemesPerSecond}),e=>e.code==='INVALID_ARGUMENT');
 for(const limit of [0,101,1.5,'2',null])assert.throws(()=>inspect(project('A'),{maxGraphemesPerSecond:1,limit}));
 const p=project('A');p.captions[0].end=Number.MIN_VALUE;p.speed=4;assert.throws(()=>inspect(p),e=>e.code==='INVALID_ARGUMENT'&&e.path==='project.captions[0]');
 p.speed=1;assert.throws(()=>inspect(p),e=>e.code==='INVALID_ARGUMENT');
 const source=await fs.readFile(new URL('../dist/core/caption-inspection.mjs',import.meta.url),'utf8');
 const helper=vm.runInNewContext(source.replace(/^import .*;$/gm,'').replace('export function','function')+';inspectCaptions',{Intl:{},captionOccurrences,fail,msg});assert.throws(()=>helper(project('A'),{maxGraphemesPerSecond:1}),/안전한 문자/);
});
test('derived occurrence and raw UTF-8 safety budgets remain enforced before reporting',()=>{
 const p=project('A');p.captions=Array.from({length:10000},()=>({start:0,end:1,text:'A'}));assert.equal(inspect(p,{maxGraphemesPerSecond:.1,limit:1}).data.totalOccurrences,10000);
 p.clips=[{start:0,end:1},{start:0,end:1}];assert.throws(()=>inspect(p),e=>e.code==='CAPTION_OUTPUT_LIMIT');
 p.captions=Array.from({length:400},()=>({start:0,end:1,text:'가'.repeat(2000)}));p.clips=[{start:0,end:1}];assert.throws(()=>inspect(p),e=>e.code==='CAPTION_OUTPUT_LIMIT');
});
test('service and MCP inspections are read-only and cannot be admitted to an atomic edit batch',async()=>{
 const p=project('AB');let commits=0,checks=0;const service=createEditorService({getProject:()=>p,commitProject:()=>commits++});
 const result=await service.execute('captions.inspect',{maxGraphemesPerSecond:1},()=>checks++);assert.equal(result.ok,true);assert.equal(commits,0);assert.equal(checks,0);assert.equal(commandDefinition('captions.inspect').mutates,false);
 const adapter=createMcpToolAdapter({resolveService:()=>service}),tool=adapter.listTools().tools.find(t=>t.name==='moment_captions_inspect');assert.equal(tool.annotations.readOnlyHint,true);
 assert.throws(()=>prepareCommand(p,'project.batch',{operations:[{command:'captions.inspect',arguments:{maxGraphemesPerSecond:1}}]}));
 const {context,evaluate}=await createAppFixture();vm.runInContext('history=[];future=[];globalThis.saves=0;scheduleSave=()=>saves++;',context);const before=evaluate('({state,history,future,current})');assert.equal(vm.runInContext("runEditorCommand('captions.inspect',{maxGraphemesPerSecond:1})",context),true);assert.deepEqual(evaluate('({state,history,future,current})'),before);assert.equal(evaluate('saves'),0);
});
test('CLI inspection needs no output path, exports a report not project, and preserves source bytes',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-inspect-'));try{
 const input=path.join(dir,'in.json'),out=path.join(dir,'report.json'),bytes=JSON.stringify(createProjectDocument(project('AB')));await fs.writeFile(input,bytes);
 const run=flags=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','captions.inspect','--project',input,'--json','{"maxGraphemesPerSecond":1}',...flags],{encoding:'utf8'});
 let r=run([]);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).data.flaggedOccurrences,1);
 r=run(['--out',out]);assert.equal(r.status,0,r.stderr);const report=JSON.parse(await fs.readFile(out,'utf8'));assert.equal(report.metric,'non-whitespace-graphemes-per-second');assert.equal(report.project,undefined);assert.equal(await fs.readFile(input,'utf8'),bytes);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
