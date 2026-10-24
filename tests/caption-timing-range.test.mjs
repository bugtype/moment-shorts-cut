import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shiftCaptionTiming } from '../dist/core/caption-timing.mjs';
import { prepareCommand } from '../dist/core/commands.mjs';
import { createDemoProject, createProjectDocument } from '../dist/core/project.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';

function fixture() {
  const p = createDemoProject();
  p.speed = 2;
  p.clips = [{ start: 0, end: 6 }, { start: 0, end: 6 }];
  p.captions = Array.from({ length: 4 }, (_, i) => ({
    start: i + 1,
    end: i + 2,
    text: `row${i}`,
    speaker: '0',
    keywords: 'key',
    timing: 'estimated',
    ...(i === 1 ? { basis: 'timeline' } : {}),
  }));
  return p;
}

const shift = (p, range = {}, delta = .5, basis = 'source') =>
  prepareCommand(p, 'captions.timing.shift', { basis, delta, ...range });

test('optional row ranges intersect basis after selection and preserve every unrelated value', () => {
  const p = fixture();
  const before = structuredClone(p);
  const cases = [
    [{}, [0, 2, 3]],
    [{ captionIndex: 2 }, [2, 3]],
    [{ count: 2 }, [0]],
    [{ captionIndex: 1, count: 2 }, [2]],
  ];
  for (const [range, changed] of cases) {
    const r = shift(p, range);
    assert.equal(r.data.shiftedCaptions, changed.length);
    const expected = structuredClone(before);
    for (const i of changed) {
      expected.captions[i].start += .5;
      expected.captions[i].end += .5;
    }
    assert.deepEqual(r.project, expected);
    assert.deepEqual(p, before);
    r.project.captions[0].text = 'detached';
    assert.deepEqual(p, before);
  }
  assert.equal(
    shift(p, { captionIndex: 1, count: 1 }, .5, 'timeline').project.captions[1].start,
    2.5,
  );
});

test('range validation precedes zero/no-match and rejects null, undefined, fractions and overflow atomically', () => {
  const p = fixture();
  const before = structuredClone(p);
  const invalidRanges = [
    { captionIndex: -1 },
    { captionIndex: 4 },
    { captionIndex: 10000 },
    { captionIndex: .5 },
    { captionIndex: null },
    { captionIndex: undefined },
    { count: 0 },
    { count: 5 },
    { count: 10001 },
    { count: .5 },
    { count: null },
    { count: undefined },
    { captionIndex: 3, count: 2 },
  ];
  for (const range of invalidRanges) {
    for (const delta of [0, .5]) {
      assert.throws(() => shift(p, range, delta), e => e.code === 'INVALID_ARGUMENT');
      assert.throws(
        () => shiftCaptionTiming(p.captions, { basis: 'source', delta, ...range }, 12),
        e => e.code === 'INVALID_ARGUMENT',
      );
    }
    assert.deepEqual(p, before);
  }
  const empty = { ...p, captions: [] };
  assert.equal(shift(empty).project, undefined);
  for (const range of [{ captionIndex: 0 }, { count: 1 }, { captionIndex: 0, count: 1 }]) {
    assert.throws(() => shift(empty, range, 0));
  }
  const noops = [
    [{ captionIndex: 1, count: 1 }, .5],
    [{ captionIndex: 2 }, 0],
    [{ captionIndex: 2, count: 1 }, Number.MIN_VALUE],
  ];
  for (const [range, delta] of noops) {
    const r = shift(p, range, delta);
    assert.equal(r.project, undefined);
    assert.equal(r.data.updated, false);
    assert.equal(r.data.shiftedCaptions, 0);
  }
});

test('global error indices, boundary roundoff and 10000-row limits remain exact', () => {
  const p = fixture();
  p.captions[3].end = 12;
  const before = structuredClone(p);
  assert.throws(
    () => shift(p, { captionIndex: 2, count: 2 }),
    e => e.path === 'project.captions[3]',
  );
  assert.deepEqual(p, before);
  p.captions = [
    { start: 0, end: .1, text: 'first' },
    { start: 0, end: .1, text: 'selected' },
  ];
  p.duration = .3;
  p.clips = [{ start: 0, end: .3 }];
  const r = shift(p, { captionIndex: 1, count: 1 }, .2);
  assert.equal(r.project.captions[1].end, .3);
  assert.equal(r.project.captions[0].end, .1);
  p.captions = Array.from({ length: 10000 }, () => ({ start: 0, end: .1, text: 'cue' }));
  assert.equal(shift(p, { count: 10000 }, .1).data.shiftedCaptions, 10000);
  assert.equal(shift(p, { captionIndex: 9999 }, .1).data.shiftedCaptions, 1);
  assert.throws(() => shift(p, { captionIndex: 9999, count: 2 }, 0));
});

