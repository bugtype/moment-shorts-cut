import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDemoProject, createProjectDocument } from '../dist/core/project.mjs';
import { prepareCommand, commandDefinition } from '../dist/core/commands.mjs';
import { inspectCaptionOverlaps } from '../dist/core/caption-overlaps.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';

function fixture() {
  const p = createDemoProject();
  p.clips = [{ start: 0, end: 4 }, { start: 0, end: 4 }];
  p.speed = 2;
  p.captions = [{ start: 0, end: 2, text: 'ABCD' },
    { start: 1, end: 2, text: 'e\u0301🎬', basis: 'timeline' },
    { start: 3, end: 4, text: 'Z' }, { start: 10, end: 11, text: 'Outside' }];
  return p;
}
const inspect = (p, review = {}, limit) => prepareCommand(p, 'captions.inspect', { review, ...(limit === undefined ? {} : { limit }) }).data;

test('combined review counts unique occurrences and findings separately, with fixed order and unchanged witness evidence', () => {
  const p = fixture(), before = structuredClone(p);
  const review = { maxGraphemesPerSecond: 3, minDuration: .75, maxDuration: .9 };
  const result = inspect(p, review);
  assert.equal(result.metric, 'caption-review');
  assert.deepEqual(result.thresholds, { includeOverlaps: true, ...review });
  assert.equal(result.filter, 'all');
  assert.equal(result.totalOccurrences, 5);
  assert.equal(result.flaggedOccurrences, 5);
  assert.deepEqual(result.counts, { readingSpeed: 3, tooShort: 3, tooLong: 2, overlap: 2 });
  assert.equal(result.totalFindings, 10);
  assert.equal(result.matchedFindings, 10);
  assert.equal(result.omittedFindings, 0);
  assert.deepEqual(result.issues.map(i => [i.occurrenceIndex, i.kind]), [
    [0, 'reading-speed'], [0, 'too-long'], [0, 'overlap'],
    [1, 'reading-speed'], [1, 'too-short'], [1, 'overlap'],
    [2, 'too-short'], [3, 'reading-speed'], [3, 'too-long'], [4, 'too-short'],
  ]);
  const overlaps = result.issues.filter(i => i.kind === 'overlap').map(({ kind, ...issue }) => issue);
  assert.deepEqual(overlaps, inspectCaptionOverlaps(p).issues);
  assert.equal(Object.hasOwn(result.issues.find(i => i.captionIndex === 1), 'clipIndex'), false);
  assert.ok(result.issues.every(i => !Object.hasOwn(i, 'text')));
  assert.deepEqual(p, before);
});

test('filter applies before limit without changing full totals; disabled filters, exact boundaries and overlap-only work', () => {
  const p = fixture();
  const options = { maxGraphemesPerSecond: 3, minDuration: .75, maxDuration: .9 };
  const all = inspect(p, options);
  for (const filter of ['reading-speed', 'too-short', 'too-long', 'overlap']) {
    const filtered = inspect(p, { ...options, filter }, 1);
    const expected = all.issues.filter(issue => issue.kind === filter);
    assert.deepEqual(filtered.issues, expected.slice(0, 1));
    assert.equal(filtered.matchedFindings, expected.length);
    assert.equal(filtered.omittedFindings, expected.length - 1);
    assert.equal(filtered.totalFindings, all.totalFindings);
    assert.equal(filtered.flaggedOccurrences, all.flaggedOccurrences);
    assert.deepEqual(filtered.counts, all.counts);
  }
  const overlaps = inspect(p);
  assert.deepEqual(overlaps.thresholds, { includeOverlaps: true });
  assert.equal(overlaps.totalFindings, 2);
  const disabled = inspect(p, { includeOverlaps: false, minDuration: 1, filter: 'overlap' });
  assert.equal(disabled.matchedFindings, 0); assert.deepEqual(disabled.issues, []);
  assert.equal(disabled.totalFindings, 3); assert.equal(disabled.flaggedOccurrences, 3);
  const strict = inspect(p, { includeOverlaps: false, minDuration: .5, maxDuration: 1, maxGraphemesPerSecond: 4 });
  assert.equal(strict.totalFindings, 0);
  p.captions = [];
  assert.equal(inspect(p).totalOccurrences, 0);
});

