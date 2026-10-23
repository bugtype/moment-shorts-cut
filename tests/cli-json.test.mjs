import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createDemoProject,createProjectDocument,readProjectDocument} from '../dist/core/project.mjs';

const cli=fileURLToPath(new URL('../cli/moment.mjs',import.meta.url));
const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});

test('CLI accepts a single UTF-8 file BOM while preserving authored Unicode and input bytes',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'moment-json-'));
  try{
    const project=path.join(directory,'project.json'),args=path.join(directory,'args.json'),output=path.join(directory,'output.json');
    const document=createProjectDocument(createDemoProject());
    document.project.name='\ufeff한국어 😀 e\u0301 �';document.project.design.title.lines=['앞\ufeff뒤','\ufeff둘째 줄'];
    for(const prefix of ['', '\ufeff']){
      const input=Buffer.from(prefix+JSON.stringify(document));await fs.writeFile(project,input);
      const read=run('exec','project.get','--project',project);
      assert.equal(read.status,0,read.stderr);assert.deepEqual(JSON.parse(read.stdout).data,document);
      const imported=Buffer.from(prefix+JSON.stringify({document}));await fs.writeFile(args,imported);
      const result=run('exec','project.import','--project',project,'--args-file',args,'--out',output,'--overwrite');
      assert.equal(result.status,0,result.stderr);
      const saved=await fs.readFile(output,'utf8');assert.notEqual(saved[0],'\ufeff');
      assert.deepEqual(readProjectDocument(JSON.parse(saved)),document.project);
      assert.deepEqual(await fs.readFile(project),input);assert.deepEqual(await fs.readFile(args),imported);
      await fs.writeFile(args,prefix+JSON.stringify({patch:{name:'새\ufeff이름 😀'}}));
      const dry=run('exec','project.update','--project',project,'--args-file',args,'--dry-run','--out',output,'--overwrite');
      assert.equal(dry.status,0,dry.stderr);assert.equal(JSON.parse(dry.stdout).preview.project.name,'새\ufeff이름 😀');
      assert.equal(await fs.readFile(output,'utf8'),saved);assert.deepEqual(await fs.readFile(project),input);
    }
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('CLI rejects misplaced/repeated BOM, malformed JSON and UTF-16 without touching output',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'moment-json-errors-'));
  try{
    const project=path.join(directory,'project.json'),input=path.join(directory,'input.json'),output=path.join(directory,'output.json');
    await fs.writeFile(project,JSON.stringify(createProjectDocument(createDemoProject())));
    await fs.writeFile(output,'existing output');
    for(const content of ['\ufeff\ufeff{}',' \ufeff{}','{}\ufeff','\ufeff','\ufeff{"patch":}',Buffer.from('\ufeff{}','utf16le')]){
      await fs.writeFile(input,content);const before=await fs.readFile(input);
      for(const args of [
        ['exec','project.get','--project',input],
        ['exec','project.update','--project',project,'--args-file',input],
      ]){
        const result=run(...args,'--out',output,'--overwrite');
        assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).error.code,'INVALID_JSON');
        assert.equal(result.stdout,'');assert.equal(await fs.readFile(output,'utf8'),'existing output');
        assert.deepEqual(await fs.readFile(input),before);
        assert.deepEqual((await fs.readdir(directory)).sort(),['input.json','output.json','project.json']);
      }
    }
    const inline=run('exec','project.update','--project',project,'--json','\ufeff{"patch":{"name":"new"}}','--out',output,'--overwrite');
    assert.equal(inline.status,1);assert.equal(JSON.parse(inline.stderr).error.code,'INVALID_JSON');
    assert.equal(await fs.readFile(output,'utf8'),'existing output');
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('JSON file byte limit includes the UTF-8 BOM',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'moment-json-size-'));
  try{
    const args=path.join(directory,'args.json'),limit=10*1024*1024;
    const bytes=Buffer.alloc(limit,0x20);Buffer.from('\ufeff{}').copy(bytes);
    await fs.writeFile(args,bytes);
    assert.equal(run('exec','templates.list','--args-file',args).status,0);
    await fs.appendFile(args,' ');
    const result=run('exec','templates.list','--args-file',args);
    assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).error.code,'FILE_TOO_LARGE');
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('malformed UTF-8 inside JSON strings cannot be silently repaired and overwrite authored files',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'moment-json-utf8-'));
  try{
    const project=path.join(directory,'project.json'),damaged=path.join(directory,'damaged.json'),args=path.join(directory,'args.json'),missing=path.join(directory,'missing.json');
    const original=JSON.stringify(createProjectDocument(createDemoProject()));await fs.writeFile(project,original);
    const document=JSON.parse(original);document.project.name='MARKER';
    const damagedText=JSON.stringify(document),argumentText=JSON.stringify({patch:{name:'MARKER'}});
    const insert=(text,bytes,prefix)=>{
      const offset=text.indexOf('MARKER');
      return Buffer.concat([Buffer.from(prefix+text.slice(0,offset)),Buffer.from(bytes),Buffer.from(text.slice(offset+6))]);
    };
    for(const bytes of [[0xff],[0x80],[0xc0,0xaf],[0xe2,0x82],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80]]){
      for(const prefix of ['', '\ufeff']){
        const damagedBytes=insert(damagedText,bytes,prefix),argBytes=insert(argumentText,bytes,prefix);
        await fs.writeFile(damaged,damagedBytes);await fs.writeFile(args,argBytes);
        for(const command of [
          ['exec','project.update','--project',damaged,'--json','{"patch":{"zoom":1.5}}','--out',damaged],
          ['exec','project.update','--project',project,'--args-file',args,'--out',project],
          ['exec','project.update','--project',project,'--args-file',args,'--out',missing],
        ]){
          const result=run(...command,'--overwrite');
          assert.equal(result.status,1);assert.equal(result.stdout,'');
          const error=JSON.parse(result.stderr).error;
          assert.equal(error.code,'INVALID_JSON');assert.match(error.message,/UTF-8/);
          assert.deepEqual(await fs.readFile(damaged),damagedBytes);
          assert.deepEqual(await fs.readFile(args),argBytes);
          assert.equal(await fs.readFile(project,'utf8'),original);
          assert.deepEqual((await fs.readdir(directory)).sort(),['args.json','damaged.json','project.json']);
        }
      }
    }
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
