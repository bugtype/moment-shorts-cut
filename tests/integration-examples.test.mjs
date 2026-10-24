import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

for (const example of ['use-editor-service.mjs', 'use-mcp-client.mjs']) {
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
    if (example === 'use-mcp-client.mjs') {
      assert.equal(output.tools, 12);
      assert.equal(output.recoveredFromInvalidInput, true);
      assert.equal(output.reimported, true);
    }
  });
}
