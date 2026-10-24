import {formatError} from '../dist/i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoProject,createProjectDocument,readProjectDocument,MAX_PROJECT_FILE_BYTES,assertProjectFileSize} from '../dist/core/project.mjs';
import {createTextFileWorkflow} from '../dist/text-file-workflow.mjs';
function sizedProject(bytes){
 const p=createDemoProject();p.captions=Array.from({length:6000},()=>({start:0,end:1,text:''}));p.captions[0].text='가';
 let remaining=bytes-Buffer.byteLength(JSON.stringify(createProjectDocument(p),null,2));
 for(const cue of p.captions){const n=Math.min(2000-cue.text.length,remaining);cue.text+='a'.repeat(n);remaining-=n;}
 assert.equal(remaining,0);assert.equal(Buffer.byteLength(JSON.stringify(createProjectDocument(p),null,2)),bytes);return p;
}
function workflow(project){
 const f={project,downloads:[],messages:[],calls:0};f.api=createTextFileWorkflow({
 getProject:()=>f.project,execute:async(name,args)=>{f.calls++;f.project=readProjectDocument(args.document);return {ok:true};},
 query:()=>({value:''}),closeModal(){},focusImportedCaption(){},settingsUnavailable:()=>false,
 download:(blob,name)=>f.downloads.push({blob,name}),toast:text=>f.messages.push(formatError(text)),
 });return f;
}
test('settings-file limit checks actual UTF-8 bytes at exact boundary without constraining in-memory documents',()=>{
 assert.doesNotThrow(()=>assertProjectFileSize(MAX_PROJECT_FILE_BYTES));
 assert.throws(()=>assertProjectFileSize(MAX_PROJECT_FILE_BYTES+1),e=>e.code==='FILE_TOO_LARGE'&&/10 MiB/.test(e.message));
 const p=sizedProject(MAX_PROJECT_FILE_BYTES+1),document=createProjectDocument(p);
 assert.equal(readProjectDocument(document).captions.length,6000);
 assert.ok(JSON.stringify(document,null,2).length<MAX_PROJECT_FILE_BYTES+1,'Unicode bytes differ from JS length');
});
test('browser exact-budget export restores; one extra byte refuses download and validation failures are caught',async()=>{
 const p=sizedProject(MAX_PROJECT_FILE_BYTES),f=workflow(p),before=JSON.stringify(p);f.api.downloadProjectSettings();
 assert.equal(f.downloads.length,1);assert.equal(f.downloads[0].blob.size,MAX_PROJECT_FILE_BYTES);assert.equal(JSON.stringify(p),before);
 const restored=workflow(createDemoProject());assert.equal((await restored.api.importProjectSettings(f.downloads[0].blob)).ok,true);assert.deepEqual(restored.project,p);
 f.project=sizedProject(MAX_PROJECT_FILE_BYTES+1);f.api.downloadProjectSettings();assert.equal(f.downloads.length,1);assert.match(f.messages.at(-1),/10 MiB/);
 f.project.speed=0;assert.doesNotThrow(()=>f.api.downloadProjectSettings());assert.equal(f.downloads.length,1);assert.ok(f.messages.length>=2);
});
test('browser import rejects actual bytes even when file metadata lies, and skips oversized advertised reads',async()=>{
 const f=workflow(createDemoProject()),before=structuredClone(f.project);
 const r=await f.api.importProjectSettings({size:1,arrayBuffer:async()=>new ArrayBuffer(MAX_PROJECT_FILE_BYTES+1)});
 assert.equal(r.ok,false);assert.match(r.error.message,/10 MiB/);assert.equal(f.calls,0);assert.deepEqual(f.project,before);
 let reads=0;await f.api.importProjectSettings({size:MAX_PROJECT_FILE_BYTES+1,arrayBuffer:async()=>{reads++;return new ArrayBuffer(1);}});assert.equal(reads,0);
});
test('CLI final newline budget protects existing output for project.get and mutations; dry-run stays in memory',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-budget-'));try{
 const input=path.join(dir,'in.json'),out=path.join(dir,'out.json');const p=sizedProject(MAX_PROJECT_FILE_BYTES);await fs.writeFile(input,JSON.stringify(createProjectDocument(p)));await fs.writeFile(out,'preserve');
 const cli=fileURLToPath(new URL('../cli/moment.mjs',import.meta.url));
 const run=(command,flags)=>spawnSync(process.execPath,[cli,'exec',command,'--project',input,...(command==='project.update'?['--json','{"patch":{}}']:[]),...flags],{encoding:'utf8',maxBuffer:30*1024*1024});
 for(const command of ['project.get','project.update']){const r=run(command,['--out',out,'--overwrite']);assert.equal(r.status,1,r.stderr);assert.equal(JSON.parse(r.stderr).error.code,'FILE_TOO_LARGE');assert.equal(await fs.readFile(out,'utf8'),'preserve');}
 assert.deepEqual((await fs.readdir(dir)).sort(),['in.json','out.json']);
 let r=run('project.update',['--dry-run','--out',out,'--overwrite']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).preview.project.captions.length,6000);assert.equal(await fs.readFile(out,'utf8'),'preserve');
 r=run('project.get',[]);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).data.project.captions.length,6000);
 // One byte less leaves room for the CLI's existing trailing newline.
 const smaller=sizedProject(MAX_PROJECT_FILE_BYTES-1);await fs.writeFile(input,JSON.stringify(createProjectDocument(smaller)));
 r=run('project.get',['--out',out,'--overwrite']);assert.equal(r.status,0,r.stderr);assert.equal((await fs.stat(out)).size,MAX_PROJECT_FILE_BYTES);assert.equal(readProjectDocument(JSON.parse(await fs.readFile(out,'utf8'))).captions.length,6000);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
