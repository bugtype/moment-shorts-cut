import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
for (const kind of ['position','card','framing','timing']) for (const mode of ['control','active','native-close','cancel','apply','replace']) {
    test(`geometry ${kind} releases retired project and media: ${mode}`, () => {
        const result = JSON.parse(execFileSync(process.execPath, ['--expose-gc',
            fileURLToPath(new URL('./fixtures/geometry-dialog-retention.mjs', import.meta.url)), mode, kind],
            {encoding:'utf8',timeout:30000}));
        assert.deepEqual(result.retained, [mode==='active',mode==='active',mode==='active']);
        assert.equal(result.fileName, mode==='active' ? 'previous.mp4' : 'next.mp4');
        assert.equal(result.history, 0); assert.equal(result.future, 0);
        assert.equal(result.speed, 1);
    });
}
