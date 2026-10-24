import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoProject,createProjectDocument,projectSrt,projectSubtitles} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';
import {translateFor} from '../dist/i18n.mjs';

const fixture=()=>({...createDemoProject(),captions:[{start:0,end:1,text:'Before\0After 한글'}]});
test('SRT rejects NUL in derived output without stripping authored text; ordinary bytes remain unchanged',()=>{
 const p=fixture(),before=structuredClone(p);
 for(const bom of [false,true])assert.throws(()=>projectSrt(p,{bom}),e=>e.code==='INVALID_ARGUMENT'&&e.messageKey==='errors.srtNul'&&e.messageParams.index===1);
 assert.deepEqual(p,before);
 for(const locale of ['ko','en','zh-CN'])assert.match(translateFor(locale,'errors.srtNul',{index:1}),/SRT.*1.*NUL/);
 p.captions[0].text='Before After 한글';
 assert.equal(projectSrt(p),'1\n00:00:00,000 --> 00:00:01,000\nBefore After 한글\n');
 p.captions.push(before.captions[0]);
 assert.throws(()=>projectSrt(p),e=>e.messageParams.index===2);
 p.clips=[{start:2,end:3}];assert.equal(projectSrt(p),'','unexported authored cues need not be altered');
});
test('existing VTT/TXT diagnostics and subtitle precision/blank-line precedence stay unchanged',()=>{
 const p=fixture();
 for(const format of ['vtt','txt'])assert.throws(()=>projectSubtitles(p,{format}),e=>e.messageKey===`errors.${format}Nul`);
 p.captions[0].end=.0001;
 for(const format of ['srt','vtt'])assert.throws(()=>projectSubtitles(p,{format}),e=>e.messageKey==='errors.subtitlePrecision');
 p.captions[0].end=1;p.captions[0].text='a\n\nb\0';
 for(const format of ['srt','vtt'])assert.throws(()=>projectSubtitles(p,{format}),e=>e.messageKey==='errors.subtitleBlank');
 assert.throws(()=>projectSubtitles(p,{format:'txt'}),e=>e.messageKey==='errors.txtNul');
});
test('service and MCP report NUL export error without commits, then permit corrected retry',async()=>{
 const p=fixture(),before=structuredClone(p);let commits=0;
 const service=createEditorService({getProject:()=>p,commitProject:()=>commits++});
 const adapter=createMcpToolAdapter({resolveService:()=>service});
 const r=await service.execute('captions.export',{format:'srt'});
 assert.equal(r.ok,false);assert.equal(r.error.code,'INVALID_ARGUMENT');assert.match(r.error.message,/SRT.*NUL/);
 const m=await adapter.callTool('moment_captions_export',{projectId:'session',format:'srt'});
 assert.equal(m.isError,true);assert.equal(m.structuredContent.error.code,'INVALID_ARGUMENT');
 assert.deepEqual(p,before);assert.equal(commits,0);
 p.captions[0].text='Corrected';assert.equal((await service.execute('captions.export',{})).ok,true);assert.equal(commits,0);
});
test('CLI rejects SRT NUL before overwriting or creating output, preserving source and no temporary files',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'moment-srt-nul-'));
 try{
  const source=path.join(dir,'project.json'),output=path.join(dir,'captions.srt'),fresh=path.join(dir,'new.srt');
  const raw=JSON.stringify(createProjectDocument(fixture()));await fs.writeFile(source,raw);await fs.writeFile(output,'existing subtitles');
  const cli=fileURLToPath(new URL('../cli/moment.mjs',import.meta.url));
  for(const target of [output,fresh]){
   const r=spawnSync(process.execPath,[cli,'exec','captions.export','--project',source,'--out',target,'--overwrite'],{encoding:'utf8'});
   assert.equal(r.status,1);assert.equal(JSON.parse(r.stderr).error.code,'INVALID_ARGUMENT');assert.equal(r.stdout,'');
  }
  assert.equal(await fs.readFile(output,'utf8'),'existing subtitles');assert.equal(await fs.readFile(source,'utf8'),raw);
  assert.deepEqual((await fs.readdir(dir)).sort(),['captions.srt','project.json']);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
