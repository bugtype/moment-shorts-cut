import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

for (const example of ['use-editor-service.mjs', 'use-mcp-client.mjs', 'correct-caption-text.mjs']) {
  test(`${example} runs independently of the client's working directory`, () => {
    const script = fileURLToPath(new URL('../examples/' + example, import.meta.url));
    const result = spawnSync(process.execPath, [script], {
      cwd: tmpdir(), encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.stderr, '');
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.rendered, false);
    if (example === 'correct-caption-text.mjs') {
      assert.equal(output.changedCaptions, 2);
      assert.equal(output.filesWritten, false);
    }
    if (example === 'use-editor-service.mjs') assert.equal(output.captionRows, 2);
    if (example === 'use-mcp-client.mjs') {
      assert.equal(output.tools, 41);
      assert.equal(output.recoveredFromInvalidInput, true);
      assert.equal(output.reimported, true);
    }
  });
}

// A consumer must not split an oversized correction into batches and describe
// the whole sequence as atomic. The service rejects the oversized batch intact.
test('21 text corrections reject atomically without changing any rows', async () => {
  const {createDemoProject} = await import('../dist/core/project.mjs');
  const {createEditorService} = await import('../dist/integration/editor-service.mjs');
  let project = createDemoProject(), commits = 0;
  project.clips = [{start: 0, end: 2}];
  project.captions = Array.from({length: 21}, (_, index) => ({
    start: 5, end: 6, text: `Draft ${index}`, basis: 'timeline',
    speaker: '1', keywords: 'retained', timing: 'estimated',
  }));
  const before = structuredClone(project);
  const service = createEditorService({getProject: () => project,
    commitProject: next => {project = next; commits++;}});
  const operations = project.captions.map((_, captionIndex) => ({
    command: 'captions.update', arguments: {captionIndex, patch: {text: `Reviewed ${captionIndex}`}},
  }));
  for (const command of ['project.preview', 'project.batch']) {
    const result = await service.execute(command, {operations});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'INVALID_ARGUMENT');
    assert.equal(result.error.path, 'arguments.operations');
    assert.deepEqual(project, before);
    assert.equal(commits, 0);
  }
});
