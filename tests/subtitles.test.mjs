import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSubtitles, MAX_SUBTITLE_BYTES} from '../dist/captions.mjs';

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
