import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareCommand, commandDefinition } from '../dist/core/commands.mjs';
import { createDemoProject, createProjectDocument, projectSubtitles } from '../dist/core/project.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';

function project() {
  const p = createDemoProject();
  p.clips = [{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 4, end: 5 }];
  p.captions = [{ start: 0, end: 1, text: 'A', keywords: 'A', speaker: '0' }];
  return p;
}

const operation = args => ({ command: 'timeline.duplicate', arguments: args });

test('contiguous block copies once after itself and matches one replacement exactly', () => {
  for (const [clipIndex, count] of [[0, 3], [0, 2], [1, 2], [1, 1], [2, 1]]) {
    const p = project();
    p.speed = 2;
    p.audioOffset = 0.125;
    p.captions.push({ start: 8, end: 9, text: 'absolute', basis: 'timeline' });
    const before = structuredClone(p);
    const clips = structuredClone(p.clips);
    clips.splice(clipIndex + count, 0, ...structuredClone(clips.slice(clipIndex, clipIndex + count)));
    const actual = prepareCommand(p, 'timeline.duplicate', { clipIndex, count });
    assert.deepEqual(actual, prepareCommand(p, 'timeline.replace', { clips }));
    assert.deepEqual(actual.project.captions, p.captions);
    assert.equal(actual.project.audioOffset, p.audioOffset);
    assert.notEqual(actual.project.clips[clipIndex], actual.project.clips[clipIndex + count]);
    actual.project.clips[clipIndex + count].start = 99;
    assert.deepEqual(p, before);
  }
  const p = project();
  const result = prepareCommand(p, 'timeline.duplicate', { clipIndex: 0, count: 3 });
  assert.deepEqual(result.project.clips.map(clip => clip.start), [0, 2, 4, 0, 2, 4]);
  assert.equal(projectSubtitles(result.project, { format: 'txt' }), 'A\n\nA\n');
});

test('fractional repeated ranges retain order and exact single-pass output-layer arithmetic', () => {
  const p = project();
  p.speed = 1.3;
  p.clips = [{ start: 2.125, end: 3.456 }, { start: 0.15, end: 1.35 }, { start: 2.125, end: 3.456 }];
  p.design.title.start = 0.23456789;
  p.design.title.end = 1.987654321;
  p.design.credit.start = 0.1234567;
  p.design.credit.end = null;
  const clips = structuredClone(p.clips);
  clips.splice(3, 0, ...structuredClone(clips.slice(1, 3)));
  assert.deepEqual(prepareCommand(p, 'timeline.duplicate', { clipIndex: 1, count: 2 }),
    prepareCommand(p, 'timeline.replace', { clips }));
});

test('explicit count validates type and whole range; omitted count retains default', () => {
  const p = project();
  const before = structuredClone(p);
  assert.deepEqual(prepareCommand(p, 'timeline.duplicate', { clipIndex: 1 }),
    prepareCommand(p, 'timeline.duplicate', { clipIndex: 1, count: 1 }));
  for (const count of [undefined, null, 0, -1, 1.5, '2', true, 1001, NaN, Infinity, 4]) {
    assert.throws(() => prepareCommand(p, 'timeline.duplicate', { clipIndex: 0, count }),
      error => error.code === 'INVALID_ARGUMENT');
  }
  assert.throws(() => prepareCommand(p, 'timeline.duplicate', { clipIndex: 2, count: 2 }),
    error => error.path === 'arguments.count');
  assert.deepEqual(p, before);
  p.clips = Array.from({ length: 997 }, () => ({ start: 0, end: 1 }));
  assert.equal(prepareCommand(p, 'timeline.duplicate', { clipIndex: 994, count: 3 }).project.clips.length, 1000);
  assert.throws(() => prepareCommand(p, 'timeline.duplicate', { clipIndex: 0, count: 4 }),
    error => error.path === 'project.clips');
});

test('batch and preview use current indices, one commit and atomic overflow rejection', async () => {
  let p = project();
  let commits = 0;
  const service = createEditorService({
    getProject: () => p,
    commitProject: next => { p = next; commits++; },
  });
  const operations = [operation({ clipIndex: 0, count: 3 })];
  const preview = await service.execute('project.preview', { operations });
  assert.equal(preview.data.after.clipCount, 6);
  assert.equal(commits, 0);
  const result = await service.execute('project.batch', { operations });
  assert.equal(result.ok, true);
  assert.equal(commits, 1);
  const before = structuredClone(p);
  const failed = await service.execute('project.batch', {
    operations: [operation({ clipIndex: 0, count: 2 }), operation({ clipIndex: 7, count: 2 })],
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.path, 'arguments.operations[1].arguments.count');
  assert.equal(commits, 1);
  assert.deepEqual(p, before);
  const schema = commandDefinition('timeline.duplicate').inputSchema;
  assert.deepEqual(schema.required, ['clipIndex']);
  assert.deepEqual(schema.properties.count, { type: 'integer', minimum: 1, maximum: 1000 });
});

test('CLI block duplicate previews and writes, invalid range preserves existing output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moment-block-copy-'));
  try {
    const input = join(dir, 'input.json');
    const output = join(dir, 'output.json');
    await writeFile(input, JSON.stringify(createProjectDocument(project())));
    const cli = fileURLToPath(new URL('../cli/moment.mjs', import.meta.url));
    const run = (count, flags) => spawnSync(process.execPath, [cli, 'exec', 'timeline.duplicate',
      '--project', input, '--json', JSON.stringify({ clipIndex: 0, count }), ...flags], { encoding: 'utf8' });
    const preview = run(3, ['--dry-run']);
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).preview.project.clips.length, 6);
    assert.equal(run(3, ['--out', output]).status, 0);
    const saved = await readFile(output, 'utf8');
    assert.equal(run(4, ['--out', output, '--overwrite']).status, 1);
    assert.equal(await readFile(output, 'utf8'), saved);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
