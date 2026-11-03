import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
for (const mode of ['active','cancel','native-close','replace','pending-cancel','pending-native-close','pending-replace']) {
    test(`session relink releases unused selected media: ${mode}`, () => {
        const result = JSON.parse(execFileSync(process.execPath, ['--expose-gc',
            fileURLToPath(new URL('./fixtures/session-dialog-retention.mjs', import.meta.url)), mode],
            {encoding:'utf8',timeout:30000}));
        assert.deepEqual(result.retained, [mode==='active',mode==='active']);
        assert.equal(result.open, mode==='active'||mode.endsWith('replace'));
        assert.equal(result.history,0); assert.equal(result.future,0);
        assert.equal(result.phase,'failed');
        assert.equal(result.video,false); assert.equal(result.audio,false);
    });
}
