import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareCommand, commandDefinition } from '../dist/core/commands.mjs';
import { createDemoProject, createProjectDocument, validateProject, timelineDuration, outputDuration } from '../dist/core/project.mjs';
import { SUPPORTED_ASPECT_RATIOS } from '../dist/core/aspect-ratio.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';

const summary = p => prepareCommand(p, 'project.summary', {});

test('summary exposes only fixed metadata with exact existing clocks and saved-media requirements', () => {
  for (const ratio of SUPPORTED_ASPECT_RATIOS) {
    for (const speed of [.25, 1, 1.3, 4]) {
      const p = createDemoProject();
      Object.assign(p, { ratio, speed, kind: 'video', audioName: 'private audio.wav' });
      p.clips = [{start: .15, end: 1.35}, {start: 2.125, end: 3.456}, {start: .15, end: 1.35}];
      const before = structuredClone(p);
      assert.deepEqual(summary(p), {data: {
        kind: 'video', ratio, speed, sourceDuration: p.duration,
        timelineDuration: timelineDuration(p), outputDuration: outputDuration(p),
        clipCount: 3, captionCount: 3, cardCount: 0,
        media: {requiresVideo: true, requiresAudio: true},
      }});
      assert.deepEqual(p, before);
    }
  }
  const p = createDemoProject();
  p.captions = [];
  assert.deepEqual(summary(p).data.media, {requiresVideo: false, requiresAudio: false});
  assert.equal(summary(p).data.captionCount, 0);
  p.audioName = ' ';
  assert.equal(summary(p).data.media.requiresAudio, true);
});

test('large valid projects produce bounded text-free summaries and detached nested metadata', () => {
  const p = createDemoProject();
  p.name = 'private '.repeat(12000);
  p.fileName = 'private video.mp4';
  p.design.title.lines = ['private title', 'private title'];
  p.duration = 10000;
  p.clips = Array.from({length: 1000}, (_, i) => ({start: i * 10, end: (i + 1) * 10}));
  p.captions = Array.from({length: 10000}, (_, i) => ({start: i, end: i + 1, text: 'private caption'}));
  validateProject(p);
  const before = JSON.stringify(p);
  const result = summary(p);
  assert.equal(result.data.clipCount, 1000);
  assert.equal(result.data.captionCount, 10000);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 400);
  result.data.media.requiresVideo = true;
  assert.equal(summary(p).data.media.requiresVideo, false);
  assert.equal(JSON.stringify(p), before);
});

test('summary validates arguments and project, is excluded from batches and never commits', async () => {
  let p = createDemoProject();
  let commits = 0;
  let checks = 0;
  let providers = 0;
  const service = createEditorService({
    getProject: () => p,
    commitProject: next => { p = next; commits++; },
    jobs: {submit: () => providers++, get: () => providers++, cancel: () => providers++},
  });
  const mutation = service.execute('project.update', {patch: {ratio: '4:5', speed: 2}});
  const read = service.execute('project.summary', {}, () => checks++);
  await mutation;
  const result = await read;
  assert.equal(result.ok, true);
  assert.equal(result.data.ratio, '4:5');
  assert.equal(result.data.outputDuration, 6);
  assert.equal(commits, 1);
  assert.equal(checks, 0);
  assert.equal(providers, 0);
  for (const args of [null, [], {unknown: true}]) {
    assert.equal((await service.execute('project.summary', args)).error.code, 'INVALID_ARGUMENT');
  }
  assert.throws(() => prepareCommand(p, 'project.batch', {
    operations: [{command: 'project.summary', arguments: {}}],
  }));
  p.speed = 0;
  assert.equal((await service.execute('project.summary')).error.code, 'INVALID_ARGUMENT');
  assert.equal(commandDefinition('project.summary').mutates, false);
});

test('adapter summary schemas are closed, read-only and isolated with structured errors', async () => {
  const p = createDemoProject();
  const service = createEditorService({getProject: () => p, commitProject: () => assert.fail('read committed')});
  const adapter = createMcpToolAdapter({resolveService: () => service});
  const tool = adapter.listTools().tools.find(item => item.name === 'moment_project_summary');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.destructiveHint, false);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(tool.inputSchema.required, ['projectId']);
  const dataSchema = tool.outputSchema.oneOf[0].properties.data;
  assert.equal(dataSchema.additionalProperties, false);
  assert.equal(dataSchema.properties.media.additionalProperties, false);
  const result = await adapter.callTool(tool.name, {projectId: 'session'});
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent.data, summary(p).data);
  const invalid = await adapter.callTool(tool.name, {projectId: 'session', detail: true});
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent.error.path, 'arguments.detail');
});

test('CLI summary outputs a report rather than project, without altering its input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moment-summary-'));
  try {
    const input = join(dir, 'project.json');
    const output = join(dir, 'summary.json');
    const document = JSON.stringify(createProjectDocument(createDemoProject()));
    await writeFile(input, document);
    const cli = fileURLToPath(new URL('../cli/moment.mjs', import.meta.url));
    const run = args => spawnSync(process.execPath, [cli, 'exec', 'project.summary', '--project', input, ...args], {encoding: 'utf8'});
    const result = run(['--out', output]);
    assert.equal(result.status, 0, result.stderr);
    const saved = await readFile(output, 'utf8');
    assert.deepEqual(JSON.parse(saved), summary(createDemoProject()).data);
    assert.equal(run(['--json', '{"unknown":true}', '--out', output, '--overwrite']).status, 1);
    assert.equal(await readFile(output, 'utf8'), saved);
    assert.equal(await readFile(input, 'utf8'), document);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