test('service range edits commit once; sequential batch indices and preview remain atomic', async () => {
  let p = fixture();
  let commits = 0;
  const service = createEditorService({
    getProject: () => p,
    commitProject: next => {
      p = next;
      commits++;
    },
  });
  const before = structuredClone(p);
  const ops = [
    { command: 'captions.remove', arguments: { captionIndex: 0 } },
    {
      command: 'captions.timing.shift',
      arguments: { basis: 'source', delta: .5, captionIndex: 1, count: 1 },
    },
  ];
  const preview = await service.execute('project.preview', { operations: ops });
  assert.equal(preview.ok, true);
  assert.equal(commits, 0);
  assert.deepEqual(p, before);
  const result = await service.execute('project.batch', { operations: ops });
  assert.equal(result.ok, true);
  assert.equal(commits, 1);
  assert.equal(p.captions[1].text, 'row2');
  assert.equal(p.captions[1].start, 3.5);
  const after = structuredClone(p);
  const invalid = await service.execute('project.batch', {
    operations: [
      ops[0],
      {
        command: 'captions.timing.shift',
        arguments: { basis: 'source', delta: 0, captionIndex: 2, count: 1 },
      },
    ],
  });
  assert.equal(invalid.ok, false);
  assert.equal(commits, 1);
  assert.deepEqual(p, after);
  assert.equal(
    (await service.execute('captions.timing.shift', { basis: 'source', delta: 0, count: 2 })).data.updated,
    false,
  );
  assert.equal(commits, 1);
});

test('MCP advertises optional range without changing tool count or acknowledgement and permits retry', async () => {
  let p = fixture();
  const service = createEditorService({
    getProject: () => p,
    commitProject: next => { p = next; },
  });
  const adapter = createMcpToolAdapter({ resolveService: () => service });
  const tools = adapter.listTools().tools;
  assert.equal(tools.length, 39);
  const tool = tools.find(t => t.name === 'moment_captions_timing_shift');
  assert.equal(tool.inputSchema.properties.captionIndex.type, 'integer');
  assert.equal(tool.inputSchema.properties.count.maximum, 10000);
  assert.ok(!tool.inputSchema.required.includes('count'));
  assert.match(tool.inputSchema.properties.count.description, /BEFORE filtering/);
  const call = args => adapter.callTool(tool.name, {
    projectId: 'session', basis: 'source', delta: .5, ...args,
  });
  assert.equal((await call({ captionIndex: 3, count: 2 })).isError, true);
  const r = await call({ captionIndex: 2, count: 1 });
  assert.equal(r.isError, false);
  assert.deepEqual(r.structuredContent.data, {
    updated: true, shiftedCaptions: 1, outputDuration: 6,
  });
  assert.equal(p.captions[2].start, 3.5);
});

test('CLI range shift saves only selected rows and invalid zero-shift range preserves output', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moment-shift-range-'));
  try {
    const p = fixture();
    const source = path.join(dir, 'project.json');
    const out = path.join(dir, 'shifted.json');
    const raw = JSON.stringify(createProjectDocument(p));
    await fs.writeFile(source, raw);
    const cli = fileURLToPath(new URL('../cli/moment.mjs', import.meta.url));
    const run = args => spawnSync(process.execPath, [
      cli, 'exec', 'captions.timing.shift', '--project', source,
      '--json', JSON.stringify(args), '--out', out, '--overwrite',
    ], { encoding: 'utf8' });
    const args = { basis: 'source', delta: .5, captionIndex: 2, count: 1 };
    let r = run(args);
    assert.equal(r.status, 0, r.stderr);
    const saved = await fs.readFile(out, 'utf8');
    const next = JSON.parse(saved).project;
    assert.equal(next.captions[2].start, 3.5);
    assert.deepEqual(next.captions[0], p.captions[0]);
    r = run({ ...args, delta: 0, count: 3 });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stderr).error.code, 'INVALID_ARGUMENT');
    assert.equal(await fs.readFile(out, 'utf8'), saved);
    assert.equal(await fs.readFile(source, 'utf8'), raw);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
