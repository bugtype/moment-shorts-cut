import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSubtitles, MAX_SUBTITLE_BYTES} from '../dist/captions.mjs';
import {createDemoProject, projectSrt} from '../dist/core/project.mjs';

test('SRT/VTT imports support CRLF, cue IDs, settings, multiline text and end clipping', () => {
  assert.deepEqual(parseSubtitles('1\r\n00:00:01,250 --> 00:00:03,000\r\n첫째\r\n둘째\r\n', 2), [{start:1.25,end:2,text:'첫째\n둘째'}]);
  assert.deepEqual(parseSubtitles('WEBVTT\n\ncue-id\n00:01.000 --> 00:03.000 align:start\n<b>안녕</b> 🌊\n', 12), [{start:1,end:3,text:'안녕 🌊'}]);
});

test('invalid timestamp fields, reversed intervals, empty and out-of-range cues are rejected', () => {
  for (const content of [
    '00:99.000 --> 01:40.000\nbad',
    '00:02.000 --> 00:01.000\nbad',
    '00:13.000 --> 00:14.000\noutside',
    '00:01.000 --> 00:02.000\n<b></b>',
    'not subtitles',
  ]) assert.throws(() => parseSubtitles(content, 12));
});

test('subtitle input and cue limits fail explicitly without truncating authored text', () => {
  assert.throws(() => parseSubtitles('x'.repeat(MAX_SUBTITLE_BYTES + 1), 12), /2 MB/);
  assert.throws(() => parseSubtitles('00:01.000 --> 00:02.000\n' + 'x'.repeat(2001), 12), /2,000/);
  assert.throws(() => parseSubtitles(('00:01.000 --> 00:02.000\nx\n\n').repeat(10001), 12), /10,000/);
});

test('subtitle references decode once after markup removal, preserving literal tags and unknown references', () => {
  const payload = '<v Speaker><b>Tom &amp; Jerry</b></v>\n&lt;b&gt;한글 🌊&lt;/b&gt; &amp;lt; &unknown; &amp &AMP;';
  const expected = 'Tom & Jerry\n<b>한글 🌊</b> &lt; &unknown; &amp &AMP;';
  for (const header of ['', 'WEBVTT\n\n']) {
    assert.deepEqual(parseSubtitles(`${header}00:01.000 --> 00:02.000\n${payload}`, 12), [{start:1,end:2,text:expected}]);
  }
  assert.equal(parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000\n&nbsp;&lrm;שלום&rlm;&nbsp;', 12)[0].text, '\u00a0\u200eשלום\u200f\u00a0');
});

test('subtitle limits count decoded text without silently truncating it', () => {
  const cue = 'WEBVTT\n\n00:01.000 --> 00:02.000\n';
  assert.equal(parseSubtitles(cue + '&amp;'.repeat(2000), 12)[0].text, '&'.repeat(2000));
  assert.throws(() => parseSubtitles(cue + '&amp;'.repeat(2001), 12), /2,000/);
});

test('SRT export/reimport preserves literal text through repeated clips and speed changes', () => {
  const project = createDemoProject();
  const text = '\u00a0<b>한글 🌊</b> & &amp; &lt; &unknown;\n2 < 3 > 1\u200eשלום\u200f\u00a0';
  project.clips = [{start:2,end:4},{start:2,end:4}];
  project.speed = 2;
  project.captions = [{start:2,end:4,text}];
  const before = structuredClone(project);
  const srt = projectSrt(project);
  assert.ok(srt.includes('&lt;b&gt;한글 🌊&lt;/b&gt; &amp; &amp;amp; &amp;lt; &amp;unknown;'));
  const expected = [{start:0,end:1,text},{start:1,end:2,text}];
  assert.deepEqual(parseSubtitles(srt, 2), expected);
  assert.deepEqual(project, before, 'export must not modify project text');
  const imported = {...project,clips:[{start:0,end:2}],speed:1,captions:expected};
  assert.deepEqual(parseSubtitles(projectSrt(imported), 2), expected, 'a second round trip must not decode text again');
});
