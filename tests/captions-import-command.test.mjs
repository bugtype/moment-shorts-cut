import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoProject,createProjectDocument,projectSubtitles} from '../dist/core/project.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {parseSubtitles} from '../dist/captions.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';

const srt='1\n00:00:02,000 --> 00:00:10,000\n<b>한글🎬</b> &lt;tag&gt;';
test('subtitle import reuses parser, requires explicit pre-speed basis and only replaces captions',()=>{
 const p=createDemoProject();p.clips=[{start:2,end:6}];p.speed=2;const before=structuredClone(p);
 for(const basis of ['source','timeline']){
  const expected=parseSubtitles(srt,basis==='source'?12:4).map(c=>({...c,basis}));
  const r=prepareCommand(p,'captions.import',{text:srt,basis});
  assert.deepEqual(r.project,{...before,captions:expected});
  assert.deepEqual(r.data,{updated:true,outputDuration:2,importedCaptions:1});
  assert.equal(r.project.captions[0].start,2,'import does not multiply/divide by speed');
 }
 assert.deepEqual(p,before);
 const vtt='\ufeffWEBVTT\r\n\r\n00:00.000 --> 00:01.000\r\n<b>A</b> &amp; B';
 assert.deepEqual(prepareCommand(p,'captions.import',{text:vtt,basis:'timeline'}).project.captions,[{start:0,end:1,text:'A & B',basis:'timeline'}]);
});

test('subtitle import clips ends and skips unsupported or out-of-range cues exactly as browser parser',()=>{
 const p=createDemoProject();
 const text=srt+'\n\n2\n00:00:15,000 --> 00:00:20,000\nskipped\n\n3\n00:00:11,000 --> 00:00:14,000\nclipped';
 const r=prepareCommand(p,'captions.import',{text,basis:'source'});
 assert.equal(r.data.importedCaptions,2);assert.equal(r.project.captions[1].end,12);
 const maxText=' '.repeat(100000-srt.length-1)+'\n'+srt;
 assert.equal(maxText.length,100000);assert.equal(prepareCommand(p,'captions.import',{text:maxText,basis:'source'}).data.importedCaptions,1);
 assert.throws(()=>prepareCommand(p,'captions.import',{text:maxText+' ',basis:'source'}));
});

test('parser and schema failures keep service state unchanged and expose useful input errors',async()=>{
 let p=createDemoProject(),commits=0;const before=structuredClone(p);
 const service=createEditorService({getProject:()=>p,commitProject:next=>{p=next;commits++;}});
 const failures=[{text:srt},{text:srt,basis:'output'},{text:'invalid',basis:'source'},{text:'',basis:'source'},
  {text:'1\n00:00:15,000 --> 00:00:20,000\noutside',basis:'source'},
  {text:'1\n00:00:00,000 --> 00:00:01,000\n'+'a'.repeat(2001),basis:'source'},
  {text:srt,basis:'source',format:'srt'},{text:3,basis:'source'}];
 for(const args of failures){const r=await service.execute('captions.import',args);assert.equal(r.ok,false);assert.equal(r.error.code,'INVALID_ARGUMENT');}
 const invalid=await service.execute('captions.import',{text:'invalid',basis:'source'});
 assert.equal(invalid.error.path,'arguments.text');assert.match(invalid.error.message,/유효한/);
 assert.equal(commits,0);assert.deepEqual(p,before);
 const adapter=createMcpToolAdapter({resolveService:()=>service});
 const imported=await adapter.callTool('moment_captions_import',{projectId:'session',text:srt,basis:'source'});
 assert.equal(imported.isError,false);assert.equal(imported.structuredContent.data.importedCaptions,1);assert.equal(commits,1);
 assert.match(projectSubtitles(p),/한글🎬/);
});

test('CLI imports args-file subtitles in dry-run and saved output, protecting both files on invalid input',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-subtitle-import-'));
 try{
  const input=path.join(dir,'project.json'),argsFile=path.join(dir,'args.json'),output=path.join(dir,'imported.json');
  const original=JSON.stringify(createProjectDocument(createDemoProject()));await fs.writeFile(input,original);
  await fs.writeFile(argsFile,JSON.stringify({text:srt,basis:'source'}));
  const run=extra=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','captions.import','--project',input,'--args-file',argsFile,...extra],{encoding:'utf8'});
  let r=run(['--dry-run']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).preview.project.captions[0].basis,'source');
  await assert.rejects(fs.stat(output),{code:'ENOENT'});
  r=run(['--out',output]);assert.equal(r.status,0,r.stderr);const saved=await fs.readFile(output,'utf8');assert.equal(JSON.parse(saved).project.captions.length,1);
  await fs.writeFile(argsFile,JSON.stringify({text:'invalid',basis:'source'}));r=run(['--out',output,'--overwrite']);
  assert.equal(r.status,1);assert.equal(JSON.parse(r.stderr).error.code,'INVALID_ARGUMENT');
  assert.equal(await fs.readFile(output,'utf8'),saved);assert.equal(await fs.readFile(input,'utf8'),original);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});


test('app subtitle import preserves an active trim draft with undo/redo and busy protection',async()=>{
 const {context,evaluate,element}=await createAppFixture();
 vm.runInContext('history=[];future=[];selected=0;renderTimeline();',context);
 element('#trimStart').value='1.50';element('#trimEnd').value='3.50';element('#trimStart').focus();
 const before=evaluate('state');context.importArgs={text:srt,basis:'source'};
 assert.equal(vm.runInContext('runEditorCommand("captions.import",importArgs)',context),true);
 const imported=evaluate('state');assert.equal(imported.captions.length,1);
 assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.50','3.50']);
 assert.equal(evaluate('history.length'),1);assert.deepEqual(imported.clips,before.clips);
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);
 vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),imported);
 const count=evaluate('history.length');vm.runInContext('exporting=true',context);
 assert.equal(vm.runInContext('runEditorCommand("captions.import",importArgs)',context),false);
 assert.deepEqual(evaluate('state'),imported);assert.equal(evaluate('history.length'),count);
});