test('review validation is bounded and legacy missing-required error precedes invalid project validation', () => {
  const p = fixture();
  const invalid = [null, [], { includeOverlaps: false }, { minDuration: 0 }, { maxDuration: -1 },
    { minDuration: 3, maxDuration: 2 }, { maxGraphemesPerSecond: 0 }, { includeOverlaps: 'yes' },
    { filter: 'unknown' }, { unknown: true }];
  for (const review of invalid) assert.throws(() => inspect(p, review), e => e.code === 'INVALID_ARGUMENT');
  for (const value of [NaN, Infinity, -Infinity, null, '1']) {
    assert.throws(() => inspect(p, { minDuration: value }));
    assert.throws(() => inspect(p, { maxDuration: value }));
  }
  for (const limit of [0, 101, 1.5, null]) assert.throws(() => inspect(p, {}, limit));
  assert.throws(() => prepareCommand(p, 'captions.inspect', { maxGraphemesPerSecond: 1, review: {} }),
    e => e.messageKey === 'errors.inspectionModes' && e.path === 'arguments.review');
  for (const args of [{}, { limit: 0 }]) assert.throws(() => prepareCommand(null, 'captions.inspect', args),
    e => e.messageKey === 'errors.required' && e.path === 'arguments.maxGraphemesPerSecond');
  assert.throws(() => prepareCommand(p, 'captions.inspect', null), e => e.messageKey === 'errors.object');
  assert.doesNotThrow(() => inspect(p, { minDuration: Number.MAX_VALUE, includeOverlaps: false }));
  const schema = commandDefinition('captions.inspect').inputSchema;
  assert.equal(schema.anyOf.length, 2);
  assert.deepEqual(schema.anyOf[0], { required: ['maxGraphemesPerSecond'], not: { required: ['review'] } });
});

test('duration and overlap checks do not need Segmenter, while rate precision and projection budgets remain guarded', () => {
  const p = fixture(), original = Intl.Segmenter;
  try {
    Intl.Segmenter = undefined;
    assert.doesNotThrow(() => inspect(p));
    assert.doesNotThrow(() => inspect(p, { minDuration: 1, includeOverlaps: false }));
    assert.throws(() => inspect(p, { maxGraphemesPerSecond: 1 }), e => e.messageKey === 'errors.graphemesUnavailable');
  } finally { Intl.Segmenter = original; }
  p.clips = [{ start: 0, end: 12 }]; p.speed = 1;
  p.captions = [{ start: 0, end: Number.MIN_VALUE, text: 'A' }];
  assert.throws(() => inspect(p, { maxGraphemesPerSecond: 1 }), e => e.messageKey === 'errors.inspectionPrecision');
  assert.doesNotThrow(() => inspect(p, { minDuration: 1 }));
  p.speed = 4;
  assert.throws(() => inspect(p, { minDuration: 1, includeOverlaps: false }), e => e.messageKey === 'errors.inspectionPrecision');
  p.speed = 1; p.captions = Array.from({ length: 10000 }, () => ({ start: 0, end: 1, text: '' }));
  const full = inspect(p, { minDuration: 2 }, 100);
  assert.equal(full.totalFindings, 20000); assert.equal(full.flaggedOccurrences, 10000);
  assert.equal(full.issues.length, 100); assert.equal(full.omittedFindings, 19900);
  assert.equal(inspect(p).issues.length, 20);
  p.clips.push({ start: 0, end: 12 });
  assert.throws(() => inspect(p), e => e.code === 'CAPTION_OUTPUT_LIMIT');
  p.clips.pop(); p.captions = Array.from({ length: 400 }, () => ({ start: 0, end: 1, text: '가'.repeat(2000) }));
  assert.throws(() => inspect(p), e => e.code === 'CAPTION_OUTPUT_LIMIT');
});

