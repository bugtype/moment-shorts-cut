import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import {createEditorService} from '../dist/integration/editor-service.mjs';

const cli = fileURLToPath(new URL('../cli/moment.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], {encoding:'utf8'});
const commands = createEditorService({getProject() { throw Error('Discovery must not read a project'); },
  commitProject() { throw Error('Discovery must not commit'); }}).describe();
const output = list => JSON.stringify({apiVersion:1, commands:list}, null, 2) + '\n';

test('CLI discovery keeps the complete catalog and returns each exact unchanged descriptor', () => {
  const all = run('commands');
  assert.equal(all.status, 0, all.stderr); assert.equal(all.stderr, '');
  assert.equal(all.stdout, output(commands));
  for (const descriptor of commands) {
    const selected = run('commands', descriptor.name);
    assert.equal(selected.status, 0, selected.stderr); assert.equal(selected.stderr, '');
    assert.equal(selected.stdout, output([descriptor]), descriptor.name);
  }
});

test('CLI discovery rejects unknown exact names without guessing or normalizing', () => {
  const existing = JSON.parse(run('exec', 'unknown.command').stderr);
  for (const name of ['', 'unknown.command', 'Captions.update', 'captions', 'captions.*',
    ' captions.update', 'captions.update ', 'captions.update\n', '자막.수정', '字幕.更新',
    'captions.ｕpdate', 'moment_captions_update', 'project.get,captions.update', '__proto__']) {
    const result = run('commands', name);
    assert.equal(result.status, 1, name); assert.equal(result.stdout, '', name);
    assert.deepEqual(JSON.parse(result.stderr), existing, name);
    assert.equal(existing.error.code, 'UNKNOWN_COMMAND');
  }
});

test('CLI discovery retains strict option and extra-argument priority without file effects', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'moment-discovery-'));
  try {
    const existing = path.join(directory, 'existing.json'), missing = path.join(directory, 'missing.json');
    await fs.writeFile(existing, 'authored settings');
    // Parsing rejects these tails before command lookup; avoid crossing every
    // rejected option with every name while retaining each parser/name boundary.
    const tails = [['--help'], ['--out', existing, '--overwrite'], ['--project', missing],
      ['--args-file', '-'], ['--json', '{}'], ['--dry-run'], ['--'], ['-h'],
      ['captions.export', 'project.get']];
    const cases = tails.map(tail => ['captions.update', ...tail]);
    for (const name of [undefined, 'unknown.command', ''])
      cases.push([...(name === undefined ? [] : [name]), '--out', existing, '--overwrite']);
    cases.push(['captions.export', 'project.get'], ['--help']);
    for (const args of cases) {
      const result = run('commands', ...args);
      assert.equal(result.status, 1); assert.equal(result.stdout, '');
      assert.equal(JSON.parse(result.stderr).error.code, 'CLI_USAGE');
    }
    assert.equal(await fs.readFile(existing, 'utf8'), 'authored settings');
    assert.deepEqual(await fs.readdir(directory), ['existing.json']);
  } finally { await fs.rm(directory, {recursive:true, force:true}); }
});

test('top-level CLI help documents selection without changing exec dash-name behavior', () => {
  for (const args of [[], ['help'], ['--help'], ['-h']]) {
    const result = run(...args);
    assert.equal(result.status, 0); assert.equal(result.stderr, '');
    assert.match(result.stdout, /node cli\/moment\.mjs commands \[<command>\]/);
  }
  for (const name of ['--help', '-h', '--unknown']) {
    const result = run('exec', name);
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).error.code, 'UNKNOWN_COMMAND');
  }
});

test('exact discovery exits without reading stdin or needing a project file', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'moment-discovery-stdin-'));
  const child = spawn(process.execPath, [cli, 'commands', 'captions.update'], {
    cwd:directory, stdio:['pipe', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const timer = setTimeout(() => child.kill(), 5000);
  try {
    // Deliberately keep stdin open and empty: discovery must not wait for EOF.
    const status = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve);
    });
    assert.equal(status, 0, stderr); assert.equal(stderr, '');
    assert.equal(stdout, output(commands.filter(command => command.name === 'captions.update')));
    assert.deepEqual(await fs.readdir(directory), []);
  } finally { clearTimeout(timer); child.stdin.destroy(); child.kill(); await fs.rm(directory, {recursive:true, force:true}); }
});
