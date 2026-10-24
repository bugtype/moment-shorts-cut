import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { splitLongCaptions } from '../dist/core/caption-split-long.mjs';
import { splitCaptionText } from '../dist/effects.mjs';
import { prepareCommand } from '../dist/core/commands.mjs';
import { createDemoProject, createProjectDocument } from '../dist/core/project.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';

const phrase = 'This is a useful longer sentence for a short video.';
const cue = (text = phrase) => ({start: 0, end: 2, text});

test('bulk command exactly matches existing UI helper for all three lengths', () => {
  for (const limit of [12, 18, 24]) {
    const p = createDemoProject();
    p.captions = [cue(), cue('  Hello world from a longer text   '), cue('👩🏽‍💻 e\u0301 가나다 한글 👨‍👩‍👧‍👦 '.repeat(8))];
    p.captions[1].basis = 'timeline';
    p.captions[1].start = 20;
    p.captions[1].end = 22;
    Object.assign(p.captions[2], {speaker: '0', keywords: 'literal', timing: 'estimated'});
    const before = structuredClone(p);
    const expected = p.captions.flatMap(c => splitCaptionText(c, limit));
    const result = prepareCommand(p, 'captions.split.long', {limit});
    assert.deepEqual(result.project.captions, expected);
    assert.equal(result.data.changedCaptions, 3);
    assert.equal(result.data.addedCaptions, expected.length - 3);
    assert.equal(result.data.outputDuration, 12);
    assert.deepEqual(p, before);
  }
});

test('original authored range preserves outside references and metadata with tail/prefix defaults', () => {
  const captions = [cue(), cue(), cue(), cue()];
  const result = splitLongCaptions(captions, {captionIndex: 1, count: 2});
  assert.equal(result.changedCaptions, 2);
  assert.equal(result.captions[0], captions[0]);
  assert.equal(result.captions.at(-1), captions[3]);
  assert.equal(splitLongCaptions(captions, {captionIndex: 2}).changedCaptions, 2);
  assert.equal(splitLongCaptions(captions, {count: 1}).changedCaptions, 1);
  assert.deepEqual(splitLongCaptions(captions), splitLongCaptions(captions, {limit: 18}));
  const short = [cue('short'), cue('')];
  assert.equal(splitLongCaptions(short).captions, short);
  assert.equal(splitLongCaptions([]).changedCaptions, 0);
  const p = createDemoProject();
  p.captions = short;
  assert.equal('project' in prepareCommand(p, 'captions.split.long', {}), false);
});

test('explicit bounds validate before no-op and reject types without silent truncation', () => {
  for (const limit of [undefined, null, 0, 13, '18', 18.5]) {
    assert.throws(() => splitLongCaptions([cue('short')], {limit}), error => error.path === 'arguments.limit');
  }
  for (const captionIndex of [undefined, null, -1, 1, .5, '0', 10000]) {
    assert.throws(() => splitLongCaptions([cue('short')], {captionIndex}), error => error.path === 'arguments.captionIndex');
  }
  for (const count of [undefined, null, 0, 2, .5, '1', 10001]) {
    assert.throws(() => splitLongCaptions([cue('short')], {count}), error => error.path === 'arguments.count');
  }
  assert.throws(() => splitLongCaptions([], {captionIndex: 0}));
  assert.throws(() => splitLongCaptions([], {count: 1}));
});

test('result cap and exhausted float precision reject atomically', () => {
  const p = createDemoProject();
  p.captions = Array.from({length: 10000}, () => cue('short'));
  assert.equal(prepareCommand(p, 'captions.split.long', {}).data.updated, false);
  p.captions[9999] = cue();
  const before = structuredClone(p);
  assert.throws(() => prepareCommand(p, 'captions.split.long', {captionIndex: 9999}),
    error => error.path === 'project.captions');
  assert.deepEqual(p, before);
  p.captions = [{start: 1, end: 1 + Number.EPSILON, text: phrase}];
  assert.throws(() => prepareCommand(p, 'captions.split.long', {}),
    error => error.path === 'project.captions[0]' && error.code === 'INVALID_ARGUMENT');
});

test('exact cap succeeds and unselected tiny intervals stay untouched at every speed', () => {
  const p = createDemoProject();
  p.captions = Array.from({length: 9998}, () => cue('short'));
  p.captions[49] = cue();
  const result = prepareCommand(p, 'captions.split.long', {captionIndex: 49, count: 1});
  assert.equal(result.project.captions.length, 10000);
  assert.equal(result.data.addedCaptions, 2);
  for (const speed of [.25, 1, 2, 4]) {
    p.speed = speed;
    p.clips = [{start: 0, end: 2}, {start: 0, end: 2}];
    p.captions = [cue(), {start: 1, end: 1 + Number.EPSILON, text: phrase}];
    const split = prepareCommand(p, 'captions.split.long', {count: 1});
    assert.deepEqual(split.project.captions.at(-1), p.captions[1]);
    assert.deepEqual(split.project.clips, p.clips);
    assert.equal(split.project.audioOffset, p.audioOffset);
    assert.deepEqual(split.project.design, p.design);
    assert.equal(split.data.outputDuration, 4 / speed);
  }
});

test('service preview and batch use the new mutation atomically with no-op write avoidance', async () => {
  let p = createDemoProject();
  p.captions = [cue(), cue()];
  let writes = 0;
  const service = createEditorService({getProject: () => p, commitProject: next => {p = next; writes++;}});
  const operation = {command: 'captions.split.long', arguments: {}};
  const preview = await service.execute('project.preview', {operations: [operation]});
  assert.equal(preview.data.after.captionCount, 6);
  assert.equal(writes, 0);
  const failed = await service.execute('project.batch', {operations: [operation,
    {command: 'captions.remove', arguments: {captionIndex: 999}}]});
  assert.equal(failed.ok, false);
  assert.equal(writes, 0);
  const success = await service.execute('captions.split.long', {});
  assert.equal(success.data.changedCaptions, 2);
  assert.equal(writes, 1);
  assert.equal((await service.execute('captions.split.long', {})).data.updated, false);
  assert.equal(writes, 1);
});

test('missing Intl Segmenter retains existing safe-split rejection', () => {
  const moduleUrl = new URL('../dist/core/caption-split-long.mjs', import.meta.url).href;
  const script = `Intl.Segmenter = undefined; const {splitLongCaptions}=await import(${JSON.stringify(moduleUrl)}); try {splitLongCaptions([{start:0,end:2,text:'${phrase}'}]);process.exit(1);}catch(e){if(e.code!=='INVALID_ARGUMENT'||e.messageKey!=='errors.safeSplit')throw e;}`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

test('CLI dry-run/save splits once and invalid range preserves existing output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moment-long-split-'));
  try {
    const p = createDemoProject();
    p.captions = [cue()];
    const input = join(dir, 'project.json'), output = join(dir, 'output.json');
    await writeFile(input, JSON.stringify(createProjectDocument(p)));
    const cli = fileURLToPath(new URL('../cli/moment.mjs', import.meta.url));
    const run = (args, flags) => spawnSync(process.execPath, [cli, 'exec', 'captions.split.long',
      '--project', input, '--json', JSON.stringify(args), ...flags], {encoding: 'utf8'});
    const preview = run({}, ['--dry-run']);
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).preview.project.captions.length, 3);
    assert.equal(run({}, ['--out', output]).status, 0);
    const saved = await readFile(output, 'utf8');
    assert.equal(run({count: 2}, ['--out', output, '--overwrite']).status, 1);
    assert.equal(await readFile(output, 'utf8'), saved);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
