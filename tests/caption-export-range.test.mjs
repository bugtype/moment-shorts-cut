import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoProject, createProjectDocument, projectSubtitles } from '../dist/core/project.mjs';
import { prepareCommand } from '../dist/core/commands.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';

function fixture() {
  const p = createDemoProject();
  p.speed = 2;
  p.clips = [{ start: 2, end: 6 }, { start: 0, end: 4 }, { start: 2, end: 6 }];
  p.speakerLabels = ['Excluded speaker', 'Selected speaker'];
  p.captions = [
    { start: 0, end: 1, text: 'Exclude', speaker: '0' },
    { start: 2, end: 3, text: '한글 👩🏽‍💻 & <literal>', speaker: '1' },
    { start: 0, end: 1, text: 'Timeline', basis: 'timeline' },
  ];
  return p;
}

test('authored range projects repeats, mixed clocks and ties without rebasing or mutation', () => {
  const p = fixture();
  const before = structuredClone(p);
  const options = { format: 'srt', captionIndex: 1, count: 1 };
  const text = projectSubtitles(p, options);
  assert.match(text, /00:00:00,000 --> 00:00:00,500/);
  assert.match(text, /00:00:03,000 --> 00:00:03,500/);
  assert.match(text, /00:00:04,000 --> 00:00:04,500/);
  assert.equal(text.includes('Exclude'), false);
  assert.equal(text.match(/&amp; &lt;literal&gt;/g).length, 3);
  for (const format of ['srt', 'vtt', 'txt']) {
    for (const bom of [false, true]) {
      for (const review of format === 'txt' ? [false, true] : [false]) {
        const base = { format, bom, review };
        assert.equal(projectSubtitles(p, base), projectSubtitles(p, { ...base, count: 3 }));
        assert.equal(
          projectSubtitles(p, { ...base, captionIndex: 1 }),
          projectSubtitles({ ...p, captions: p.captions.slice(1) }, base),
        );
      }
    }
  }
  const review = projectSubtitles(p, { format: 'txt', review: true, captionIndex: 1, count: 1 });
  assert.match(review, /Selected speaker/);
  assert.equal(review.includes('Excluded speaker'), false);
  assert.deepEqual(p, before);
});

test('explicit ranges reject before projection while legacy format/review errors retain precedence', () => {
  const p = fixture();
  for (const value of [undefined, null, -1, .5, 3, 10000, '1']) {
    assert.throws(() => projectSubtitles(p, { captionIndex: value }), e => e.path === 'arguments.captionIndex');
  }
  for (const value of [undefined, null, 0, -1, .5, 4, 10001, '1']) {
    assert.throws(() => projectSubtitles(p, { count: value }), e => e.path === 'arguments.count');
  }
  assert.throws(() => projectSubtitles(p, { captionIndex: 2, count: 2 }), e => e.path === 'arguments.count');
  assert.throws(() => projectSubtitles(p, { format: 'srt', review: true, count: 0 }), e => e.path === 'arguments.review');
  const empty = { ...p, captions: [] };
  assert.equal(projectSubtitles(empty), '');
  assert.equal(projectSubtitles(empty, { format: 'txt', review: true, bom: true }), '');
  assert.equal(projectSubtitles(empty, { format: 'vtt' }), 'WEBVTT\n\n');
  assert.throws(() => projectSubtitles(empty, { captionIndex: 0 }));
  assert.throws(() => projectSubtitles(empty, { count: 1 }));
});

test('excluded export-invalid text and unused labels do not block selected valid rows', () => {
  const p = fixture();
  p.captions[0].text = 'bad\0text\n\nblank';
  p.speakerLabels[0] = 'bad\0label';
  for (const format of ['srt', 'vtt', 'txt']) {
    assert.throws(() => projectSubtitles(p, { format }));
    assert.doesNotThrow(() => projectSubtitles(p, { format, captionIndex: 1, count: 1 }));
  }
  assert.doesNotThrow(() => projectSubtitles(p, { format: 'txt', review: true, captionIndex: 1, count: 1 }));
  p.captions[1].start = 8;
  p.captions[1].end = 9;
  assert.equal(projectSubtitles(p, { format: 'txt', captionIndex: 1, count: 1 }), '');
});

