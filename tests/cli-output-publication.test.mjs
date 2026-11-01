import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const cli = fileURLToPath(new URL('../cli/moment.mjs', import.meta.url));
const uuid = '00000000-0000-4000-8000-000000000053';

// Real child-process file publication; only owned temporary cleanup failures
// are injected. This does not reproduce native Windows/antivirus contention.
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'moment-published 한글 '));
  t.after(() => fs.rm(directory, {recursive:true, force:true}));
  const loader = path.join(directory, 'observe.mjs'), receipt = path.join(directory, 'receipt.json');
  const temporary = path.join(directory, `.moment-${uuid}.tmp`);
  await fs.writeFile(loader, `import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const temporary=${JSON.stringify(temporary)}, mode=process.env.MOMENT_CLEANUP_CASE;
const events=[], link=fs.link.bind(fs), rename=fs.rename.bind(fs), unlink=fs.unlink.bind(fs);
let published=false, refusals=0;
crypto.randomUUID=()=>${JSON.stringify(uuid)};syncBuiltinESMExports();
for(const [name, native] of [['link',link],['rename',rename]]) fs[name]=async(...args)=>{
  events.push(name);const result=await native(...args);published=true;events.push('published');return result;
};
fs.unlink=async(...args)=>{
  if(args[0]===temporary){
    events.push('unlink');
    if((published && (mode==='permanent' || mode==='transient' && refusals===0)) || mode==='refused'){
      refusals++;events.push('cleanup-refused');
      throw Object.assign(new Error('injected temporary cleanup refusal'),{code:'EPERM'});
    }
  }
  return unlink(...args);
};
process.on('exit',()=>writeFileSync(${JSON.stringify(receipt)},JSON.stringify({events,published,refusals})));
`);
  const invoke = (args, mode = 'off') => {
    const result = spawnSync(process.execPath, ['--import',pathToFileURL(loader).href,cli,...args], {
      env:{...process.env,MOMENT_CLEANUP_CASE:mode}, encoding:'utf8', timeout:15000, maxBuffer:1024*1024,
    });
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    return result;
  };
  const readReceipt = async () => JSON.parse(await fs.readFile(receipt, 'utf8'));
  const input = path.join(directory, 'input.json');
  const initialized = invoke(['init','--out',input]); assert.equal(initialized.status,0,initialized.stderr);
  const original = await fs.readFile(input);
  return {directory, temporary, input, original, invoke, readReceipt};
}

for (const [label, command, args] of [
  ['new project', null, null],
  ['project edit', 'project.update', {patch:{name:'Saved once 🎬'}}],
  ['project read', 'project.get', {}],
  ['subtitle export', 'captions.export', {format:'vtt'}],
  ['template export', 'template.export', {id:'portable',name:'Portable'}],
]) {
  test(`CLI reports a published ${label} as successful after transient temporary cleanup failure`, async t => {
    const f = await fixture(t), expected = path.join(f.directory,'expected'), output = path.join(f.directory,'output');
    const base = command ? ['exec',command,'--project',f.input,'--json',JSON.stringify(args)] : ['init'];
    const normal = f.invoke([...base,'--out',expected]); assert.equal(normal.status,0,normal.stderr);
    const result = f.invoke([...base,'--out',output], 'transient');
    assert.equal(result.status,0,result.stderr); assert.equal(result.stderr,'');
    const response = JSON.parse(result.stdout); assert.equal(response.ok,true); assert.equal(response.output,output);
    assert.deepEqual(await fs.readFile(output),await fs.readFile(expected));
    assert.deepEqual(await fs.readFile(f.input),f.original);
    assert.deepEqual(await f.readReceipt(), {
      events:['link','published','unlink','cleanup-refused','unlink'],published:true,refusals:1,
    });
    await assert.rejects(fs.stat(f.temporary), {code:'ENOENT'});
    const retry = f.invoke([...base,'--out',output]);
    assert.equal(retry.status,1); assert.equal(JSON.parse(retry.stderr).error.code,'FILE_EXISTS');
    assert.deepEqual(await fs.readFile(output),await fs.readFile(expected),'retry never overwrites published output');
    assert.equal((await f.readReceipt()).published,false);
  });
}

test('permanent post-publication cleanup refusal preserves successful output and only its owned temporary link', async t => {
  const f = await fixture(t), output = path.join(f.directory,'output.json');
  const unrelated = path.join(f.directory,'.moment-unrelated.tmp'); await fs.writeFile(unrelated,'KEEP');
  const result = f.invoke(['init','--out',output], 'permanent');
  assert.equal(result.status,0,result.stderr); assert.equal(result.stderr,'');
  assert.equal(JSON.parse(result.stdout).output,output);
  assert.deepEqual(await fs.readFile(output),f.original);
  assert.deepEqual(await fs.readFile(f.temporary),f.original);
  assert.equal(await fs.readFile(unrelated,'utf8'),'KEEP');
  assert.deepEqual(await f.readReceipt(), {
    events:['link','published','unlink','cleanup-refused','unlink','cleanup-refused'],published:true,refusals:2,
  });
});

test('a failed publication still reports the original failure even if temporary cleanup also fails', async t => {
  const f = await fixture(t), output = path.join(f.directory,'existing.json');
  await fs.writeFile(output,'KEEP');
  const result = f.invoke(['init','--out',output], 'refused');
  assert.equal(result.status,1); assert.equal(result.stdout,'');
  assert.equal(JSON.parse(result.stderr).error.code,'FILE_EXISTS');
  assert.equal(await fs.readFile(output,'utf8'),'KEEP');
  assert.deepEqual(await fs.readFile(f.input),f.original);
  assert.deepEqual(await f.readReceipt(), {events:['link','unlink','cleanup-refused'],published:false,refusals:1});
});

test('overwrite retains its existing successful rename result when final cleanup reports an error', async t => {
  const f = await fixture(t), output = path.join(f.directory,'existing.json');
  await fs.writeFile(output,'KEEP');
  const result = f.invoke(['init','--out',output,'--overwrite'], 'transient');
  assert.equal(result.status,0,result.stderr); assert.equal(result.stderr,'');
  assert.deepEqual(await fs.readFile(output),f.original);
  assert.deepEqual(await f.readReceipt(), {events:['rename','published','unlink','cleanup-refused'],published:true,refusals:1});
  await assert.rejects(fs.stat(f.temporary), {code:'ENOENT'});
});
