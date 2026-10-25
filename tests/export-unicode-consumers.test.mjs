import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoProject, createProjectDocument, readProjectDocument } from '../dist/core/project.mjs';
import { prepareCommand } from '../dist/core/commands.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';

const formats = [{ format: 'srt' }, { format: 'vtt' }, { format: 'txt' }, { format: 'txt', review: true }];
const validText = 'Paired 🎬, combining e\u0301, literal replacement \ufffd';
const cli = fileURLToPath(new URL('../cli/moment.mjs', import.meta.url));
const server = fileURLToPath(new URL('../cli/mcp.mjs', import.meta.url));
function fixture(text = 'Before \ud800 after') {
  const project = createDemoProject();
  project.captions = [{ start: 0, end: 1, text, speaker: '0' }];
  project.speakerLabels = ['Reviewer', 'Unused'];
  return project;
}
function runCli(command, input, output, args = {}, flags = []) {
  return spawnSync(process.execPath, [cli, 'exec', command, '--project', input,
    '--out', output, '--json', JSON.stringify(args), ...flags], { encoding: 'utf8' });
}
function expectFailure(result) {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_ARGUMENT');
}

test('CLI rejects isolated surrogates before creating or overwriting every subtitle format; JSON backup stays lossless', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moment-unicode-export-'));
  try {
    const input = path.join(dir, 'project.json');
    const output = path.join(dir, 'subtitle.txt');
    const absent = path.join(dir, 'absent.txt');
    for (const surrogate of ['\ud800', '\udfff']) {
      const project = fixture(`Before ${surrogate} after`);
      const original = JSON.stringify(createProjectDocument(project));
      await fs.writeFile(input, original);
      for (const args of formats) {
        await fs.writeFile(output, 'Existing bytes must survive');
        for (const target of [output, absent]) {
          const failed = runCli('captions.export', input, target, args, ['--overwrite']);
          assert.equal(failed.status, 1, failed.stderr);
          expectFailure(JSON.parse(failed.stderr));
        }
        assert.equal(await fs.readFile(output, 'utf8'), 'Existing bytes must survive');
        await assert.rejects(fs.stat(absent), { code: 'ENOENT' });
      }
      const backup = path.join(dir, 'backup.json');
      const saved = runCli('project.get', input, backup, {}, ['--overwrite']);
      assert.equal(saved.status, 0, saved.stderr);
      const restored = readProjectDocument(JSON.parse(await fs.readFile(backup, 'utf8')));
      assert.deepEqual(restored, project);
      assert.equal(restored.captions[0].text.charCodeAt(7), surrogate.charCodeAt(0));
      assert.equal(await fs.readFile(input, 'utf8'), original);
    }
    await fs.writeFile(input, JSON.stringify(createProjectDocument(fixture(validText))));
    for (const args of formats) {
      const retry = runCli('captions.export', input, output, args, ['--overwrite']);
      assert.equal(retry.status, 0, retry.stderr);
      const bytes = await fs.readFile(output);
      assert.ok(bytes.toString('utf8').includes(validText));
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('service rejects only export, preserves JSON and state, then accepts a corrected caption', async () => {
  let project = fixture();
  let commits = 0;
  const before = structuredClone(project);
  const service = createEditorService({ getProject: () => project, commitProject: next => { project = next; commits++; } });
  for (const args of formats) {
    assert.throws(() => prepareCommand(project, 'captions.export', args),
      error => error.code === 'INVALID_ARGUMENT' && error.messageKey === 'errors.textUnicode');
    expectFailure(await service.execute('captions.export', args));
  }
  assert.deepEqual(project, before);
  assert.equal(commits, 0);
  const backup = await service.execute('project.get', {});
  assert.equal(backup.ok, true);
  assert.deepEqual(readProjectDocument(JSON.parse(JSON.stringify(backup.data))), before);
  assert.equal((await service.execute('captions.update', { captionIndex: 0, patch: { text: validText } })).ok, true);
  for (const args of formats) {
    const result = await service.execute('captions.export', args);
    assert.equal(result.ok, true);
    assert.ok(result.data.text.includes(validText));
  }
  assert.equal(commits, 1);
  project.speakerLabels[0] = 'Bad \udfff label';
  expectFailure(await service.execute('captions.export', { format: 'txt', review: true }));
  assert.equal((await service.execute('captions.export', { format: 'txt' })).ok, true, 'plain text does not emit labels');
  project.speakerLabels[0] = validText;
  project.speakerLabels[1] = 'Unused \ud800 label';
  assert.equal((await service.execute('captions.export', { format: 'txt', review: true })).ok, true);
});

test('real stdio MCP retains invalid Unicode in JSON, returns structured export errors and supports corrected retry', () => {
  const project = fixture('Before \udfff after');
  const call = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call',
    params: { name: `moment_${name}`, arguments: { projectId: 'session', ...args } } });
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'unicode-test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    call(2, 'project_import', { document: createProjectDocument(project) }),
    ...formats.map((args, index) => call(3 + index, 'captions_export', args)),
    call(7, 'project_get'),
    call(8, 'captions_update', { captionIndex: 0, patch: { text: validText } }),
    ...formats.map((args, index) => call(9 + index, 'captions_export', args)),
    call(13, 'project_get'),
  ];
  const child = spawnSync(process.execPath, [server], {
    input: messages.map(message => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
  const replies = new Map(child.stdout.trim().split('\n').map(line => {
    const response = JSON.parse(line);
    return [response.id, response.result];
  }));
  assert.equal(replies.get(2).isError, false);
  for (let id = 3; id <= 6; id++) {
    assert.equal(replies.get(id).isError, true);
    expectFailure(replies.get(id).structuredContent);
  }
  const backup = replies.get(7).structuredContent.data;
  assert.deepEqual(readProjectDocument(backup), project);
  assert.equal(backup.project.captions[0].text.charCodeAt(7), 0xdfff);
  assert.equal(replies.get(8).structuredContent.ok, true);
  for (let id = 9; id <= 12; id++) {
    assert.equal(replies.get(id).structuredContent.ok, true);
    assert.ok(replies.get(id).structuredContent.data.text.includes(validText));
  }
  assert.deepEqual(replies.get(13).structuredContent.data.project.captions,
    [{ ...project.captions[0], text: validText }]);
});