test('service and MCP review are read-only, return closed schema alternatives and reject edit batch admission', async () => {
  const p = fixture(), before = structuredClone(p);
  const forbidden = () => { throw new Error('Read must not commit or guard a commit'); };
  const service = createEditorService({ getProject: () => p, commitProject: forbidden });
  const args = { review: { minDuration: .75, filter: 'too-short' }, limit: 1 };
  const result = await service.execute('captions.inspect', args, forbidden);
  assert.equal(result.ok, true); assert.deepEqual(result.data, inspect(p, args.review, 1));
  const adapter = createMcpToolAdapter({ resolveService: () => service });
  const tool = adapter.listTools().tools.find(t => t.name === 'moment_captions_inspect');
  assert.equal(tool.annotations.readOnlyHint, true);
  const response = await adapter.callTool(tool.name, { projectId: 'session', ...args });
  assert.deepEqual(response.structuredContent, result);
  const branches = tool.outputSchema.oneOf[0].properties.data.anyOf;
  assert.equal(branches.length, 2);
  assert.deepEqual(branches[0].properties.metric.enum, ['non-whitespace-graphemes-per-second']);
  assert.deepEqual(branches[1].properties.metric.enum, ['caption-review']);
  assert.equal(branches[1].additionalProperties, false);
  assert.equal(branches[1].properties.issues.items.anyOf.length, 4);
  for (const command of ['project.batch', 'project.preview']) {
    assert.equal((await service.execute(command, { operations: [{ command: 'captions.inspect', arguments: args }] })).ok, false);
  }
  assert.deepEqual(p, before);
});

test('actual CLI and stdio MCP produce review reports, preserve project and recover after invalid review', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moment-caption-review-'));
  try {
    const p = fixture(), input = path.join(dir, 'project.json'), output = path.join(dir, 'review.json');
    const raw = JSON.stringify(createProjectDocument(p)); await fs.writeFile(input, raw);
    const args = { review: { minDuration: .75, maxDuration: .9 }, limit: 2 };
    const expected = inspect(p, args.review, args.limit);
    const cli = fileURLToPath(new URL('../cli/moment.mjs', import.meta.url));
    const run = value => spawnSync(process.execPath, [cli, 'exec', 'captions.inspect', '--project', input,
      '--out', output, '--overwrite', '--args-file', '-'], { input: JSON.stringify(value), encoding: 'utf8' });
    assert.equal(run(args).status, 0); assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')), expected);
    const bytes = await fs.readFile(output, 'utf8');
    const failed = run({ review: { includeOverlaps: false } }); assert.equal(failed.status, 1);
    assert.equal(JSON.parse(failed.stderr).error.code, 'INVALID_ARGUMENT');
    assert.equal(await fs.readFile(output, 'utf8'), bytes); assert.equal(await fs.readFile(input, 'utf8'), raw);
    const call = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: `moment_${name}`, arguments: { projectId: 'session', ...args } } });
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'review-test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' }, call(2, 'project_import', { document: createProjectDocument(p) }),
      call(3, 'captions_inspect', { review: { includeOverlaps: false } }), call(4, 'captions_inspect', args),
      call(5, 'captions_inspect', { maxGraphemesPerSecond: 3 }), call(6, 'project_get'),
    ];
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('../cli/mcp.mjs', import.meta.url))], {
      input: messages.map(message => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    const results = new Map(child.stdout.trim().split('\n').map(line => { const r = JSON.parse(line); return [r.id, r.result]; }));
    assert.equal(results.get(3).isError, true);
    assert.deepEqual(results.get(4).structuredContent.data, expected);
    assert.equal(results.get(5).structuredContent.data.metric, 'non-whitespace-graphemes-per-second');
    assert.deepEqual(results.get(6).structuredContent.data, createProjectDocument(p));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
