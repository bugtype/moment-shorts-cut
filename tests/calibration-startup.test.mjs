import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

// No FFmpeg process or calibration media: stop during the version-probe phase.
const childFixture = `
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const mode=process.env.MOMENT_CALIBRATION_CASE,root=path.dirname(fileURLToPath(import.meta.url));
const receipt={spawned:0,closed:0,killed:0,timers:0,cleared:0},pending=new Set();
const set=globalThis.setTimeout,clear=globalThis.clearTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{
 if(delay!==120000)return set(callback,delay,...args);
 receipt.timers++;const timer=set(()=>{pending.delete(timer);callback(...args);},mode==='timeout'?5:delay);pending.add(timer);return timer;
};
globalThis.clearTimeout=timer=>{if(pending.delete(timer)||mode==='timeout')receipt.cleared++;return clear(timer);};
cp.spawn=(command,args,options)=>{
 const expected=receipt.spawned===0?'ffmpeg':'ffprobe';
 if(command!==expected||JSON.stringify(args)!=='["-version"]'||options.shell!==false||receipt.spawned>=(mode==='success-first'?2:1))throw Error('Unexpected media command');
 receipt.spawned++;
 const child=new EventEmitter();child.stdin=null;
 child.stdout=mode==='missing-both'?undefined:new PassThrough();
 child.stderr=mode==='missing-both'?undefined:mode==='missing-stderr'?null:new PassThrough();
 let closed=false;
 const finish=(code,signal)=>{if(closed)return;closed=true;child.stdout?.end();child.stderr?.end();receipt.closed++;child.emit('close',code,signal);};
 child.kill=()=>{receipt.killed++;if(mode==='reentrant-error'&&receipt.killed<3)child.emit('error',Error('controlled kill error'));if(mode.startsWith('missing')||closed)return false;setImmediate(()=>finish(null,'SIGKILL'));return true;};
 if(mode==='setup-throw'){
  const on=child.stdout.on.bind(child.stdout);
  child.stdout.on=(event,...rest)=>{if(event==='data')throw Error('controlled stream setup');return on(event,...rest);};
 }
 setImmediate(()=>{
  if(mode.startsWith('missing')){child.emit('error',Error('controlled EMFILE'));finish(-24,null);}
  else if(mode==='close-error'){finish(0,null);child.emit('error',Error('controlled error after close'));}
  else if(mode==='spawn-error'||mode==='reentrant-error')child.emit('error',Error('controlled launch error'));
  else if(mode==='repeated-error'){child.emit('error',Error('controlled first error'));child.emit('error',Error('controlled secondary error'));}
  else if(mode==='nonzero'){child.stdout.write('partial output');child.stderr.write('partial diagnostic');finish(7,null);}
  else if(mode==='stdout-limit')child.stdout.write(Buffer.alloc(8388609));
  else if(mode==='stderr-limit')child.stderr.write(Buffer.alloc(4194305));
  else if(mode==='success-first'){
   if(command==='ffmpeg'){child.stdout.write('ffmpeg synthetic\\n');finish(0,null);}
   else child.emit('error',Error('stop before media generation'));
  }
 });
 return child;
};
syncBuiltinESMExports();
process.on('exit',()=>fs.writeFileSync(path.join(root,mode+'-receipt.json'),JSON.stringify({...receipt,pendingTimers:pending.size})));
`;

