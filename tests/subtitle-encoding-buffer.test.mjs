import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoProject, projectSubtitles} from '../dist/core/project.mjs';

const NativeEncoder = TextEncoder;
const formats = ['srt', 'vtt', 'txt'];
function project(texts) {
  const p = createDemoProject();
  p.clips = [{start:0,end:1}];
  p.captions = texts.map(text => ({start:0,end:1,text}));
  return p;
}
function withEncoder(Encoder, run) {
  const previous = globalThis.TextEncoder;
  globalThis.TextEncoder = Encoder;
  try { return run(); } finally { globalThis.TextEncoder = previous; }
}
function oneCue(format, text) {
  if (format === 'txt') return text + '\n';
  const stamp = format === 'vtt' ? '.' : ',';
  const escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\u00a0/g,'&nbsp;');
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + `1\n00:00:00${stamp}000 --> 00:00:01${stamp}000\n${escaped}\n`;
}

test('subtitle counting reuses one destination per export without retaining it across calls', () => {
  const p = project(Array.from({length:16},(_,i) => `한글 ${i} e\u0301 🎬 &<>\u00a0`));
  const before = JSON.stringify(p), destinations = new Set();
  for (const format of formats) for (const bom of [false,true]) {
    const expected = projectSubtitles(p,{format,bom}), encoded = [], into = [];
    class Encoder extends NativeEncoder {
      encode(text) { encoded.push(text); return super.encode(text); }
      encodeInto(text,destination) {
        into.push(destination);
        assert.ok(this instanceof Encoder);
        return super.encodeInto(text,destination);
      }
    }
    assert.equal(withEncoder(Encoder,() => projectSubtitles(p,{format,bom})),expected);
    assert.equal(into.length,16);
    assert.equal(new Set(into).size,1);
    assert.equal(into[0].byteLength,8192);
    assert.ok(!destinations.has(into[0])); destinations.add(into[0]);
    assert.deepEqual(encoded,[format === 'vtt' ? 'WEBVTT\n\n' : '']);
    assert.equal(JSON.stringify(p),before);
  }
  assert.equal(destinations.size,6);
});

test('final chunk capacity uses UTF16 worst-case bounds and keeps larger chunks on encode', () => {
  for (const format of formats) for (const target of [2729,2730,2731]) {
    const headerLength = format === 'vtt' ? 8 : 0;
    const fixed = oneCue(format,'X').length - headerLength - 1;
    const units = target - fixed;
    // TXT exercises three-byte BMP at the direct helper boundary; escaped NBSP
    // reaches the same serialized boundary while staying below the authored cap.
    const text = format === 'txt' ? '漢'.repeat(units)
      : '\u00a0'.repeat(Math.floor(units/6)) + '漢'.repeat(units%6);
    const expected = oneCue(format,text), encoded = [], into = [];
    assert.equal(expected.length-headerLength,target);
    class Encoder extends NativeEncoder {
      encode(value) { encoded.push(value); return super.encode(value); }
      encodeInto(value,destination) {
        const result = super.encodeInto(value,destination); into.push(result);
        assert.equal(result.read,value.length);
        assert.equal(result.written,Buffer.byteLength(value));
        return result;
      }
    }
    assert.equal(withEncoder(Encoder,() => projectSubtitles(project([text]),{format})),expected);
    assert.equal(into.length,target<=2730 ? 1 : 0);
    assert.equal(encoded.length,target<=2730 ? 1 : 2);
  }
});

test('missing optional encoding and incomplete or invalid progress use full encoding without undercount', () => {
  const p = project(['한글 🎬 &<>','e\u0301']);
  for (const format of formats) {
    const expected = projectSubtitles(p,{format});
    for (const optional of [undefined,null,42]) {
      let calls = 0;
      class Encoder extends NativeEncoder {
        constructor() { super(); this.encodeInto=optional; }
        encode(text) { calls++; return super.encode(text); }
      }
      assert.equal(withEncoder(Encoder,() => projectSubtitles(p,{format})),expected);
      assert.equal(calls,3);
    }
    for (const progress of [text=>({read:0,written:0}),text=>({read:text.length-1,written:1}),
      text=>({read:text.length,written:-1}),text=>({read:text.length,written:NaN}),
      text=>({read:text.length,written:8193})]) {
      let calls = 0, attempts = 0;
      class Encoder extends NativeEncoder {
        encode(text) { calls++; return super.encode(text); }
        encodeInto(text) { attempts++; return progress(text); }
      }
      assert.equal(withEncoder(Encoder,() => projectSubtitles(p,{format})),expected);
      assert.equal(attempts,2); assert.equal(calls,3);
    }
  }
});

test('encoder construction and header errors stay before projection and text errors before optional encoding', () => {
  const failure = new Error('encoder failed'), p = project(['valid']);
  Object.defineProperty(p.captions[0],'text',{get(){throw new Error('projection reached');}});
  for (const Encoder of [class {constructor(){throw failure;}},class {encode(){throw failure;}}])
    assert.throws(() => withEncoder(Encoder,() => projectSubtitles(p)),error=>error===failure);
  for (const [text,key] of [['x\0\ud800','errors.srtNul'],['\ud800','errors.textUnicode'],[' \t\n\0','errors.subtitleBlank']]) {
    let attempts = 0;
    class Encoder extends NativeEncoder { encodeInto(...args) {attempts++; return super.encodeInto(...args);} }
    assert.throws(() => withEncoder(Encoder,() => projectSubtitles(project([text]))),error=>error.messageKey===key);
    assert.equal(attempts,0);
  }
});
