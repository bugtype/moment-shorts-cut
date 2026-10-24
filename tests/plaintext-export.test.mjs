import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoProject,createProjectDocument,projectSubtitles} from '../dist/core/project.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {MAX_SUBTITLE_BYTES} from '../dist/captions.mjs';

test('TXT follows derived occurrence order and repeats, preserving literal paragraphs without timestamps',()=>{
 const p=createDemoProject();p.clips=[{start:2,end:4},{start:2,end:4}];p.speed=2;
 p.captions=[{start:0,end:1,text:'omit'},{start:2,end:4,text:' <한글>&🎬\r\n\r다음 '},{start:1,end:3,text:'narration',basis:'timeline'}];
 const before=structuredClone(p);
 assert.equal(projectSubtitles(p,{format:'txt'}),' <한글>&🎬\n\n다음 \n\nnarration\n\n <한글>&🎬\n\n다음 \n');
 assert.deepEqual(prepareCommand(p,'captions.export',{format:'txt'}).data,{format:'txt',text:projectSubtitles(p,{format:'txt'})});
 p.speed=.25;assert.equal(projectSubtitles(p,{format:'txt'}),projectSubtitles(before,{format:'txt'}));
 p.speed=2;assert.deepEqual(p,before);
});

test('TXT accepts blank lines and submillisecond cues but rejects NUL; empty and optional BOM are explicit',()=>{
 const p=createDemoProject();p.captions=[{start:0,end:.00001,text:'a\n\nb'}];
 assert.equal(projectSubtitles(p,{format:'txt'}),'a\n\nb\n');assert.throws(()=>projectSubtitles(p,{format:'srt'}));
 assert.equal(projectSubtitles(p,{format:'txt',bom:true}),'\ufeffa\n\nb\n');
 p.captions[0].text='x\0y';assert.throws(()=>projectSubtitles(p,{format:'txt'}),e=>e.code==='INVALID_ARGUMENT');
 p.captions=[];assert.equal(projectSubtitles(p,{format:'txt',bom:true}),'');
});

test('TXT counts final newlines, separators and BOM against exact UTF8 ceiling without partial output',()=>{
 for(const bom of [false,true]){
  const p=createDemoProject();p.captions=Array.from({length:1048},(_,i)=>({start:0,end:1,text:i===1047?'x'.repeat(1057-(bom?3:0)):'x'.repeat(2000)}));
  const before=structuredClone(p);assert.equal(new TextEncoder().encode(projectSubtitles(p,{format:'txt',bom})).length,MAX_SUBTITLE_BYTES);
  assert.deepEqual(p,before);p.captions.at(-1).text+='x';
  assert.throws(()=>projectSubtitles(p,{format:'txt',bom}),e=>e.code==='CAPTION_OUTPUT_LIMIT');
 }
 const p=createDemoProject();p.clips=[{start:0,end:1},{start:0,end:1}];p.captions=Array.from({length:5001},()=>({start:0,end:1,text:'x'}));
 assert.throws(()=>projectSubtitles(p,{format:'txt'}),e=>e.code==='CAPTION_OUTPUT_LIMIT');
});

test('real CLI TXT export returns literal transcript and leaves project file unchanged',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-txt-'));
 try{
  const input=path.join(dir,'project.json'),p=createDemoProject();p.captions=[{start:0,end:1,text:'<review> & 한글'}];
  const original=JSON.stringify(createProjectDocument(p));await fs.writeFile(input,original);
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','captions.export','--project',input,'--json','{"format":"txt"}'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).data,{format:'txt',text:'<review> & 한글\n'});
  assert.equal(await fs.readFile(input,'utf8'),original);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