test('calibration CLI preserves startup errors, terminal logs and child cleanup without running media tools', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moment calibration-한글-'));
  try {
    await mkdir(path.join(root, 'qa'));
    for (const file of ['export-calibration.mjs', 'export-markers.mjs'])
      await cp(new URL('../qa/' + file, import.meta.url), path.join(root, 'qa', file));
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    const loader = path.join(root, 'failed-child.mjs');
    await writeFile(loader, childFixture);
    const cases = [
      ['missing-both', 'controlled EMFILE'], ['missing-stderr', 'controlled EMFILE'],
      ['setup-throw', 'controlled stream setup'], ['close-error', 'controlled error after close'],
      ['repeated-error', 'controlled first error'], ['spawn-error', 'controlled launch error'],
      ['reentrant-error', 'controlled launch error'], ['nonzero', 'ffmpeg-version: exit 7'],
      ['stdout-limit', 'ffmpeg-version: stdout exceeded 8388608 bytes'],
      ['stderr-limit', 'ffmpeg-version: stderr exceeded 4194304 bytes'],
      ['timeout', 'ffmpeg-version: timeout after 120000 ms'],
      ['success-first', 'stop before media generation'],
    ];
    for (const [mode, error] of cases) {
      const output = path.join(root, 'out-' + mode);
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(loader).href,
        path.join(root, 'qa', 'export-calibration.mjs'), output], {
        cwd:tmpdir(), env:{...process.env, MOMENT_CALIBRATION_CASE:mode}, encoding:'utf8', timeout:5000, maxBuffer:1024 * 1024,
      });
      assert.equal(result.status, 1, mode + ': ' + result.stderr);
      assert.equal(result.signal, null, mode);
      assert.equal(result.stdout, '', mode);
      assert.equal(result.stderr, error + '\n', mode);
      const failure = JSON.parse(await readFile(path.join(output, 'failure.json'), 'utf8'));
      assert.deepEqual(failure, {error, suppressed:[]}, mode);
      const commands = JSON.parse(await readFile(path.join(output, 'commands.json'), 'utf8'));
      assert.equal(commands.length, mode === 'success-first' ? 2 : 1, mode);
      assert.equal(commands.at(-1).error, error, mode);
      assert.ok(Object.hasOwn(commands.at(-1), 'exit_code') && Object.hasOwn(commands.at(-1), 'signal'), mode);
      const receipt = JSON.parse(await readFile(path.join(root, mode + '-receipt.json'), 'utf8'));
      assert.equal(receipt.spawned, commands.length, mode);
      assert.equal(receipt.closed, commands.length, mode);
      assert.equal(receipt.pendingTimers, 0, mode);
      assert.equal(receipt.timers, commands.length, mode);
      assert.equal(receipt.cleared, commands.length, mode);
      assert.equal(receipt.killed, mode === 'nonzero' ? 0 : 1, mode);
      for (const command of commands) {
        assert.equal(command.shell, false);
        assert.equal(command.timeout_ms, 120000);
        assert.equal(command.stdout_limit_bytes, 8388608);
        assert.equal(command.stderr_limit_bytes, 4194304);
        assert.deepEqual(command.argv, [command.name === 'ffmpeg-version' ? 'ffmpeg' : 'ffprobe', '-version']);
        await readFile(path.join(output, command.name + '.stdout.log'));
        await readFile(path.join(output, command.name + '.stderr.log'));
      }
      if (mode === 'nonzero') {
        assert.equal(commands[0].exit_code, 7);
        assert.equal(await readFile(path.join(output, 'ffmpeg-version.stdout.log'), 'utf8'), 'partial output');
        assert.equal(await readFile(path.join(output, 'ffmpeg-version.stderr.log'), 'utf8'), 'partial diagnostic');
      }
      if (mode === 'success-first') {
        assert.equal(commands[0].exit_code, 0); assert.equal(commands[0].error, null);
        assert.equal(await readFile(path.join(output, 'ffmpeg-version.stdout.log'), 'utf8'), 'ffmpeg synthetic\n');
      }
      assert.ok((await readdir(output)).every(file => file.endsWith('.json') || file.endsWith('.log')), mode);
    }
    const existing = path.join(root, 'out-missing-both');
    const before = await readFile(path.join(existing, 'commands.json'));
    const refused = spawnSync(process.execPath, ['--import', pathToFileURL(loader).href,
      path.join(root, 'qa', 'export-calibration.mjs'), existing], {
      cwd:tmpdir(), env:{...process.env, MOMENT_CALIBRATION_CASE:'existing-output'}, encoding:'utf8', timeout:5000,
    });
    assert.equal(refused.status, 1); assert.equal(refused.signal, null);
    assert.equal(refused.stdout, ''); assert.match(refused.stderr, /^EEXIST:/);
    assert.deepEqual(await readFile(path.join(existing, 'commands.json')), before);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'existing-output-receipt.json'), 'utf8')),
      {spawned:0, closed:0, killed:0, timers:0, cleared:0, pendingTimers:0});
  } finally { await rm(root, {recursive:true, force:true}); }
});
