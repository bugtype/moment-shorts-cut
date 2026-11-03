import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

for (const mode of ['control', 'active', 'native-close', 'cancel', 'route', 'replace']) {
    test(`Tool Finder releases retired project and media: ${mode}`, () => {
        const result = spawnSync(process.execPath, ['--expose-gc', new URL('./fixtures/finder-dialog-retention.mjs', import.meta.url).pathname, mode], {encoding:'utf8'});
        assert.equal(result.status, 0, result.stderr);
        const evidence = JSON.parse(result.stdout);
        assert.deepEqual(evidence.retained, Array(3).fill(mode === 'active'));
        assert.equal(evidence.fileName, mode === 'active' ? 'previous.mp4' : 'next.mp4');
        assert.equal(evidence.history, 0);
        assert.equal(evidence.future, 0);
    });
}
