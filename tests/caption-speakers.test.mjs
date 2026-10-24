import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assignCaptionSpeaker } from '../dist/core/caption-speakers.mjs';
import { prepareCommand, commandDefinition } from '../dist/core/commands.mjs';
import { createDemoProject, createProjectDocument, projectSubtitles } from '../dist/core/project.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';

const command = 'captions.speaker.assign';
function project() {
  const p = createDemoProject();
  p.speed = 2;
  p.clips = [{ start: 0, end: 1 }, { start: 0, end: 1 }];
  p.captions = [
    { start: 0, end: 1, text: 'First' },
    { start: 3, end: 5, text: 'Outside current timeline', basis: 'timeline', speaker: '', keywords: 'key', timing: 'estimated' },
    { start: 9, end: 11, text: 'Trimmed source', speaker: '1' },
  ];
  return p;
}
const assign = (p, args) => prepareCommand(p, command, args);

test('assignment changes only speakers in the exact authored range, retaining clocks and sidecars', () => {
  const p = project(), before = structuredClone(p);
  const srt = projectSubtitles(p);
  const result = assign(p, { captionIndex: 0, count: 2, speaker: '0' });
  assert.deepEqual(result.data, { updated: true, changedCaptions: 2, outputDuration: 1 });
  const expected = structuredClone(before);
  expected.captions[0].speaker = '0';
  expected.captions[1].speaker = '0';
  assert.deepEqual(result.project, expected);
  assert.deepEqual(p, before);
  assert.equal(projectSubtitles(result.project), srt);
  result.project.captions[0].text = 'Detached';
  assert.equal(p.captions[0].text, 'First');
});

test('None preserves absent fields on no-op; clearing existing slots writes only changed cues', () => {
  const p = project();
  const unchanged = assign(p, { captionIndex: 0, count: 2, speaker: '' });
  assert.equal(unchanged.project, undefined);
  assert.deepEqual(unchanged.data, { updated: false, changedCaptions: 0, outputDuration: 1 });
  assert.equal(Object.hasOwn(p.captions[0], 'speaker'), false);
  const result = assignCaptionSpeaker(p.captions, { captionIndex: 0, count: 3, speaker: '' });
  assert.equal(result.changedCaptions, 1);
  assert.equal(result.captions[0], p.captions[0]);
  assert.equal(result.captions[1], p.captions[1]);
  assert.equal(result.captions[2].speaker, '');
});

test('all invalid ranges and slots reject before no-op without partial changes', () => {
  const p = project(), before = structuredClone(p);
  const good = { captionIndex: 0, count: 1, speaker: '' };
  for (const patch of [
    { captionIndex: -1 }, { captionIndex: 3 }, { captionIndex: 10000 },
    { captionIndex: .5 }, { captionIndex: null }, { captionIndex: '0' },
    { count: 0 }, { count: -1 }, { count: 4 }, { count: 10001 },
    { count: .5 }, { count: null }, { count: '1' },
    { speaker: null }, { speaker: 0 }, { speaker: '2' }, { speaker: 'None' },
  ]) {
    assert.throws(() => assignCaptionSpeaker(p.captions, { ...good, ...patch }), { code: 'INVALID_ARGUMENT' });
    assert.throws(() => assign(p, { ...good, ...patch }), { code: 'INVALID_ARGUMENT' });
    assert.deepEqual(p, before);
  }
  for (const key of Object.keys(good)) {
    const args = { ...good };
    delete args[key];
    assert.throws(() => assign(p, args), { code: 'INVALID_ARGUMENT' });
  }
  assert.throws(() => assign(p, { ...good, basis: 'source' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => assignCaptionSpeaker([], good), { code: 'INVALID_ARGUMENT' });
});

test('maximum authored range is supported and idempotent without normalizing other metadata', () => {
  const p = project();
  p.captions = Array.from({ length: 10000 }, (_, index) => ({ start: 0, end: 1, text: String(index) }));
  const result = assign(p, { captionIndex: 0, count: 10000, speaker: '1' });
  assert.equal(result.data.changedCaptions, 10000);
  assert.equal(result.project.captions[9999].speaker, '1');
  assert.equal(assign(result.project, { captionIndex: 0, count: 10000, speaker: '1' }).project, undefined);
  assert.equal(p.captions[0].speaker, undefined);
});

test('service, preview and batch preserve one-commit, no-op and atomic-error semantics', async () => {
  let p = project(), commits = 0;
  const service = createEditorService({ getProject: () => p, commitProject: next => { p = next; commits++; } });
  const operation = { command, arguments: { captionIndex: 0, count: 2, speaker: '0' } };
  const preview = await service.execute('project.preview', { operations: [operation] });
  assert.equal(preview.data.wouldCommit, true);
  assert.deepEqual(preview.data.changedFields, ['captions']);
  assert.equal(commits, 0);
  const failed = await service.execute('project.batch', { operations: [operation, { ...operation, arguments: { ...operation.arguments, count: 4 } }] });
  assert.equal(failed.ok, false);
  assert.match(failed.error.path, /operations\[1\]/);
  assert.equal(commits, 0);
  assert.equal((await service.execute('project.batch', { operations: [operation] })).ok, true);
  assert.equal(commits, 1);
  assert.equal((await service.execute(command, operation.arguments)).data.updated, false);
  assert.equal(commits, 1);
  const adapter = createMcpToolAdapter({ resolveService: () => service });
  const response = await adapter.callTool('moment_captions_speaker_assign', { projectId: 'session', captionIndex: 1, count: 2, speaker: '1' });
  assert.equal(response.isError, false);
  assert.equal(response.structuredContent.data.changedCaptions, 1);
  assert.equal(commits, 2);
  assert.ok(commandDefinition('project.batch').inputSchema.properties.operations.items.properties.command.enum.includes(command));
});

test('CLI dry-run, output handoff and invalid assignment preserve input and existing destination', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moment-speakers-'));
  try {
    const input = path.join(directory, 'project.json'), output = path.join(directory, 'out.json');
    const original = JSON.stringify(createProjectDocument(project()));
    await fs.writeFile(input, original);
    const cli = fileURLToPath(new URL('../cli/moment.mjs', import.meta.url));
    const run = (args, flags = []) => spawnSync(process.execPath, [cli, 'exec', command, '--project', input, '--json', JSON.stringify(args), ...flags], { encoding: 'utf8' });
    const args = { captionIndex: 0, count: 2, speaker: '0' };
    const dry = run(args, ['--dry-run']);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(JSON.parse(dry.stdout).preview.project.captions[1].speaker, '0');
    assert.equal(run(args, ['--out', output]).status, 0);
    const saved = await fs.readFile(output, 'utf8');
    assert.equal(JSON.parse(saved).project.captions[0].speaker, '0');
    const failed = run({ ...args, count: 4 }, ['--out', output, '--overwrite']);
    assert.equal(failed.status, 1);
    assert.equal(JSON.parse(failed.stderr).error.code, 'INVALID_ARGUMENT');
    assert.equal(await fs.readFile(output, 'utf8'), saved);
    assert.equal(await fs.readFile(input, 'utf8'), original);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
