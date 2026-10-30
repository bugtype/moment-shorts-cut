import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';

const cli=fileURLToPath(new URL('../cli/moment.mjs',import.meta.url));
const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});

test('CLI owns closed output pipes without claiming an already-saved file was rolled back',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'moment-output-pipe-'));
  async function closed(args,{stdout=true,stderr=false,preload}={}){
    const child=spawn(process.execPath,[...(preload?['--import',pathToFileURL(preload).href]:[]),cli,...args],{stdio:['ignore','pipe','pipe']});
    const result={stdout:'',stderr:'',guard:null};
    const timer=setTimeout(()=>{result.guard='timeout';child.kill();},5000);
    for(const [name,close] of [['stdout',stdout],['stderr',stderr]]){
      if(close)child[name].destroy();
      else child[name].on('data',data=>{
        result[name]+=data;
        if(result[name].length>1024*1024){result.guard='output limit';child.kill();}
      });
    }
    try{
      const [code,signal]=await new Promise((resolve,reject)=>{
        child.once('error',reject);child.once('close',(code,signal)=>resolve([code,signal]));
      });
      assert.equal(result.guard,null);assert.equal(signal,null);assert.equal(code,1);
      return result;
    }finally{clearTimeout(timer);child.kill();}
  }
  try{
    const expected=path.join(directory,'expected.json'),saved=path.join(directory,'saved.json');
    const normal=run('init','--out',expected);
    assert.equal(normal.status,0,normal.stderr);assert.equal(normal.stderr,'');
    const bytes=await fs.readFile(expected);
    for(const args of [['help'],['commands'],['exec','templates.list'],['init','--out',saved]]){
      const result=await closed(args);
      assert.equal(result.stdout,'');
      const diagnostic=JSON.parse(result.stderr);
      assert.equal(diagnostic.ok,false);assert.equal(diagnostic.command,'cli');
      assert.equal(diagnostic.error.code,'FILE_ERROR');
      assert.match(diagnostic.error.message,/표준 출력/);
      assert.match(diagnostic.error.message,/이미 저장되었을 수/);
    }
    assert.deepEqual(await fs.readFile(saved),bytes);
    assert.deepEqual((await fs.readdir(directory)).sort(),['expected.json','saved.json']);
    const noDiagnostics=await closed(['commands','--unknown'],{stdout:false,stderr:true});
    assert.equal(noDiagnostics.stdout,'');assert.equal(noDiagnostics.stderr,'');
    const neither=await closed(['help'],{stdout:true,stderr:true});
    assert.equal(neither.stdout,'');assert.equal(neither.stderr,'');
    const throwing=path.join(directory,'throwing-diagnostic.mjs');
    await fs.writeFile(throwing,"process.stderr.write=()=>{throw new Error('injected diagnostic failure');};");
    const diagnosticFailure=await closed(['help'],{preload:throwing});
    assert.equal(diagnosticFailure.stdout,'');assert.equal(diagnosticFailure.stderr,'');
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

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

test('CLI documents subtitle formats and rejects malformed option lists',()=>{
  const help=run('--help').stdout;
  assert.match(help,/format\(srt\/vtt\/txt\)/);
  assert.match(help,/SRT·WebVTT·TXT/);
  assert.match(help,/기본값은 SRT/);
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

test('CLI cleans up only acquired temporary files, closing them before publication or failure',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'moment-output 한글 '));
  try{
    const loader=path.join(directory,'observe.mjs'),receipt=path.join(directory,'receipt.json');
    const uuid='00000000-0000-4000-8000-000000000042';
    await fs.writeFile(loader,`
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const mode=process.env.MOMENT_OUTPUT_CASE,events=[];
crypto.randomUUID=()=>${JSON.stringify(uuid)};
syncBuiltinESMExports();
const open=fs.open.bind(fs);
fs.open=async(...args)=>{
  events.push('open');
  const handle=await open(...args);
  events.push('acquired');
  const write=handle.writeFile.bind(handle),close=handle.close.bind(handle);
  handle.writeFile=async text=>{
    if(mode.startsWith('write-error')){
      await write('partial output');events.push('partial');
      throw Object.assign(Error('controlled write failure'),{code:'ENOSPC'});
    }
    await write(text);events.push('written');
  };
  handle.close=async()=>{
    await close();events.push('closed');
    if(mode==='write-error-close-error'||mode==='close-error')
      throw Object.assign(Error('controlled close failure'),{code:mode==='close-error'?'EIO':'EEXIST'});
  };
  return handle;
};
for(const method of ['rename','link','unlink']){
  const original=fs[method].bind(fs);
  fs[method]=async(...args)=>{events.push(method);return original(...args);};
}
for(const stream of [process.stdout,process.stderr]){
  const write=stream.write;
  stream.write=function(...args){events.push('terminal');return Reflect.apply(write,this,args);};
}
process.on('exit',()=>writeFileSync(${JSON.stringify(receipt)},JSON.stringify(events)));
`);
    for(const mode of ['collision','collision-overwrite','write-error','write-error-close-error','close-error','overwrite','target-refusal']){
      const output=path.join(directory,'output.json'),temporary=path.join(directory,`.moment-${uuid}.tmp`);
      const collision=mode.startsWith('collision');
      await fs.writeFile(output,'existing authored output');
      if(collision)await fs.writeFile(temporary,'unowned temporary marker');
      const args=['--import',pathToFileURL(loader).href,cli,'init','--out',output];
      if(mode!=='collision'&&mode!=='target-refusal')args.push('--overwrite');
      const result=spawnSync(process.execPath,args,{
        env:{...process.env,MOMENT_OUTPUT_CASE:mode},encoding:'utf8',timeout:5000,maxBuffer:1024*1024,
      });
      assert.equal(result.error,undefined,mode);assert.equal(result.signal,null,mode);
      const events=JSON.parse(await fs.readFile(receipt,'utf8'));
      if(mode==='overwrite'){
        assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
        assert.equal(JSON.parse(await fs.readFile(output,'utf8')).format,'moment-project');
        assert.equal(JSON.parse(result.stdout).ok,true);
        assert.ok(events.indexOf('closed')<events.indexOf('rename'));
      }else{
        assert.equal(result.status,1,mode);assert.equal(result.stdout,'');
        assert.equal(JSON.parse(result.stderr).error.code,mode.startsWith('write-error')||mode==='close-error'?'FILE_ERROR':'FILE_EXISTS',mode);
        assert.equal(await fs.readFile(output,'utf8'),'existing authored output',mode);
      }
      if(collision){
        assert.equal(await fs.readFile(temporary,'utf8'),'unowned temporary marker',mode);
        assert.deepEqual(events,['open','terminal'],mode);
        await fs.unlink(temporary); // Remove only this test's own preserved fixture.
      }else{
        assert.equal(events.filter(event=>event==='closed').length,1,mode);
        assert.ok(events.indexOf('closed')<events.indexOf('unlink'),mode);
        assert.ok(events.indexOf('unlink')<events.indexOf('terminal'),mode);
        if(mode==='target-refusal')assert.ok(events.indexOf('closed')<events.indexOf('link'));
        if(mode.startsWith('write-error')){
          assert.ok(events.includes('partial'),mode);
        }
        if(mode.includes('error'))assert.ok(!events.includes('rename')&&!events.includes('link'),mode);
        assert.equal((await fs.readdir(directory)).includes(path.basename(temporary)),false,mode);
      }
    }
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
