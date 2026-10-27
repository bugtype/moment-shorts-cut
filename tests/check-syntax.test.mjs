import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'moment syntax-한글-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  for (const directory of ['dist', 'cli', 'examples', 'qa', 'scripts']) await mkdir(path.join(root, directory));
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(root, 'verify.mjs'), 'export {};');
  const script = path.join(root, 'scripts', 'check-syntax.mjs');
  await cp(new URL('../scripts/check-syntax.mjs', import.meta.url), script);
  const put = async (file, source) => {
    await mkdir(path.dirname(path.join(root, file)), {recursive:true});
    await writeFile(path.join(root, file), source);
  };
  const run = (...options) => spawnSync(process.execPath, [...options, script], {
    cwd:tmpdir(), encoding:'utf8', timeout:15000, maxBuffer:1024 * 1024,
  });
  return {root, script, put, run};
}

test('fixed-root syntax discovery parses new sources without executing or resolving imports', async t => {
  const f = await fixture(t);
  await f.put('dist/nested/새 파일.js', "import fs from 'node:fs';fs.writeFileSync('EXECUTED', 'bad');throw Error('executed');");
  await f.put('cli/unresolved.mjs', "import absent from 'https://example.invalid/not-loaded.mjs';export {absent};");
  await f.put('qa/generated.png', 'not valid JavaScript [');
  await f.put('dist/node_modules/vendor/broken.mjs', 'export {');
  await f.put('dist/.git/broken.js', 'export {');
  await f.put('outside/broken.mjs', 'export {');
  await symlink(path.join(f.root, 'outside'), path.join(f.root, 'dist', 'linked'), 'junction');
  let result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Syntax checked 4 files.\n');
  assert.equal(result.stderr, '');
  await assert.rejects(readFile(path.join(f.root, 'EXECUTED')), {code:'ENOENT'});
  await rename(path.join(f.root, 'dist/nested/새 파일.js'), path.join(f.root, 'dist/nested/renamed.mjs'));
  result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Syntax checked 4 files.\n');
  await rm(path.join(f.root, 'dist/nested/renamed.mjs'));
  assert.equal(f.run().stdout, 'Syntax checked 3 files.\n');
});

test('raw module declarations and nested authored files fail with sorted native diagnostics', async t => {
  const f = await fixture(t);
  await f.put('qa/z.mjs', 'export { broken; };');
  await f.put('dist/fixtures/new-owner.mjs', "import { missing, , } from './absent.mjs';\nexport function owner() {}");
  await f.put('cli/a.js', 'export const = 1;');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /SyntaxError/);
  const headers = [...result.stderr.matchAll(/^\[([^\]]+)\]$/gm)].map(match => match[1]);
  assert.deepEqual(headers, ['cli/a.js', 'dist/fixtures/new-owner.mjs', 'qa/z.mjs']);
  assert.match(result.stderr, /Syntax check failed for 3 of 5 files\./);
});

test('missing, wrong-type and linked required roots cannot report a partial success', async t => {
  const f = await fixture(t);
  await rm(path.join(f.root, 'qa'), {recursive:true});
  let result = f.run();
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /ENOENT/);
  await mkdir(path.join(f.root, 'qa'));
  await rm(path.join(f.root, 'verify.mjs')); await mkdir(path.join(f.root, 'verify.mjs'));
  result = f.run();
  assert.equal(result.status, 1); assert.match(result.stderr, /verify\.mjs must be a regular file/);
  await rm(path.join(f.root, 'verify.mjs'), {recursive:true}); await f.put('verify.mjs', 'export {};');
  await rm(path.join(f.root, 'dist'), {recursive:true});
  await mkdir(path.join(f.root, 'outside'));
  await symlink(path.join(f.root, 'outside'), path.join(f.root, 'dist'), 'junction');
  result = f.run();
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.match(result.stderr, /dist must be a regular directory, not a symlink/);
});

test('four-child admission waits for close and reports spawn, signal and syntax failures in path order', async t => {
  const f = await fixture(t);
  for (const file of ['cli/a-error.mjs', 'dist/b-signal.mjs', 'examples/z-invalid.mjs', 'qa/throw.mjs']) await f.put(file, 'export {};');
  const loader = path.join(f.root, 'subprocess-receipts.mjs');
  await writeFile(loader, `
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)), events=[];
let active=0, maximum=0, admitted=0, closed=0;
const write=process.stderr.write.bind(process.stderr);
process.stderr.write=(chunk,...args)=>{if(String(chunk).startsWith('['))events.push(['diagnostic',active]);return write(chunk,...args);};
cp.spawn=(executable,args,options)=>{
  if(executable!==process.execPath||args[0]!=='--check'||path.resolve(options.cwd)!==root||args.length!==2)throw Error('Unexpected child contract');
  const file=path.relative(root,args[1]).split(path.sep).join('/');events.push(['attempt',file]);
  if(file==='qa/throw.mjs')throw Error('controlled spawn throw');
  const child=new EventEmitter();child.stderr=file==='cli/a-error.mjs'?null:new PassThrough();active++;admitted++;maximum=Math.max(maximum,active);
  const delay=file==='cli/a-error.mjs'?40:file==='dist/b-signal.mjs'?5:15;
  setTimeout(()=>{
    if(file==='cli/a-error.mjs')child.emit('error',Error('controlled async spawn error'));
    if(file==='examples/z-invalid.mjs')child.stderr.write('controlled syntax diagnostic\\n');
    setTimeout(()=>{child.stderr?.end();active--;closed++;events.push(['close',file]);
      child.emit('close',file==='examples/z-invalid.mjs'?1:file==='dist/b-signal.mjs'?null:0,file==='dist/b-signal.mjs'?'SIGTERM':null);
    },5);
  },delay);
  return child;
};
syncBuiltinESMExports();
process.on('exit',()=>fs.writeFileSync(path.join(root,'receipts.json'),JSON.stringify({events,active,maximum,admitted,closed})));
`);
  const result = f.run('--import', pathToFileURL(loader).href);
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.deepEqual([...result.stderr.matchAll(/^\[([^\]]+)\]$/gm)].map(match => match[1]),
    ['cli/a-error.mjs', 'dist/b-signal.mjs', 'examples/z-invalid.mjs', 'qa/throw.mjs']);
  for (const diagnostic of ['controlled async spawn error', 'SIGTERM', 'controlled syntax diagnostic', 'controlled spawn throw']) assert.ok(result.stderr.includes(diagnostic));
  const receipts = JSON.parse(await readFile(path.join(f.root, 'receipts.json'), 'utf8'));
  assert.equal(receipts.maximum, 4);
  assert.equal(receipts.active, 0);
  assert.equal(receipts.admitted, 5); assert.equal(receipts.closed, 5);
  assert.equal(receipts.events.find(event => event[0] === 'close')[1], 'dist/b-signal.mjs');
  assert.ok(receipts.events.filter(event => event[0] === 'diagnostic').every(event => event[1] === 0));
});
