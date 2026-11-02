import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const mode of ['control', 'active', 'close', 'replace']) {
    test(`template preview scene references: ${mode}`, () => {
        const result = spawnSync(process.execPath, [
            '--expose-gc', fileURLToPath(new URL('./fixtures/template-preview-retention.mjs', import.meta.url)), mode,
        ], {encoding: 'utf8', timeout: 30000});
        assert.equal(result.error, undefined, result.error?.message);
        assert.equal(result.status, 0, result.stderr || result.stdout);
        const evidence = JSON.parse(result.stdout);
        assert.deepEqual(evidence.reachable, Array(3).fill(mode === 'active'));
        if (mode !== 'control') assert.ok(evidence.retainedCallbacks >= 9);
    });
}
