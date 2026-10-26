import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {parseSubtitlesWithReport} from '../dist/captions.mjs';
import {createDemoProject, projectSubtitles} from '../dist/core/project.mjs';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale, setLocale} from '../dist/i18n.mjs';

const cue = text => `00:00.000 --> 00:01.000\n${text}`;

test('complete markup is removed but an unclosed tail stays literal', () => {
  const cases = [
    ['<', '<'], ['<<<', '<<<'], ['A<unfinished', 'A<unfinished'],
    ['<b>한中</b><unfinished', '한中<unfinished'],
    ['before <<nested> after <open', 'before  after <open'],
    ['> standalone > <unfinished', '> standalone > <unfinished'],
    ['<b\nclass=x> text </b>\n<unfinished\n tail ', ' text \n<unfinished\n tail '],
    [' <b> </b><open\t', '  <open\t'],
  ];
  for (const [input, expected] of cases) for (const newline of ['\n', '\r\n', '\r']) {
    const result = parseSubtitlesWithReport(cue(input).replaceAll('\n', newline), 12);
    assert.deepEqual(result.captions, [{start: 0, end: 1, text: expected}]);
    assert.deepEqual(result.report, {acceptedCaptions: 1, clippedCaptions: 0, discardedRecognizedEntries: 0});
  }
});

test('references still decode once after markup removal, including an unclosed literal tail', () => {
  assert.equal(parseSubtitlesWithReport(cue('<b>&#54620;</b> &lt;i&gt; &amp;lt; <open&#x4E2D;'), 12).captions[0].text,
    '한 <i> &lt; <open中');
  assert.equal(parseSubtitlesWithReport(cue('<b>\n</b>') + '\n\n' + cue('<open'), 12).report.discardedRecognizedEntries, 1);
  const project = createDemoProject(); project.captions = [{start: 0, end: 1, text: ' 한中 <unclosed &amp;#65; '}];
  for (const format of ['srt', 'vtt'])
    assert.equal(parseSubtitlesWithReport(projectSubtitles(project, {format}), 12).captions[0].text, project.captions[0].text);
});

test('maximum-budget unmatched markup rejects promptly without changing MCP state and permits retry', () => {
  const module = name => JSON.stringify(new URL(`../dist/${name}`, import.meta.url).href);
  const script = `import assert from 'node:assert/strict';
    import {parseSubtitlesWithReport, MAX_SUBTITLE_BYTES} from ${module('captions.mjs')};
    import {createDemoProject} from ${module('core/project.mjs')};
    import {createEditorService} from ${module('integration/editor-service.mjs')};
    import {createMcpToolAdapter} from ${module('integration/mcp-adapter.mjs')};
    const prefix='00:00.000 --> 00:01.000\\n';
    for(const lead of ['', '<b>kept</b>']) {
      const input=prefix+lead+'<'.repeat(MAX_SUBTITLE_BYTES-prefix.length-lead.length);
      assert.equal(Buffer.byteLength(input), MAX_SUBTITLE_BYTES);
      assert.throws(()=>parseSubtitlesWithReport(input,12), /2,000/);
    }
    const complete=prefix+'<'.repeat(MAX_SUBTITLE_BYTES-prefix.length-2)+'>A';
    assert.equal(parseSubtitlesWithReport(complete,12).captions[0].text,'A');
    let project=createDemoProject(),commits=0;
    const before=structuredClone(project);
    const service=createEditorService({getProject:()=>project,commitProject:next=>{project=next;commits++;}});
    const adapter=createMcpToolAdapter({resolveService:()=>service});
    for(const mode of ['replace','append']) {
      const result=await adapter.callTool('moment_captions_import',{projectId:'session',text:prefix+'<'.repeat(99000),basis:'source',mode,report:true});
      assert.equal(result.isError,true);assert.equal(result.structuredContent.error.code,'INVALID_ARGUMENT');
      assert.equal(result.structuredContent.error.path,'arguments.text');
      assert.deepEqual(project,before);assert.equal(commits,0);
    }
    const valid=await adapter.callTool('moment_captions_import',{projectId:'session',text:prefix+'<b>한中</b><open',basis:'source',report:true});
    assert.equal(valid.isError,false);assert.equal(project.captions[0].text,'한中<open');assert.equal(commits,1);
    console.log('bounded markup scan and atomic retry');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8', timeout: 10000});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'bounded markup scan and atomic retry');
});

test('unclosed-markup length errors preserve localized import review and valid retry Undo', async () => {
  for (const locale of ['ko', 'en', 'zh-CN']) {
    const f = await createAppFixture(); initLocale({locale, document: f.doc, storage: null});
    try {
      vm.runInContext("switchPanel('captions');history=[];future=[];", f.context);
      const before = f.evaluate('({state,history,future})'); f.element('#importSrt').onclick({});
      const choose = text => {f.element('#subtitleImportFile').files = [new Blob([cue(text)])]; f.element('#subtitleImportFile').onchange();};
      choose('<'.repeat(2001));
      assert.equal((await f.element('#confirmSubtitleImport').onclick({})).ok, false);
      assert.deepEqual(f.evaluate('({state,history,future})'), before);
      assert.equal(f.element('#modal').open, true); assert.equal(f.element('#confirmSubtitleImport').disabled, false);
      assert.equal(f.element('#subtitleImportReport').innerHTML, '');
      choose('<b>한中</b><open');
      assert.equal((await f.element('#confirmSubtitleImport').onclick({})).prepared, true);
      await f.element('#confirmSubtitleImport').onclick({});
      assert.equal(f.evaluate('state.captions[0].text'), '한中<open'); assert.equal(f.evaluate('history.length'), 1);
      vm.runInContext('undo()', f.context); assert.deepEqual(f.evaluate('state'), before.state);
    } finally {setLocale('ko'); initLocale({locale: 'ko', document: null, storage: null});}
  }
});
