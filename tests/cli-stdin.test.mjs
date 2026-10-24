import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoProject,createProjectDocument} from '../dist/core/project.mjs';
const cli=fileURLToPath(new URL('../cli/moment.mjs',import.meta.url));
const max=10*1024*1024;
function child(args,{cwd,timeout=8000}={}){
 const proc=spawn(process.execPath,[cli,...args],{cwd,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 proc.stdout.on('data',data=>stdout+=data);proc.stderr.on('data',data=>stderr+=data);
 proc.stdin.on('error',error=>{if(!['EPIPE','ERR_STREAM_DESTROYED'].includes(error.code))throw error;});
 const done=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{proc.kill();reject(Error('CLI did not terminate'));},timeout);
  proc.on('error',error=>{clearTimeout(timer);reject(error);});
  proc.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
 });return {proc,done};
}
async function fixture(fn){const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-stdin-'));try{
 const project=path.join(dir,'project.json');await fs.writeFile(project,JSON.stringify(createProjectDocument(createDemoProject())));await fn(dir,project);
}finally{await fs.rm(dir,{recursive:true,force:true});}}
test('JSON stdin accepts Unicode split across bytes and BOM, dry-run does not write or change input',()=>fixture(async(dir,project)=>{
 const out=path.join(dir,'out.json'),before=await fs.readFile(project,'utf8');
 const c=child(['exec','project.update','--project',project,'--args-file','-','--dry-run','--out',out]);
 const bytes=Buffer.from('\uFEFF'+JSON.stringify({patch:{name:'한글 中文 👩🏽‍💻'}}));
 for(const byte of bytes){c.proc.stdin.write(Buffer.from([byte]));await new Promise(resolve=>setImmediate(resolve));}c.proc.stdin.end();
 const r=await c.done;assert.equal(r.code,0,r.stderr);assert.equal(JSON.parse(r.stdout).preview.project.name,'한글 中文 👩🏽‍💻');
 await assert.rejects(fs.stat(out),{code:'ENOENT'});assert.equal(await fs.readFile(project,'utf8'),before);
}));
test('stdin malformed/empty/multiple JSON and invalid UTF8 protect an existing output',()=>fixture(async(dir,project)=>{
 const out=path.join(dir,'out.json');await fs.writeFile(out,'KEEP');
 for(const input of ['', '  ', '\uFEFF', '{} {}','{}garbage',Buffer.from([0xc3,0x28])]){
  const r=spawnSync(process.execPath,[cli,'exec','project.update','--project',project,'--args-file','-','--out',out,'--overwrite'],{input,encoding:'utf8'});
  assert.equal(r.status,1);assert.equal(JSON.parse(r.stderr).error.code,'INVALID_JSON');assert.equal(r.stdout,'');assert.equal(await fs.readFile(out,'utf8'),'KEEP');
 }
 assert.deepEqual((await fs.readdir(dir)).sort(),['out.json','project.json']);
}));
test('exact 10MiB byte boundary succeeds; overflow terminates before EOF and never writes',()=>fixture(async(dir,project)=>{
 const payload=Buffer.alloc(max,32);Buffer.from('{}').copy(payload);
 const exact=spawnSync(process.execPath,[cli,'exec','templates.list','--args-file','-'],{input:payload,encoding:'utf8',timeout:8000});assert.equal(exact.status,0,exact.stderr);
 const out=path.join(dir,'out.json');await fs.writeFile(out,'KEEP');
 const c=child(['exec','project.update','--project',project,'--args-file','-','--out',out,'--overwrite']);
 c.proc.stdin.write(Buffer.alloc(max+1,32)); // Deliberately do not close stdin.
 const result=await c.done;assert.equal(result.code,1);assert.equal(JSON.parse(result.stderr).error.code,'FILE_TOO_LARGE');assert.equal(result.stdout,'');assert.equal(await fs.readFile(out,'utf8'),'KEEP');
}));
test('literal ./- still reads a file and explicit stdin writes the normal project document',()=>fixture(async(dir,project)=>{
 await fs.writeFile(path.join(dir,'-'),JSON.stringify({patch:{name:'File'}}));
 let r=spawnSync(process.execPath,[cli,'exec','project.update','--project',project,'--args-file','./-','--dry-run'],{cwd:dir,encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).preview.project.name,'File');
 const out=path.join(dir,'saved.json');r=spawnSync(process.execPath,[cli,'exec','project.update','--project',project,'--args-file','-','--out',out],{input:JSON.stringify({patch:{name:'Pipe'}}),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(await fs.readFile(out,'utf8')).project.name,'Pipe');
}));
test('commands needing no stdin and invalid options exit with stdin left open',()=>fixture(async(dir,project)=>{
 for(const args of [['help'],['commands'],['init','--out',path.join(dir,'init.json')],['exec','templates.list','--json','{}'],['exec','unknown','--args-file','-'],['exec','templates.list','--args-file','-','--json','{}'],['exec','project.update','--project',project,'--args-file','-'],['exec','project.get','--project',path.join(dir,'absent'),'--args-file','-']]){
  const c=child(args);const r=await c.done;assert.ok([0,1].includes(r.code));
 }
}));
