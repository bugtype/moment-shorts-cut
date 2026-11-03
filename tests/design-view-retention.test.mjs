import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
for(const mode of ['active','reset','return'])test(`design view project reachability after ${mode}`,()=>{
 const result=spawnSync(process.execPath,['--expose-gc',fileURLToPath(new URL('./fixtures/design-view-retention.mjs',import.meta.url)),mode],{encoding:'utf8',timeout:30000});
 assert.equal(result.status,0,result.stderr||result.stdout);
 const evidence=JSON.parse(result.stdout);
 assert.equal(evidence.oldProjectRetained,mode==='active');
 assert.equal(evidence.currentCaptions,mode==='active'?10000:3);
 assert.equal(evidence.history,0);assert.equal(evidence.future,0);
 assert.equal(evidence.panel,mode==='reset'?'media':'text');
});
