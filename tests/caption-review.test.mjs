import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDemoProject, createProjectDocument, projectSubtitles } from '../dist/core/project.mjs';
import { prepareCommand } from '../dist/core/commands.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';
import { MAX_SUBTITLE_BYTES } from '../dist/captions.mjs';
import { setLocale, t } from '../dist/i18n.mjs';

const review = (project, options = {}) => projectSubtitles(project, { format: 'txt', review: true, ...options });
function project() {
  const p = createDemoProject();
  p.speed = 2;
  p.clips = [{ start: 0, end: 4 }, { start: 0, end: 4 }];
  p.speakerLabels = ['Host\r\n一', 'Guest'];
  p.captions = [
    { start: 0, end: 2, text: 'First <>&\r\n line', speaker: '0', keywords: 'PRIVATE_KEYWORD' },
    { start: 2, end: 4, text: 'Second', speaker: '1' },
    { start: 1, end: 2, text: 'Timeline', basis: 'timeline' },
  ];
  p.name = 'PRIVATE_PROJECT';
  p.fileName = 'PRIVATE_MEDIA';
  return p;
}

test('review preserves edited occurrences, mixed clocks, labels and literal text in each locale', () => {
  const p = project(), before = structuredClone(p);
  const headings = new Set();
  try {
    for (const locale of ['ko', 'en', 'zh-CN']) {
      setLocale(locale, { persist: false });
      const text = review(p);
      headings.add(t('review.heading'));
      assert.ok(text.startsWith(t('review.heading') + '\n'));
      assert.ok(text.includes(t('review.time', { start: '0.5', end: '1' })));
      assert.ok(text.includes(t('review.speaker', { name: 'Host\n一' })));
      assert.equal(text.split('First <>&\n line').length - 1, 2);
      assert.equal(text.split('Second').length - 1, 2);
      assert.equal(text.split('Timeline').length - 1, 1);
      assert.ok(text.indexOf('First') < text.indexOf('Timeline'));
      assert.ok(text.indexOf('Timeline') < text.indexOf('Second'));
      assert.doesNotMatch(text, /PRIVATE_|captionIndex|clipIndex|sourceStart/);
      assert.equal(text.includes('\r'), false);
      assert.deepEqual(p, before);
    }
    assert.equal(headings.size, 3);
  } finally { setLocale('ko', { persist: false }); }
});

test('default false preserves all old bytes and true is TXT-only with boolean validation', () => {
  const p = createDemoProject();
  for (const format of ['srt', 'vtt', 'txt']) {
    for (const bom of [false, true]) {
      assert.equal(projectSubtitles(p, { format, bom, review: false }), projectSubtitles(p, { format, bom }));
    }
  }
  for (const value of [null, 0, 1, 'true', {}]) {
    assert.throws(() => projectSubtitles(p, { format: 'txt', review: value }), { code: 'INVALID_ARGUMENT', path: 'arguments.review' });
    assert.throws(() => prepareCommand(p, 'captions.export', { format: 'txt', review: value }), { code: 'INVALID_ARGUMENT' });
  }
  for (const format of ['srt', 'vtt', undefined]) {
    assert.throws(() => projectSubtitles(p, { format, review: true }), { code: 'INVALID_ARGUMENT', path: 'arguments.review' });
  }
});

test('empty/None labels are omitted, whitespace remains literal, and only exported NUL rejects', () => {
  const p = createDemoProject();
  p.speakerLabels = ['', 'UNUSED\0NAME'];
  p.captions = [{ start: 0, end: 1, text: 'Text', speaker: '0' }];
  assert.ok(review(p).includes('Text'));
  assert.equal(review(p).includes(t('review.speaker', { name: '' })), false);
  p.captions[0].speaker = '';
  assert.ok(review(p).includes('Text'));
  p.speakerLabels[0] = ' \n ';
  p.captions[0].speaker = '0';
  assert.ok(review(p).includes(t('review.speaker', { name: ' \n ' })));
  p.captions[0].speaker = '1';
  assert.throws(() => review(p), { code: 'INVALID_ARGUMENT' });
  p.captions[0].speaker = '';
  p.captions[0].text = 'Bad\0text';
  assert.throws(() => review(p), { code: 'INVALID_ARGUMENT' });
  p.clips = [{ start: 2, end: 3 }];
  assert.equal(review(p, { bom: true }), '');
});