test('derived count and byte budgets apply to selected output, including repeated rows', () => {
  const p = createDemoProject();
  p.clips = [{ start: 0, end: 12 }, { start: 0, end: 12 }];
  p.captions = Array.from({ length: 10000 }, () => ({ start: 0, end: 1, text: 'x'.repeat(2000) }));
  assert.throws(() => projectSubtitles(p, { format: 'txt' }), e => e.code === 'CAPTION_OUTPUT_LIMIT');
  assert.equal(projectSubtitles(p, { format: 'txt', captionIndex: 9999 }).length, 4003);
  assert.throws(() => projectSubtitles(p, { format: 'txt', count: 1000 }), e => e.code === 'CAPTION_OUTPUT_LIMIT');
  p.captions.forEach(c => { c.text = ''; });
  assert.throws(() => projectSubtitles(p, { format: 'txt', count: 5001 }), e => e.code === 'CAPTION_OUTPUT_LIMIT');
  assert.doesNotThrow(() => projectSubtitles(p, { format: 'txt', count: 5000 }));
});

test('service and adapter are read-only and advertise bounded optional fields', async () => {
  const p = fixture();
  const before = structuredClone(p);
  const forbidden = () => { throw new Error('Must not commit or invoke provider'); };
  const service = createEditorService({ getProject: () => p, commitProject: forbidden });
  const adapter = createMcpToolAdapter({ resolveService: () => service });
  const tool = adapter.listTools().tools.find(item => item.name === 'moment_captions_export');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.inputSchema.properties.count.maximum, 10000);
  assert.equal(tool.inputSchema.required.includes('count'), false);
  const args = { format: 'txt', captionIndex: 1, count: 1 };
  const result = await service.execute('captions.export', args, forbidden);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, prepareCommand(p, 'captions.export', args).data);
  const response = await adapter.callTool('moment_captions_export', { projectId: 'session', ...args });
  assert.deepEqual(response.structuredContent.data, result.data);
  assert.equal((await service.execute('captions.export', { ...args, count: 4 })).ok, false);
  assert.deepEqual(p, before);
});

test('CLI preserves existing output on range error and real stdio exports selected rows', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moment-export-range-'));
  try {
    const p = fixture();
    const input = path.join(dir, 'project.json');
    const output = path.join(dir, 'review.txt');
    await fs.writeFile(input, JSON.stringify(createProjectDocument(p)));
    await fs.writeFile(output, 'sentinel');
    const cli = fileURLToPath(new URL('../cli/moment.mjs', import.meta.url));
    const args = ['exec', 'captions.export', '--project', input, '--out', output, '--overwrite', '--json'];
    const invalid = spawnSync(process.execPath, [cli, ...args, JSON.stringify({ format: 'txt', count: 4 })], { encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.equal(await fs.readFile(output, 'utf8'), 'sentinel');
    const valid = spawnSync(process.execPath, [cli, ...args, JSON.stringify({ format: 'txt', captionIndex: 1, count: 1 })], { encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(await fs.readFile(output, 'utf8'), projectSubtitles(p, { format: 'txt', captionIndex: 1, count: 1 }));
    const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
    const call = (id, name, arguments_) => request(id, 'tools/call', { name, arguments: { projectId: 'session', ...arguments_ } });
    const messages = [
      request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'range-test', version: '1' } }),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      call(2, 'moment_project_import', { document: createProjectDocument(p) }),
      call(3, 'moment_captions_export', { format: 'txt', captionIndex: 1, count: 1 }),
    ];
    const server = fileURLToPath(new URL('../cli/mcp.mjs', import.meta.url));
    const child = spawnSync(process.execPath, [server], { input: messages.map(JSON.stringify).join('\n') + '\n', encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const last = JSON.parse(child.stdout.trim().split('\n').at(-1));
    assert.equal(last.result.structuredContent.data.text, projectSubtitles(p, { format: 'txt', captionIndex: 1, count: 1 }));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
