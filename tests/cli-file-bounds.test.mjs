import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createDemoProject, createProjectDocument } from '../dist/core/project.mjs';

const cli = fileURLToPath(new URL('../cli/moment.mjs', import.meta.url));
const limit = 10 * 1024 * 1024;

// Only the task-owned input is observed. Reads and closes remain native; injected
// failures bracket those operations without depending on host filesystem faults.
function observer(target, receipt, mode) {
  return `import fs from 'node:fs';
import promises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
const target=${JSON.stringify(target)},receipt=${JSON.stringify(receipt)},mode=${JSON.stringify(mode)};
const events=[],chunks=new WeakSet(),stat=promises.stat,readFile=promises.readFile,open=fs.createReadStream,concat=Buffer.concat;
let bytes=0,concats=0;
promises.stat=async function(file,...args){
 const info=await Reflect.apply(stat,this,[file,...args]);
 if(file===target){
  events.push({stage:'stat',size:info.size});
  if(['growth','replacement','overflow-close-error'].includes(mode)){
   const replacement=mode==='replacement'?file+'.replacement':file;
   await promises.writeFile(replacement,Buffer.alloc(16*1024*1024,32));
   if(mode==='replacement')await promises.rename(replacement,file);
  }
  if(mode==='removed')await promises.unlink(file);
 }
 return info;
};
// Retain the old read owner as a fail-before byte-count discriminator.
promises.readFile=async function(file,...args){const value=await Reflect.apply(readFile,this,[file,...args]);if(file===target)bytes+=value.length;return value;};
Buffer.concat=function(list,...args){if(list.some(value=>chunks.has(value)))concats++;return Reflect.apply(concat,this,[list,...args]);};
fs.createReadStream=function(file,...args){
 const stream=Reflect.apply(open,this,[file,...args]);
 if(file===target){
  events.push({stage:'stream',end:args[0]?.end});
  if(mode==='read-error')stream.once('open',()=>stream.destroy(Object.assign(new Error('injected read'),{code:'EACCES'})));
  if(mode.endsWith('close-error')){
   const destroy=stream._destroy;
   stream._destroy=function(error,callback){Reflect.apply(destroy,this,[error,()=>callback(Object.assign(new Error('injected close'),{code:'EIO'}))]);};
  }
  const emit=stream.emit;
  stream.emit=function(event,...values){
   if(event==='data'){bytes+=values[0].length;chunks.add(values[0]);}
   if(event==='close')events.push({stage:'closed',fd:stream.fd,destroyed:stream.destroyed});
   return Reflect.apply(emit,this,[event,...values]);
  };
 }
 return stream;
};
syncBuiltinESMExports();
for(const channel of [process.stdout,process.stderr]){const write=channel.write;channel.write=function(...args){events.push({stage:'terminal'});return Reflect.apply(write,this,args);};}
process.on('exit',()=>fs.writeFileSync(receipt,JSON.stringify({bytes,concats,events})));`;
}

test('CLI bounds raced file reads and closes owned streams before reporting without touching output', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'moment-bounded 한글 '));
  try {
    const input = path.join(directory, 'input.json'), project = path.join(directory, 'project.json');
    const output = path.join(directory, 'output.json'), receipt = path.join(directory, 'receipt.json'), loader = path.join(directory, 'observer.mjs');
    const document = JSON.stringify(createProjectDocument(createDemoProject()));
    await fs.writeFile(project, document);
    for (const kind of ['args', 'project']) {
      const original = kind === 'args' ? '{"patch":{"zoom":1.5}}' : document;
      const args = kind === 'args'
        ? ['exec', 'project.update', '--project', project, '--args-file', input]
        : ['exec', 'project.update', '--project', input, '--json', '{"patch":{"zoom":1.5}}'];
      for (const mode of ['growth', 'replacement', 'overflow-close-error', 'huge', 'read-error', 'close-error', 'removed', 'empty', 'utf8', 'json', 'success']) {
        const data = mode === 'huge' ? Buffer.alloc(limit + 1, 32)
          : mode === 'empty' ? '' : mode === 'utf8' ? Buffer.from([0xff]) : mode === 'json' ? '{' : original;
        await fs.writeFile(input, data); await fs.writeFile(output, 'KEEP');
        await fs.writeFile(loader, observer(input, receipt, mode));
        // A successful read may intentionally overwrite that same input path.
        const destination = mode === 'success' ? input : output;
        const run = spawnSync(process.execPath, ['--import', pathToFileURL(loader).href, cli, ...args, '--out', destination, '--overwrite'], {
          encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
        });
        assert.equal(run.error, undefined, `${kind}/${mode}`); assert.equal(run.signal, null);
        const expected = ['growth', 'replacement', 'overflow-close-error', 'huge'].includes(mode) ? 'FILE_TOO_LARGE'
          : ['empty', 'utf8', 'json'].includes(mode) ? 'INVALID_JSON' : 'FILE_ERROR';
        if (mode === 'success') {
          assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(run.stdout).ok, true);
          assert.equal(JSON.parse(await fs.readFile(input, 'utf8')).project.zoom, 1.5);
          assert.equal(await fs.readFile(output, 'utf8'), 'KEEP');
        } else {
          assert.equal(run.status, 1, `${kind}/${mode}`); assert.equal(run.stdout, '');
          assert.equal(JSON.parse(run.stderr).error.code, expected, `${kind}/${mode}`);
          assert.equal(await fs.readFile(output, 'utf8'), 'KEEP');
        }
        const record = JSON.parse(await fs.readFile(receipt, 'utf8'));
        assert.ok(record.bytes <= limit + 1, `read ${record.bytes} bytes beyond the application bound`);
        if (['growth', 'replacement', 'overflow-close-error'].includes(mode)) {
          assert.equal(record.bytes, limit + 1); assert.equal(record.concats, 0, 'overflow must reject before concatenating');
        }
        const terminal = record.events.findIndex(event => event.stage === 'terminal');
        if (mode === 'huge') assert.deepEqual(record.events, [{stage: 'stat', size: limit + 1}, {stage: 'terminal'}]);
        else {
          assert.equal(record.events.find(event => event.stage === 'stream').end, limit);
          const closed = record.events.findIndex(event => event.stage === 'closed');
          assert.ok(closed >= 0 && closed < terminal, `${kind}/${mode}: close before result`);
          assert.deepEqual(record.events[closed], {stage: 'closed', fd: null, destroyed: true});
        }
        if (mode === 'success') assert.equal(record.concats, 1);
        assert.equal(await fs.readFile(project, 'utf8'), document);
        assert.ok((await fs.readdir(directory)).every(name => !name.startsWith('.moment-')));
      }
    }
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
});
