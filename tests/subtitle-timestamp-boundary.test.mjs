import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseSubtitlesWithReport} from '../dist/captions.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale, setLocale, getLocale} from '../dist/i18n.mjs';

const cue = (fraction, separator = '.', suffix = '') =>
  `00:00:00${separator}000 --> 00:00:01${separator}${fraction}${suffix}\n 한글 中文 English `;

test('overprecision end fractions reject instead of truncating for SRT and VTT line endings', () => {
  for (const separator of [',', '.']) for (const fraction of ['1234', '123456', '9999', '0000', '0'.repeat(100)]) {
    for (const newline of ['\n', '\r\n', '\r']) for (const settings of ['', ' align:start']) {
      const text = ('WEBVTT\n\n' + cue(fraction, separator, settings)).replaceAll('\n', newline);
      assert.throws(() => parseSubtitlesWithReport(text, 12), /유효한/);
    }
  }
});

test('extra fractional digits on either timestamp cannot be repaired by the parser', () => {
  for (const separator of [',', '.']) for (const start of [false, true]) {
    const text = start
      ? `00:00:00${separator}1234 --> 00:00:01${separator}000\ncaption`
      : cue('1234', separator);
    assert.throws(() => parseSubtitlesWithReport(text, 12));
  }
});

test('mixed files skip overprecision as unrecognized, not clipped or discarded recognized entries', () => {
  const text = [cue('1234'), cue('999', '.', ' align:start'), cue('123456'),
    '00:00.000 --> 00:20.000\nclipped'].join('\n\n');
  const result = parseSubtitlesWithReport(text, 12);
  assert.deepEqual(result.captions, [{start: 0, end: 1.999, text: ' 한글 中文 English '},
    {start: 0, end: 12, text: 'clipped'}]);
  assert.deepEqual(result.report, {acceptedCaptions: 2, clippedCaptions: 1, discardedRecognizedEntries: 0});
});

test('three-digit timestamps retain exact values, normal settings and existing permissive suffix handling', () => {
  for (const separator of [',', '.']) for (const fraction of ['000', '001', '123', '999']) {
    for (const suffix of ['', ' ', '\talign:start', ' position:50% line:0', 'junk', 'align:start']) {
      const result = parseSubtitlesWithReport(cue(fraction, separator, suffix), 12);
      assert.deepEqual(result.captions, [{start: 0, end: 1 + Number(fraction) / 1000, text: ' 한글 中文 English '}]);
    }
  }
});

test('MCP precision failure preserves replace/append state and can retry valid input with optional diagnostics', async () => {
  for (const basis of ['source', 'timeline']) for (const mode of ['replace', 'append']) for (const report of [false, true]) {
    let project = createDemoProject(), commits = 0;
    const original = structuredClone(project);
    const service = createEditorService({getProject: () => project, commitProject: next => {project = next; commits++;}});
    const adapter = createMcpToolAdapter({resolveService: () => service});
    const args = {projectId: 'session', text: cue('1234'), basis, mode, report};
    const rejected = await adapter.callTool('moment_captions_import', args);
    assert.equal(rejected.isError, true); assert.equal(rejected.structuredContent.error.code, 'INVALID_ARGUMENT');
    assert.equal(rejected.structuredContent.error.path, 'arguments.text');
    assert.deepEqual(project, original); assert.equal(commits, 0);
    assert.equal(Object.hasOwn(rejected.structuredContent, 'data'), false);
    const valid = await adapter.callTool('moment_captions_import', {...args, text: cue('123')});
    assert.equal(valid.isError, false); assert.equal(commits, 1);
    assert.equal(project.captions.at(-1).end, 1.123);
    if (mode === 'append') assert.deepEqual(project.captions.slice(0, -1), original.captions);
    if (report) assert.deepEqual(valid.structuredContent.data.report,
      {acceptedCaptions: 1, clippedCaptions: 0, discardedRecognizedEntries: 0});
    else assert.equal(Object.hasOwn(valid.structuredContent.data, 'report'), false);
  }
});

test('reviewed import reports invalid precision in all locales without edits and valid retry supports Undo', async () => {
  for (const locale of ['ko', 'en', 'zh-CN']) {
    const f = await createAppFixture(); initLocale({languages: [locale], document: f.doc, storage: null});
    try {
      assert.equal(getLocale(), locale, "the scenario must execute in its requested locale");
      assert.equal(f.doc.documentElement.lang, locale);
      vm.runInContext("switchPanel('captions');history=[];future=[];", f.context);
      const before = f.evaluate('({state,history,future})');
      f.element('#importSrt').onclick({});
      const choose = text => {f.element('#subtitleImportFile').files = [new Blob([text])]; f.element('#subtitleImportFile').onchange();};
      choose(cue('1234'));
      const rejected = await f.element('#confirmSubtitleImport').onclick({});
      assert.equal(rejected.ok, false); assert.deepEqual(f.evaluate('({state,history,future})'), before);
      assert.equal(f.element('#modal').open, true); assert.equal(f.element('#confirmSubtitleImport').disabled, false);
      assert.equal(f.element('#subtitleImportReport').innerHTML, '');
      choose(cue('123'));
      const prepared = await f.element('#confirmSubtitleImport').onclick({}); assert.equal(prepared.prepared, true);
      await f.element('#confirmSubtitleImport').onclick({});
      assert.equal(f.evaluate('state.captions[0].end'), 1.123); assert.equal(f.evaluate('history.length'), 1);
      vm.runInContext('undo()', f.context); assert.deepEqual(f.evaluate('state'), before.state);
    } finally {setLocale('ko'); initLocale({languages: ['ko'], document: null, storage: null});}
  }
});
