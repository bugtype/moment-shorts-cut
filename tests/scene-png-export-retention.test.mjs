import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const mode of ['success', 'stale', 'null-blob', 'paint-error', 'encoder-error', 'download-error', 'pending', 'reentrant']) {
  test(`scene PNG export releases settled snapshot: ${mode}`, () => {
    const result = spawnSync(process.execPath, ['--expose-gc',
      fileURLToPath(new URL('./fixtures/scene-png-export-retention.mjs', import.meta.url)), mode],
    { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).mode, mode);
  });
}
