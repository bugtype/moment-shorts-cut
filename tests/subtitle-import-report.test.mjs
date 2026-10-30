import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubtitles, parseSubtitlesWithReport, MAX_CAPTIONS, MAX_SUBTITLE_BYTES } from '../dist/captions.mjs';
import { LocalizedError } from '../dist/core/validation.mjs';
import { message as msg } from '../dist/i18n.mjs';

// Frozen pre-report parser oracle: preserve acceptance, order and error precedence.
const encoder = new TextEncoder();
const subtitleReferences = {amp:'&',lt:'<',gt:'>',lrm:'\u200e',rlm:'\u200f',nbsp:'\u00a0'};
function legacyParseSubtitles(text, duration) {
  if (typeof text !== 'string' || text.length > MAX_SUBTITLE_BYTES || encoder.encode(text).byteLength > MAX_SUBTITLE_BYTES) throw new LocalizedError(msg('errors.subtitleFileLimit'));
  if (!Number.isFinite(duration) || duration <= 0) throw new LocalizedError(msg('errors.videoDuration'));
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  // An empty first payload line ends the cue; never absorb the next cue's timing.
  const pattern = /^(?:(\d{1,2}):)?([0-5]\d):([0-5]\d)[,.](\d{3})[ \t]*-->[ \t]*(?:(\d{1,2}):)?([0-5]\d):([0-5]\d)[,.](\d{3})[^\n]*\n(?![ \t]*(?:\n|$))([\s\S]*?)(?=\n[ \t]*\n|(?![\s\S]))/gm;
  const captions = [];
  for (const match of normalized.matchAll(pattern)) {
    const start = (+match[1] || 0) * 3600 + (+match[2]) * 60 + (+match[3]) + (+match[4]) / 1000;
    const end = Math.min((+match[5] || 0) * 3600 + (+match[6]) * 60 + (+match[7]) + (+match[8]) / 1000, duration);
    // Decode once after removing markup, so escaped literal tags remain text.
    const text = match[9].replace(/<[^>]*>/g, '').trim()
      .replace(/&(amp|lt|gt|lrm|rlm|nbsp);/g, (_, name) => subtitleReferences[name]);
    if (!text || end <= start) continue;
    if (text.length > 2000) throw new LocalizedError(msg('errors.cueLength'));
    if (captions.length >= MAX_CAPTIONS) throw new LocalizedError(msg('errors.captionLimit'));
    captions.push({start, end, text});
  }
  if (!captions.length) throw new LocalizedError(msg('errors.noSubtitles'));
  return captions;
}


const cue = (start, end, text) => `${start} --> ${end}\n${text}`;
const valid = cue('00:00:00,000', '00:00:02,000', 'accepted');
function outcome(parse, text, duration) {
  try { return { captions: parse(text, duration) }; }
  catch (error) { return { name: error.name, message: error.message, code: error.code, path: error.path }; }
}

test('reports accepted clipping and discarded recognized entries without counting malformed blocks', () => {
  const input = [
    valid,
    cue('00:00:10,000', '00:00:15,000', 'clipped'),
    cue('00:00:13,000', '00:00:15,000', 'outside'),
    cue('00:99:00,000', '00:00:01,000', 'unrecognized'),
    cue('00:00:04,000', '00:00:03,000', 'reversed'),
    cue('00:00:05,000', '00:00:06,000', '<i></i>'),
  ].join('\n\n');
  assert.deepEqual(parseSubtitlesWithReport(input, 12), {
    captions: [{ start: 0, end: 2, text: 'accepted' }, { start: 10, end: 12, text: 'clipped' }],
    report: { acceptedCaptions: 2, clippedCaptions: 1, discardedRecognizedEntries: 3 },
  });
  assert.deepEqual(parseSubtitles(input, 12), legacyParseSubtitles(input, 12));
});

test('clipped count excludes discarded entries and exact-duration ends', () => {
  const input = [valid, cue('00:00:01,000', '00:00:15,000', '<b></b>'),
    cue('00:00:13,000', '00:00:15,000', 'outside')].join('\n\n');
  assert.deepEqual(parseSubtitlesWithReport(input, 2).report,
    { acceptedCaptions: 1, clippedCaptions: 0, discardedRecognizedEntries: 2 });
  assert.deepEqual(parseSubtitlesWithReport(valid, .25).captions,
    [{ start: 0, end: .25, text: 'accepted' }]);
  assert.equal(parseSubtitlesWithReport(valid, .25).report.clippedCaptions, 1);
});

