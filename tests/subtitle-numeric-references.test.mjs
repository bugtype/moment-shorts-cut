import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {parseSubtitlesWithReport, MAX_SUBTITLE_BYTES} from '../dist/captions.mjs';
import {createDemoProject, projectSubtitles} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale, setLocale, getLocale} from '../dist/i18n.mjs';

const cue = text => `00:00:00,000 --> 00:00:01,000\n${text}`;
const parse = text => parseSubtitlesWithReport(cue(text), 12).captions[0].text;

test('complete decimal and hexadecimal references decode Korean, Chinese and supplementary scalars', () => {
  assert.equal(parse('&#54620;&#x4E2D; &#X1F30A; &#00065; &#x00004e2d;'), '한中 🌊 A 中');
  for (const code of [0x20, 0x7e, 0xa0, 0x200d, 0x200e, 0x200f, 0x3000, 0xd7ff, 0xe000, 0xfefe, 0xfeff, 0xfffd, 0x10000, 0x10fffd]) {
    const text = String.fromCodePoint(code);
    assert.equal(parse(`A&#${code};B&#x${code.toString(16)};C`), `A${text}B${text}C`);
  }
});

test('unsupported controls, separators, surrogates and noncharacters remain literal without HTML repairs', () => {
  const unsupported = [0, 1, 9, 10, 12, 13, 31, 127, 128, 159, 0x2028, 0x2029,
    0xd800, 0xdbff, 0xdc00, 0xdfff, 0xfdd0, 0xfdef, 0xfffe, 0xffff, 0x1fffe, 0x10ffff, 0x110000];
  for (const code of unsupported) {
    const text = `&#${code}; &#x${code.toString(16)};`;
    assert.equal(parse(text), text);
  }
  for (const text of ['&#;', '&#x;', '&#-1;', '&#+65;', '&#x-1;', '&#xGG;', '&#65', '&#x41', '&#65.0;', '&unknown;', '&AMP;'])
    assert.equal(parse(text), text);
});

test('numeric and named references decode together once, after markup stripping', () => {
  const text = '<b>&#54620;</b> &#60;b&#62;中&#60;/b&#62; &amp;#54620; &#38;#x4E2D; &amp;amp; &lt;i&gt;';
  assert.equal(parse(text), '한 <b>中</b> &#54620; &#x4E2D; &amp; <i>');
  assert.equal(parse('&amp;#xD800; &#38;amp; &amp;lt;'), '&#xD800; &amp; &lt;');
});

test('own SRT/VTT export preserves authored literal numeric spellings and decoded text without rescanning', () => {
  for (const format of ['srt', 'vtt']) {
    const project = createDemoProject(); project.clips = [{start: 2, end: 4}, {start: 2, end: 4}]; project.speed = 2;
    const text = ' &#54620; &#x4E2D; &amp;#65; &#9; <b>한中 🌊</b> ';
    project.captions = [{start: 2, end: 4, text}];
    const before = structuredClone(project);
    assert.deepEqual(parseSubtitlesWithReport(projectSubtitles(project, {format}), 12).captions,
      [{start: 0, end: 1, text}, {start: 1, end: 2, text}]);
    assert.deepEqual(project, before);
    project.captions[0].text = parse(' &#54620;&#x4E2D; &#x1F30A; ');
    assert.equal(parseSubtitlesWithReport(projectSubtitles(project, {format}), 12).captions[0].text, ' 한中 🌊 ');
  }
});

test('decoded whitespace is not retrimmed; unsupported newline controls stay literal', () => {
  assert.equal(parse('&#32;&#x3000;&#xFEFF;한&#xFEFF;&#x3000;&#32;'), ' \u3000\ufeff한\ufeff\u3000 ');
  assert.equal(parse('&#9;&#10;&#12;&#13;'), '&#9;&#10;&#12;&#13;');
  assert.equal(parse('&#32;'), ' ');
  assert.equal(parse('&nbsp;'), '\u00a0');
  const project = createDemoProject(); project.captions = [{start: 0, end: 1, text: parse('&#32;')}];
  assert.throws(() => projectSubtitles(project), /빈 줄/, 'decoding does not guarantee every cue is subtitle-exportable');
});

