import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoProject,createProjectDocument,projectSrt,projectSubtitles} from '../dist/core/project.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {MAX_SUBTITLE_BYTES,parseSubtitles} from '../dist/captions.mjs';

const project=(text='한국어 & <b> -->\n둘째\u00a0줄')=>({...createDemoProject(),clips:[{start:2,end:4},{start:2,end:4}],speed:2,captions:[{start:2,end:4,text}]});
test('plain VTT emits header, dot timing and escaped literal payload on edited output without mutation',()=>{
 const p=project(),before=structuredClone(p),text=projectSubtitles(p,{format:'vtt'});
 assert.equal(text,'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\n한국어 &amp; &lt;b&gt; --&gt;\n둘째&nbsp;줄\n\n2\n00:00:01.000 --> 00:00:02.000\n한국어 &amp; &lt;b&gt; --&gt;\n둘째&nbsp;줄\n');
 assert.deepEqual(parseSubtitles(text,2),[{start:0,end:1,text:p.captions[0].text},{start:1,end:2,text:p.captions[0].text}]);
 assert.deepEqual(p,before);
 assert.equal(projectSubtitles(p),projectSrt(p));
 assert.equal(projectSubtitles(p,{format:'srt',bom:true}),projectSrt(p,{bom:true}));
 assert.deepEqual(prepareCommand(p,'captions.export').data,{format:'srt',text:projectSrt(p)});
 assert.deepEqual(prepareCommand(p,'captions.export',{format:'vtt'}).data,{format:'vtt',text});
});
test('VTT empty output is valid header-only while legacy SRT remains empty',()=>{
 const p=project();p.captions=[];
 assert.equal(projectSubtitles(p,{format:'vtt'}),'WEBVTT\n\n');
 assert.equal(projectSubtitles(p,{format:'vtt',bom:true}),'\ufeffWEBVTT\n\n');
 assert.equal(projectSubtitles(p,{bom:true}),'');
});
test('VTT rejects unrepresentable cues and unsupported formats without mutation',()=>{
 for(const text of ['a\0b','a\n\nb','a\n \nb']){
  const p=project(text),before=structuredClone(p);
  assert.throws(()=>projectSubtitles(p,{format:'vtt'}),e=>e.code==='INVALID_ARGUMENT');
  assert.deepEqual(p,before);
 }
 const p=project('short');p.captions[0].end=2.0001;
 assert.throws(()=>projectSubtitles(p,{format:'vtt'}),/밀리초/);
 assert.throws(()=>projectSubtitles(project(),{format:'ass'}),/srt/);
 assert.throws(()=>prepareCommand(project(),'captions.export',{format:'ass'}),e=>e.code==='INVALID_ARGUMENT');
});
test('VTT complete byte budget includes header, BOM, escaping and separators',()=>{
 for(const bom of [false,true]){
  const p={...createDemoProject(),clips:[{start:0,end:1}],captions:Array.from({length:1100},()=>({start:0,end:1,text:'한&<>\u00a0'}))};
  let remaining=MAX_SUBTITLE_BYTES-Buffer.byteLength(projectSubtitles(p,{format:'vtt',bom}));
  for(const c of p.captions){const n=Math.min(remaining,1999-c.text.length);c.text+='a'.repeat(n);remaining-=n;}
  assert.equal(remaining,0);assert.equal(Buffer.byteLength(projectSubtitles(p,{format:'vtt',bom})),MAX_SUBTITLE_BYTES);
  p.captions.at(-1).text+='a';
  assert.throws(()=>projectSubtitles(p,{format:'vtt',bom}),e=>e.code==='CAPTION_OUTPUT_LIMIT');
 }
});
test('CLI selects VTT explicitly, defaults to SRT regardless of filename, and preserves files on invalid format',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-vtt-'));
 try{
  const input=path.join(dir,'project.json'),output=path.join(dir,'captions.vtt'),p=project();
  const original=JSON.stringify(createProjectDocument(p));await fs.writeFile(input,original);
  const run=args=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','captions.export','--project',input,'--out',output,'--overwrite',...args],{encoding:'utf8'});
  let result=run(['--json','{"format":"vtt"}']);assert.equal(result.status,0,result.stderr);assert.equal(await fs.readFile(output,'utf8'),projectSubtitles(p,{format:'vtt'}));
  result=run([]);assert.equal(result.status,0,result.stderr);assert.equal(await fs.readFile(output,'utf8'),projectSrt(p));
  result=run(['--json','{"format":"ass"}']);assert.equal(result.status,1);assert.equal(await fs.readFile(output,'utf8'),projectSrt(p));
  assert.equal(await fs.readFile(input,'utf8'),original);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