test('hour fields accept long and zero-padded values without changing clipping or legacy shorthand', () => {
  for (const separator of [',', '.']) {
    const input = [
      cue(`99:59:59${separator}000`, `100:00:01${separator}000`, 'boundary'),
      cue(`000:00:02${separator}000`, `000:00:03${separator}000`, 'padded'),
      cue(`0:00:04${separator}000`, `00:05${separator}000`, 'legacy'),
      cue(`100:00:00${separator}000`, `100:00:02${separator}000`, 'clipped'),
      cue(`100:00:02${separator}000`, `100:00:03${separator}000`, 'outside'),
      cue(`100:00:00${separator}000`, `99:59:59${separator}000`, 'reversed'),
      cue(`100:60:00${separator}000`, `101:00:01${separator}000`, 'invalid minutes'),
      cue(`100:00:00${separator}000`, `100:00:01${separator}0000`, 'invalid fraction'),
    ].join('\n\n');
    assert.deepEqual(parseSubtitlesWithReport(input, 360001), {
      captions: [{start:359999,end:360001,text:'boundary'}, {start:2,end:3,text:'padded'},
        {start:4,end:5,text:'legacy'}, {start:360000,end:360001,text:'clipped'}],
      report: {acceptedCaptions:4,clippedCaptions:1,discardedRecognizedEntries:2},
    });
  }
});

test('overflowing hour fields are discarded before text limits and cannot become clipped cues', () => {
  // Cover numeric conversion overflow and finite hours that overflow during * 3600.
  for (const hours of ['9'.repeat(400), '1' + '0'.repeat(307)]) {
    for (const [start, end] of [[`${hours}:00:00,000`, `${hours}:00:01,000`], ['00:00:00,000', `${hours}:00:01,000`]]) {
      const invalid = cue(start, end, 'x'.repeat(2001));
      assert.deepEqual(parseSubtitlesWithReport(`${valid}\n\n${invalid}`, 12), {
        captions: [{start:0,end:2,text:'accepted'}],
        report: {acceptedCaptions:1,clippedCaptions:0,discardedRecognizedEntries:1},
      });
      assert.throws(() => parseSubtitlesWithReport(invalid, 12), error => error.messageKey === 'errors.noSubtitles');
    }
  }
});

test('legacy wrapper and detailed parser preserve permissive NOTE/STYLE and decoding behavior', () => {
  const cases = [
    valid,
    '\uFEFFWEBVTT\r\n\r\nlabel\r\n00:00.000 --> 00:01.000 align:start\r\n<b>한글</b> &amp; &lt;i&gt;literal&lt;/i&gt;',
    `WEBVTT\n\nNOTE comment\n${valid}\n\nSTYLE\n::cue {color:red;}\n\n${valid}`,
    `${valid}\n\n${cue('00:00:00,000', '00:00:01,000', '&nbsp;')}`,
    `${cue('00:00:01,000', '00:00:02,000', 'later')}\n\n${valid}`,
    `${cue('00:00:00,000', '00:00:01,000', 'line1\nline2\0')}\n\n${valid}`,
    `00:00:00,000 --> 00:00:01,000\n\nignored\n\n${valid}`,
  ];
  for (const input of cases) {
    for (const duration of [.001, .5, 1, 12, 86400]) {
      const baseline = outcome(legacyParseSubtitles, input, duration);
      assert.deepEqual(outcome(parseSubtitles, input, duration), baseline);
      assert.deepEqual(outcome((text, total) => parseSubtitlesWithReport(text, total).captions, input, duration), baseline);
    }
  }
  const note = parseSubtitlesWithReport(`WEBVTT\n\nNOTE comment\n${valid}`, 12);
  assert.equal(note.report.acceptedCaptions, 1); // Existing quirk, not standards validation.
});

test('all-none, input limits and error precedence remain exactly the legacy parser', () => {
  const cases = [
    ['', 12], ['WEBVTT\n\nNOTE only a comment', 12], ['malformed --> timing\npayload', 12],
    [cue('00:00:13,000', '00:00:15,000', 'outside'), 12],
    [cue('00:00:00,000', '00:00:01,000', '<b></b>'), 12],
    [valid, 0], [valid, NaN], [valid, Infinity], [null, 0],
    ['a'.repeat(MAX_SUBTITLE_BYTES + 1), 0], ['한'.repeat(700000), 12],
    [cue('00:00:00,000', '00:00:01,000', 'x'.repeat(2001)), 12],
    [Array.from({ length: MAX_CAPTIONS + 1 }, () => valid).join('\n\n'), 12],
  ];
  for (const [input, duration] of cases) {
    const baseline = outcome(legacyParseSubtitles, input, duration);
    assert.equal(Object.hasOwn(baseline, 'captions'), false);
    assert.deepEqual(outcome(parseSubtitles, input, duration), baseline);
    assert.deepEqual(outcome((text, total) => parseSubtitlesWithReport(text, total).captions, input, duration), baseline);
  }
});

test('each call returns independent report and caption records at the full caption limit', () => {
  const input = Array.from({ length: MAX_CAPTIONS }, () => valid).join('\n\n');
  const first = parseSubtitlesWithReport(input, 12);
  assert.deepEqual(first.report, { acceptedCaptions: 10000, clippedCaptions: 0, discardedRecognizedEntries: 0 });
  first.report.acceptedCaptions = -1;
  first.captions[0].text = 'changed';
  const second = parseSubtitlesWithReport(input, 12);
  assert.equal(second.report.acceptedCaptions, 10000);
  assert.equal(second.captions[0].text, 'accepted');
});