test('postdecode UTF-16 limits are exact and MCP errors remain atomic before a valid retry', async () => {
  assert.equal(parse('&#54620;'.repeat(2000)), '한'.repeat(2000));
  assert.equal(parse('&#x1F30A;'.repeat(1000)), '🌊'.repeat(1000));
  for (const text of ['&#54620;'.repeat(2001), '&#x1F30A;'.repeat(1001)])
    assert.throws(() => parse(text), /2,000/);
  let project = createDemoProject(), commits = 0;
  const original = structuredClone(project);
  const service = createEditorService({getProject: () => project, commitProject: next => {project = next; commits++;}});
  const adapter = createMcpToolAdapter({resolveService: () => service});
  for (const mode of ['replace', 'append']) {
    const error = await adapter.callTool('moment_captions_import', {projectId: 'session', text: cue('&#x1F30A;'.repeat(1001)), basis: 'source', mode, report: true});
    assert.equal(error.isError, true); assert.equal(error.structuredContent.error.code, 'INVALID_ARGUMENT');
    assert.deepEqual(project, original); assert.equal(commits, 0);
  }
  const valid = await adapter.callTool('moment_captions_import', {projectId: 'session', text: cue('&#54620;&#x4E2D;'), basis: 'source', report: true});
  assert.equal(valid.isError, false); assert.equal(commits, 1); assert.equal(project.captions[0].text, '한中');
  assert.deepEqual(valid.structuredContent.data.report, {acceptedCaptions: 1, clippedCaptions: 0, discardedRecognizedEntries: 0});
});

test('long numeric runs stay bounded and raw byte limits apply before decoding', () => {
  const module = JSON.stringify(new URL('../dist/captions.mjs', import.meta.url).href);
  const script = `import {parseSubtitlesWithReport} from ${module};
    const prefix='00:00:00,000 --> 00:00:01,000\\n';
    const value=parseSubtitlesWithReport(prefix+'&#'+'0'.repeat(1900000)+'54620;',12).captions[0].text;
    if(value!=='한') process.exit(1);
    for(const tail of [';', '']) {
      try { parseSubtitlesWithReport(prefix+'&#'+'9'.repeat(1900000)+tail,12); process.exit(2); }
      catch(error) { if(!error.message.includes('2,000')) throw error; }
    }
    console.log('bounded numeric decoding');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8', timeout: 10000});
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'bounded numeric decoding');
  assert.throws(() => parseSubtitlesWithReport(cue('&#' + '0'.repeat(MAX_SUBTITLE_BYTES) + '65;'), 12), /2 MiB/);
});

test('reviewed numeric-reference import preserves localized draft flow and one-step Undo', async () => {
  for (const locale of ['ko', 'en', 'zh-CN']) {
    const f = await createAppFixture(); initLocale({languages: [locale], document: f.doc, storage: null});
    try {
      assert.equal(getLocale(), locale, "the scenario must execute in its requested locale");
      assert.equal(f.doc.documentElement.lang, locale);
      vm.runInContext("switchPanel('captions');history=[];future=[];", f.context);
      const before = f.evaluate('state'); f.element('#importSrt').onclick({});
      f.element('#subtitleImportFile').files = [new Blob([cue('&#54620;&#x4E2D; &amp;#65;')])];
      f.element('#subtitleImportFile').onchange();
      const prepared = await f.element('#confirmSubtitleImport').onclick({});
      assert.equal(prepared.prepared, true); assert.deepEqual(f.evaluate('state'), before);
      await f.element('#confirmSubtitleImport').onclick({});
      assert.equal(f.evaluate('state.captions[0].text'), '한中 &#65;'); assert.equal(f.evaluate('history.length'), 1);
      vm.runInContext('undo()', f.context); assert.deepEqual(f.evaluate('state'), before);
    } finally {setLocale('ko'); initLocale({languages: ['ko'], document: null, storage: null});}
  }
});
