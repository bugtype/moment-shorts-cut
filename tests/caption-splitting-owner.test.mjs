import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import * as owner from '../dist/caption-splitting.mjs';
import * as effects from '../dist/effects.mjs';

const ownerUrl = new URL('../dist/caption-splitting.mjs', import.meta.url).href;
const effectsUrl = new URL('../dist/effects.mjs', import.meta.url).href;
const parserUrl = new URL('../dist/captions.mjs', import.meta.url).href;

// Native module caching and eager initialization need a fresh module graph.
function isolated(source) {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const ownerUrl=${JSON.stringify(ownerUrl)}, effectsUrl=${JSON.stringify(effectsUrl)}, parserUrl=${JSON.stringify(parserUrl)};
    ${source}
  `], {encoding:'utf8', timeout:10000});
  assert.equal(run.status, 0, run.stderr || String(run.error || run.signal));
}

test('caption owner and historical effects facade share function objects and unchanged cue semantics', () => {
  assert.deepEqual(Object.keys(owner), ['splitCaptionAtOffset', 'splitCaptionText']);
  for (const name of Object.keys(owner)) assert.strictEqual(effects[name], owner[name]);
  const cue = {text:'가👩‍👩‍👧‍👦나', start:2, end:8, basis:'timeline', speaker:'1'};
  assert.strictEqual(owner.splitCaptionText(cue, 3)[0], cue);
  assert.deepEqual(owner.splitCaptionText(cue, 1), [
    {...cue, text:'가', end:4, timing:'estimated'},
    {...cue, text:'👩‍👩‍👧‍👦', start:4, end:6, timing:'estimated'},
    {...cue, text:'나', start:6, timing:'estimated'},
  ]);
  assert.deepEqual(owner.splitCaptionAtOffset(cue, 1), [
    {...cue, text:'가', end:4, timing:'estimated'},
    {...cue, text:'👩‍👩‍👧‍👦나', start:4, timing:'estimated'},
  ]);
  assert.throws(() => owner.splitCaptionAtOffset(cue, 2), error => error.messageKey === 'errors.splitBoundary');
});

test('both import orders initialize exactly one eager caption segmenter and reuse the native module cache', () => {
  for (const first of ['ownerUrl', 'effectsUrl']) isolated(`
    const Original=Intl.Segmenter, trace=[];
    globalThis.Intl={get Segmenter(){trace.push('get');return class {
      constructor(locale,options){trace.push(['construct',locale,options]);return new Original(locale,options);}
    };}};
    const first=await import(${first});
    assert.deepEqual(trace,['get','get',['construct',undefined,{granularity:'grapheme'}]]);
    globalThis.Intl={get Segmenter(){throw new Error('must reuse captured segmenter');}};
    const owner=await import(ownerUrl), effects=await import(effectsUrl);
    assert.strictEqual(await import(${first}),first);
    assert.strictEqual(owner.splitCaptionText,effects.splitCaptionText);
    assert.strictEqual(owner.splitCaptionAtOffset,effects.splitCaptionAtOffset);
    assert.deepEqual(owner.splitCaptionText({text:'ab',start:0,end:2},1).map(cue=>cue.text),['a','b']);
    assert.equal(trace.length,3);
  `);
});

test('subtitle parser imports do not initialize or inspect a caption segmenter', () => {
  isolated(`
    globalThis.Intl={get Segmenter(){throw new Error('parser must not inspect Segmenter');}};
    const parser=await import(parserUrl);
    assert.equal(parser.MAX_CAPTIONS,10000);
    assert.strictEqual(await import(parserUrl),parser);
  `);
});

test('missing segmenter stays unavailable after import, without a codepoint or lazy fallback', () => {
  for (const unavailable of ['undefined', '{}', '{Segmenter:1}']) isolated(`
    const Original=Intl.Segmenter;
    globalThis.Intl=${unavailable};
    const owner=await import(ownerUrl);
    globalThis.Intl={Segmenter:Original};
    const effects=await import(effectsUrl);
    for(const module of [owner,effects])for(const name of ['splitCaptionText','splitCaptionAtOffset']){
      assert.strictEqual(module[name],owner[name]);
      assert.throws(()=>module[name]({text:'ab',start:0,end:2},1),error=>error.messageKey==='errors.safeSplit');
    }
  `);
});

test('segmenter getter and constructor failures remain eager and cached import failures', () => {
  for (const at of ['getter', 'constructor']) for (const first of ['ownerUrl', 'effectsUrl']) isolated(`
    const failure=new Error('generated initialization failure');let gets=0,constructs=0;
    globalThis.Intl={get Segmenter(){gets++;if(${JSON.stringify(at)}==='getter')throw failure;return class {
      constructor(){constructs++;throw failure;}
    };}};
    await assert.rejects(import(${first}),error=>error===failure);
    await assert.rejects(import(ownerUrl),error=>error===failure);
    await assert.rejects(import(effectsUrl),error=>error===failure);
    assert.equal(gets,${at === 'getter' ? 1 : 2});
    assert.equal(constructs,${at === 'getter' ? 0 : 1});
  `);
});
