import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSubtitles, MAX_SUBTITLE_BYTES} from '../dist/captions.mjs';
import {createDemoProject, projectSrt} from '../dist/core/project.mjs';
import {CommandError} from '../dist/core/validation.mjs';

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

test('SRT export rejects ambiguous blank lines without changing authored text or timing', () => {
  for (const text of ['', ' \t', '\nfirst', 'first\n', 'first\n\nsecond', 'first\n \t\nsecond', 'first\n\n\nsecond', 'first\r\n\r\nsecond', 'first\r\rsecond']) {
    const project=createDemoProject();
    project.captions=[{start:0,end:2,text}];
    const before=structuredClone(project);
    assert.throws(()=>projectSrt(project), error=>error instanceof CommandError && error.code==='INVALID_ARGUMENT' && /빈 줄/.test(error.message), JSON.stringify(text));
    assert.deepEqual(project,before);
  }
  const project=createDemoProject();
  project.clips=[{start:2,end:4}];
  project.captions=[{start:0,end:1,text:'not\n\nexported'}];
  assert.equal(projectSrt(project),'','removed cues do not block an empty export');
});

test('ordinary multiline SRT retains numeric and timestamp-looking text without inventing cues', () => {
  for (const newline of ['\n','\r\n','\r']) {
    const project=createDemoProject();
    const lines=['first & <b>literal</b>','2','00:00:03,000 --> 00:00:04,000','last'];
    project.captions=[{start:0,end:2,text:lines.join(newline)}];
    const srt=projectSrt(project);
    assert.ok(!srt.includes('\r'));
    assert.deepEqual(parseSubtitles(srt,12),[{start:0,end:2,text:lines.join('\n')}]);
    assert.equal(project.captions[0].text,lines.join(newline));
  }
});

test('empty and malformed imported cues never consume the following valid cue', () => {
  for (const newline of ['\n','\r\n']) {
    for (const blank of ['', ' \t']) {
      const content=['1','00:00:00,000 --> 00:00:01,000',blank,'2','00:00:02,000 --> 00:00:03,000','Keep me','','','3','00:99:00,000 --> 00:99:01,000','invalid','','4','00:00:04,000 --> 00:00:05,000','123','00:00:06,000 --> 00:00:07,000','literal text'].join(newline);
      assert.deepEqual(parseSubtitles(content,12),[{start:2,end:3,text:'Keep me'},{start:4,end:5,text:'123\n00:00:06,000 --> 00:00:07,000\nliteral text'}]);
    }
  }
});