test('raw fractional seconds remain unrounded, including intervals below subtitle milliseconds', () => {
  const p = createDemoProject();
  p.speed = 4;
  p.captions = [{ start: 1e-7, end: 2e-7, text: 'Tiny' }];
  assert.ok(review(p).includes(t('review.time', { start: String(1e-7 / 4), end: String(2e-7 / 4) })));
  assert.throws(() => projectSubtitles(p), { code: 'INVALID_ARGUMENT' });
});

test('final UTF-8 budget counts headers, names, separators and BOM exactly', () => {
  const p = createDemoProject();
  p.speakerLabels[0] = 'H'.repeat(80);
  p.captions = Array.from({ length: 1000 }, () => ({ start: 0, end: 1, text: '', speaker: '0' }));
  const overhead = Buffer.byteLength(review(p));
  const remaining = MAX_SUBTITLE_BYTES - overhead;
  assert.ok(remaining > 0 && remaining < 2000000);
  const each = Math.floor(remaining / p.captions.length);
  const remainder = remaining % p.captions.length;
  p.captions.forEach((cue, index) => { cue.text = 'a'.repeat(each + (index < remainder ? 1 : 0)); });
  assert.equal(Buffer.byteLength(review(p)), MAX_SUBTITLE_BYTES);
  assert.throws(() => review(p, { bom: true }), { code: 'CAPTION_OUTPUT_LIMIT' });
  p.captions[0].text = p.captions[0].text.slice(3);
  assert.equal(Buffer.byteLength(review(p, { bom: true })), MAX_SUBTITLE_BYTES);
  p.captions[0].text = '가' + p.captions[0].text.slice(1);
  assert.throws(() => review(p, { bom: true }), { code: 'CAPTION_OUTPUT_LIMIT' });
});

test('service and MCP return the existing read-only envelope and remain usable after review errors', async () => {
  const p = project(), before = structuredClone(p);
  let commits = 0;
  const service = createEditorService({ getProject: () => p, commitProject: () => { commits++; } });
  const adapter = createMcpToolAdapter({ resolveService: () => service });
  const result = await adapter.callTool('moment_captions_export', { projectId: 'session', format: 'txt', review: true });
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent.data, { format: 'txt', text: review(p) });
  assert.equal((await service.execute('captions.export', { format: 'vtt', review: true })).ok, false);
  assert.equal((await service.execute('captions.export', { format: 'txt' })).ok, true);
  assert.equal(commits, 0);
  assert.deepEqual(p, before);
});

test('CLI writes review TXT and failed requests preserve an existing destination', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moment-review-'));
  try {
    const input = path.join(directory, 'project.json'), output = path.join(directory, 'review.txt');
    const p = project();
    await fs.writeFile(input, JSON.stringify(createProjectDocument(p)));
    const cli = fileURLToPath(new URL('../cli/moment.mjs', import.meta.url));
    const run = args => spawnSync(process.execPath, [cli, 'exec', 'captions.export', '--project', input, '--json', JSON.stringify(args), '--out', output, '--overwrite'], { encoding: 'utf8' });
    const result = run({ format: 'txt', review: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await fs.readFile(output, 'utf8'), review(p));
    const saved = await fs.readFile(output, 'utf8');
    assert.equal(run({ format: 'srt', review: true }).status, 1);
    assert.equal(await fs.readFile(output, 'utf8'), saved);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('review retains shared derived occurrence and raw-text limits before formatting', () => {
  const p = createDemoProject();
  p.captions = Array.from({ length: 1050 }, () => ({ start: 0, end: 1, text: 'a'.repeat(2000) }));
  assert.throws(() => review(p), { code: 'CAPTION_OUTPUT_LIMIT' });
  p.captions = Array.from({ length: 11 }, () => ({ start: 0, end: 1, text: 'x' }));
  p.clips = Array.from({ length: 1000 }, () => ({ start: 0, end: 1 }));
  assert.throws(() => review(p), { code: 'CAPTION_OUTPUT_LIMIT' });
});
