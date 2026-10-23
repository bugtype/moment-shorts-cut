import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const cli=fileURLToPath(new URL('../cli/moment.mjs',import.meta.url));
const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});

test('unsupported CLI options cannot create or overwrite files, including init dry-run',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'moment-options-'));
  try{
    const existing=path.join(directory,'existing.json'),missing=path.join(directory,'missing.json');
    await fs.writeFile(existing,'existing authored settings');
    for(const output of [existing,missing]){
      for(const extra of [['--dry-run'],['--project',missing],['--json','{}'],['--args-file',missing]]){
        const result=run('init','--out',output,'--overwrite',...extra);
        assert.equal(result.status,1,result.stdout);
        assert.equal(JSON.parse(result.stderr).error.code,'CLI_USAGE');
        assert.equal(result.stdout,'');
        assert.equal(await fs.readFile(existing,'utf8'),'existing authored settings');
        assert.deepEqual(await fs.readdir(directory),['existing.json']);
      }
    }
    for(const mode of ['commands','help','--help','-h']){
      const result=run(mode,'--out',missing);
      assert.equal(result.status,1);
      assert.equal(JSON.parse(result.stderr).error.code,'CLI_USAGE');
      assert.equal(result.stdout,'');
      assert.deepEqual(await fs.readdir(directory),['existing.json']);
    }
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('exec dry-run preserves inputs and explicit outputs even with overwrite',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'moment-preview-'));
  try{
    const input=path.join(directory,'project.json'),output=path.join(directory,'captions.srt'),missing=path.join(directory,'missing.json');
    assert.equal(run('init','--out',input).status,0);
    assert.equal(run('init','--out',input,'--overwrite').status,0);
    const original=await fs.readFile(input,'utf8');
    await fs.writeFile(output,'existing captions');
    for(const destination of [input,output,missing]){
      for(const [command,args] of [['project.update',{patch:{name:'Preview only'}}],['captions.export',{}]]){
        const result=run('exec',command,'--project',input,'--json',JSON.stringify(args),'--dry-run','--out',destination,'--overwrite');
        assert.equal(result.status,0,result.stderr);
        const parsed=JSON.parse(result.stdout);
        assert.equal(parsed.ok,true);assert.equal(parsed.output,undefined);
        if(command==='project.update')assert.equal(parsed.preview.project.name,'Preview only');
        else assert.match(parsed.preview.text,/-->/);
        assert.equal(await fs.readFile(input,'utf8'),original);
        assert.equal(await fs.readFile(output,'utf8'),'existing captions');
        assert.deepEqual((await fs.readdir(directory)).sort(),['captions.srt','project.json']);
      }
    }
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('CLI retains help/discovery and rejects malformed option lists',()=>{
  for(const args of [[],['help'],['--help'],['-h'],['commands']])assert.equal(run(...args).status,0);
  for(const args of [
    ['init','--out'],['init','--out','unused','--out','other'],
    ['exec','project.get','--project'],['exec','templates.list','--dry-run','--dry-run'],
    ['exec','templates.list','--json','{}','--args-file','missing'],
    ['exec','templates.list','--unknown'],
  ]){
    const result=run(...args);
    assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).error.code,'CLI_USAGE');
  }
});
