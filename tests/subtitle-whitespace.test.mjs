import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {parseSubtitlesWithReport} from '../dist/captions.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale, setLocale, getLocale} from '../dist/i18n.mjs';

const cue = text => `00:00:00,000 --> 00:00:01,000\n${text}`;

test('subtitle payload preserves boundary spaces, tabs and Unicode whitespace', () => {
  for (const text of ['  indented\nlast line  ', '\t한글 中文 English\t', '\u2003wide\u3000', '\ufeffinside cue\ufeff']) {
    for (const newline of ['\n', '\r\n', '\r']) for (const ending of ['', newline, newline + newline, newline + ' \t']) {
      const input = ('WEBVTT\n\n' + cue(text)).replaceAll('\n', newline) + ending;
      assert.deepEqual(parseSubtitlesWithReport(input, 12), {
        captions: [{start: 0, end: 1, text}],
        report: {acceptedCaptions: 1, clippedCaptions: 0, discardedRecognizedEntries: 0},
      });
    }
  }
});

test('strip markup and decode references once without trimming adjacent text', () => {
  const input = cue('  <b>한글</b> &amp;lt;b&amp;gt; &nbsp;\t\nlast  ') + '\n';
  assert.equal(parseSubtitlesWithReport(input, 12).captions[0].text,
    '  한글 &lt;b&gt; \u00a0\t\nlast  ');
  assert.equal(parseSubtitlesWithReport(cue('<b>\ntext\n</b>'), 12).captions[0].text, 'text');
  assert.equal(parseSubtitlesWithReport(cue('<b> \n  text \n\t</b>'), 12).captions[0].text, '  text ');
});

test('empty markup remains discarded and structural final lines do not become cue text', () => {
  const result = parseSubtitlesWithReport([cue('<b> \t</b>'), cue('<i>\n</i>'), cue('&nbsp;'), cue(' kept ') + '\n'].join('\n\n'), 12);
  assert.deepEqual(result.captions.map(c => c.text), ['\u00a0', ' kept ']);
  assert.deepEqual(result.report, {acceptedCaptions: 2, clippedCaptions: 0, discardedRecognizedEntries: 2});
  assert.equal(parseSubtitlesWithReport(cue('no extra newline') + '\n \t', 12).captions[0].text, 'no extra newline');
});

test('cue limit includes preserved whitespace and rejects rather than silently trimming', () => {
  const text = ' ' + 'x'.repeat(1998) + '\t';
  assert.equal(parseSubtitlesWithReport(cue(text) + '\n', 12).captions[0].text, text);
  for (const over of [' ' + text, text + ' ', '\t' + 'x'.repeat(2000)])
    assert.throws(() => parseSubtitlesWithReport(cue(over), 12), /2,000/);
});

test('markup-generated interior blank lines remain bounded before cue-length rejection', () => {
  const script = `import {parseSubtitlesWithReport} from ${JSON.stringify(new URL('../dist/captions.mjs', import.meta.url).href)};
    try { parseSubtitlesWithReport('00:00:00,000 --> 00:00:01,000\\nA\\n' + '<i></i>\\n'.repeat(100000) + 'Z', 12); }
    catch (error) { if (error.message.includes('2,000')) { console.log('bounded rejection'); process.exit(0); } throw error; }
    process.exit(1);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8', timeout: 10000});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'bounded rejection');
});

test('SRT and VTT service export/import preserve literal boundary whitespace after cuts and speed', async () => {
  for (const format of ['srt', 'vtt']) for (const mode of ['replace', 'append']) {
    let project = createDemoProject();
    project.clips = [{start: 2, end: 4}, {start: 2, end: 4}];
    project.speed = 2;
    const text = ' \t한글 <literal> &\n中文 English  ';
    project.captions = [{start: 2, end: 4, text}];
    const original = structuredClone(project);
    const service = createEditorService({getProject: () => project, commitProject: next => { project = next; }});
    const exported = await service.execute('captions.export', {format});
    assert.equal(exported.ok, true);
    assert.deepEqual(project, original);
    const imported = await service.execute('captions.import', {text: exported.data.text, basis: 'timeline', mode});
    assert.equal(imported.ok, true);
    assert.deepEqual(project.captions.slice(mode === 'append' ? 1 : 0), [
      {start: 0, end: 1, text, basis: 'timeline'}, {start: 1, end: 2, text, basis: 'timeline'},
    ], 'import keeps the explicit pre-speed API clock; it does not undo export speed');
    if (mode === 'append') assert.deepEqual(project.captions[0], original.captions[0]);
  }
});

test('MCP rejects overlong preserved text atomically and recovers on the next valid import', async () => {
  let project = createDemoProject(), commits = 0;
  const service = createEditorService({getProject: () => project, commitProject: next => {project = next; commits++;}});
  const adapter = createMcpToolAdapter({resolveService: () => service});
  const before = structuredClone(project);
  const invalid = await adapter.callTool('moment_captions_import', {projectId: 'session', basis: 'source', text: cue(' ' + 'x'.repeat(2000))});
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.deepEqual(project, before);
  assert.equal(commits, 0);
  const valid = await adapter.callTool('moment_captions_import', {projectId: 'session', basis: 'source', text: cue(' recovered ')});
  assert.equal(valid.isError, false);
  assert.equal(project.captions[0].text, ' recovered ');
  assert.equal(commits, 1);
});

test('reviewed subtitle UI import keeps literal whitespace in all locales and Undo restores captions', async () => {
  for (const locale of ['ko', 'en', 'zh-CN']) {
    const f = await createAppFixture();
    initLocale({languages: [locale], document: f.doc, storage: null});
    try {
      assert.equal(getLocale(), locale, "the scenario must execute in its requested locale");
      assert.equal(f.doc.documentElement.lang, locale);
      vm.runInContext("switchPanel('captions');history=[];future=[];", f.context);
      const before = f.evaluate('state');
      const text = '\t 한글 中文 English \t';
      f.element('#importSrt').onclick({});
      f.element('#subtitleImportFile').files = [new Blob([cue(text) + '\n'])];
      f.element('#subtitleImportFile').onchange();
      const prepared = await f.element('#confirmSubtitleImport').onclick({});
      assert.equal(prepared.prepared, true);
      assert.deepEqual(f.evaluate('state'), before);
      await f.element('#confirmSubtitleImport').onclick({});
      assert.equal(f.evaluate('state.captions[0].text'), text);
      assert.equal(f.evaluate('history.length'), 1);
      vm.runInContext('undo()', f.context);
      assert.deepEqual(f.evaluate('state'), before);
    } finally {setLocale('ko'); initLocale({languages: ['ko'], document: null, storage: null});}
  }
});
