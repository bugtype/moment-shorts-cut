import {formatError} from '../dist/i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { createTextFileWorkflow } from '../dist/text-file-workflow.mjs';
import { createDemoProject, createProjectDocument, projectSrt, projectSubtitles } from '../dist/core/project.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';

function fixture() {
  const f = { project: createDemoProject(), messages: [], downloads: [], closed: 0, focused: 0, unavailable: false };
  const controls = { '#projectInput': { value: 'selected' }, '#srtInput': { value: 'selected' } };
  const service = createEditorService({
    getProject: () => f.project,
    commitProject: next => { f.project = next; },
  });
  f.workflow = createTextFileWorkflow({
    getProject: () => f.project, execute: service.execute,
    query: id => controls[id], closeModal: () => f.closed++,
    focusImportedCaption: () => f.focused++, settingsUnavailable: () => f.unavailable,
    download: (blob, name) => f.downloads.push({ blob, name }),
    toast: message => f.messages.push(formatError(message)),
  });
  f.controls = controls;
  return f;
}

test('text workflow instances own import ordering and export the latest project', async () => {
  const a = fixture(), b = fixture();
  const document = createProjectDocument(a.project);
  document.project.name = '독립 프로젝트';
  const bytes = await new Blob([JSON.stringify(document)]).arrayBuffer();
  let finish;
  const pending = a.workflow.importProjectSettings({ size: bytes.byteLength, arrayBuffer: () => new Promise(resolve => { finish = resolve; }) });
  await b.workflow.importSrt(new Blob(['1\n00:00:00,000 --> 00:00:02,000\n다른 편집기']));
  finish(bytes);
  assert.equal((await pending).ok, true);
  assert.equal(a.project.name, '독립 프로젝트');
  assert.equal(b.project.captions[0].text, '다른 편집기');
  assert.equal(a.closed, 1);
  assert.equal(b.focused, 1);
  assert.equal(a.controls['#projectInput'].value, '');
  assert.equal(b.controls['#srtInput'].value, '');
  a.workflow.downloadProjectSettings();
  assert.equal(a.downloads[0].name, '독립 프로젝트.moment.json');
  assert.equal(JSON.parse(await a.downloads[0].blob.text()).project.name, '독립 프로젝트');
  b.workflow.downloadSrt();
  assert.match(await b.downloads[0].blob.text(), /다른 편집기/);
});


test('subtitle downloads use the latest project, edited timing and format-specific bytes', async () => {
  const f = fixture();
  f.project = { ...createDemoProject(), name: '새 편집 🎬', speed: 2,
    clips: [{ start: 2, end: 6 }],
    captions: [{ start: 2, end: 4, text: '안녕하세요' }, { start: 8, end: 10, text: '잘린 자막' }],
  };
  f.workflow.downloadSubtitles('vtt');
  const vtt = f.downloads[0];
  assert.equal(vtt.name, '새 편집 🎬.vtt');
  assert.equal(vtt.blob.type, 'text/vtt;charset=utf-8');
  const vttText = await vtt.blob.text();
  assert.ok(vttText.startsWith('WEBVTT\n\n'));
  assert.match(vttText, /00:00:00\.000 --> 00:00:01\.000/);
  assert.match(vttText, /안녕하세요/);
  assert.doesNotMatch(vttText, /잘린 자막/);
  assert.deepEqual([...new Uint8Array(await vtt.blob.arrayBuffer()).slice(0, 6)], [...Buffer.from('WEBVTT')]);

  f.workflow.downloadSrt();
  f.workflow.downloadSubtitles();
  for (const srt of f.downloads.slice(1)) {
    assert.equal(srt.name, '새 편집 🎬.srt');
    assert.equal(srt.blob.type, 'text/plain;charset=utf-8');
    assert.deepEqual(Buffer.from(await srt.blob.arrayBuffer()), Buffer.from(projectSrt(f.project, { bom: true })), 'legacy SRT bytes including BOM stay unchanged');
  }
  f.project.name = '  ';
  f.workflow.downloadSrt();
  assert.equal(f.downloads.at(-1).name, '  .srt', 'nonempty authored names are not trimmed or sanitized');
});

test('an imported empty project name uses the existing download fallback without changing metadata or subtitle bytes', async () => {
  const f = await createAppFixture(), downloads = [];
  f.context.collect = (blob, name) => downloads.push({ blob, name });
  vm.runInContext('download=collect;history=[];future=[];globalThis.downloadSaves=0;scheduleSave=()=>downloadSaves++;', f.context);
  const document = createProjectDocument(f.evaluate('state'));
  document.project.name = '';
  await f.element('#projectInput').onchange({ target: { files: [new Blob([JSON.stringify(document)])] } });
  assert.equal(f.evaluate('state.name'), '');
  const before = f.evaluate('({state,history,future,current,selected,downloadSaves})');
  assert.equal(before.history.length, 1);
  vm.runInContext('downloadProjectSettings();downloadSrt();', f.context);
  assert.equal(downloads[0].name, 'moment.moment.json');
  assert.equal(JSON.parse(await downloads[0].blob.text()).project.name, '');
  assert.equal(downloads[1].name, 'moment.srt');
  assert.deepEqual(Buffer.from(await downloads[1].blob.arrayBuffer()), Buffer.from(projectSrt(before.state, { bom: true })));
  for (const format of ['srt', 'vtt', 'txt', 'review-txt']) {
    f.context.outputFormat = format;
    vm.runInContext('downloadSubtitles(outputFormat,{captionIndex:0,count:1})', f.context);
    const result = downloads.at(-1), review = format === 'review-txt';
    assert.equal(result.name, `moment.rows-1-1.${review ? 'review.txt' : format}`);
    const expected = projectSubtitles(before.state, { captionIndex: 0, count: 1,
      format: review ? 'txt' : format, bom: format === 'srt', ...(review ? { review: true } : {}) });
    assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()), Buffer.from(expected));
  }
  assert.equal(downloads.length, 6);
  assert.deepEqual(f.evaluate('({state,history,future,current,selected,downloadSaves})'), before);
});

for (const format of ['srt', 'vtt', 'txt']) {
  test(`${format} download refuses empty edited output and invalid captions without partial files`, () => {
    const f = fixture();
    f.project.clips = [{ start: 8, end: 12 }];
    f.project.captions = [{ start: 0, end: 1, text: 'outside selected clip' }];
    f.workflow.downloadSubtitles(format);
    assert.equal(f.downloads.length, 0);
    assert.equal(f.messages.at(-1), '저장할 자막이 없습니다.');
    f.project.captions = [{ start: 8, end: 10, text: format === 'txt' ? 'bad\0text' : 'first\n\nsecond' }];
    const before = structuredClone(f.project);
    f.workflow.downloadSubtitles(format);
    assert.equal(f.downloads.length, 0);
    assert.deepEqual(f.project, before);
    assert.notEqual(f.messages.at(-1), '저장할 자막이 없습니다.');
    f.project.captions[0].text = 'fixed';
    f.workflow.downloadSubtitles(format);
    assert.equal(f.downloads.length, 1, 'a corrected project can export immediately');
  });

  test(`${format} download preserves recovery protection`, () => {
    const f = fixture();
    f.unavailable = true;
    f.workflow.downloadSubtitles(format);
    assert.equal(f.downloads.length, 0);
    f.unavailable = false;
    f.workflow.downloadSubtitles(format);
    assert.equal(f.downloads.length, 1);
  });
}


test('caption panel VTT action reaches the app export workflow', async () => {
  const { context, element } = await createAppFixture();
  const downloads = [];
  context.collectSubtitle = (blob, name) => downloads.push({ blob, name });
  vm.runInContext("download = (blob, name) => collectSubtitle(blob, name); state.name = '패널 저장'; switchPanel('captions');", context);
  element('#captionExportFormat').value='vtt';element('#captionExportFormat').onchange();
  element('#downloadCaptions').onclick({ type: 'click' });
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, '패널 저장.vtt');
  assert.equal(downloads[0].blob.type, 'text/vtt;charset=utf-8');
  assert.ok((await downloads[0].blob.text()).startsWith('WEBVTT\n\n'));
});


test('TXT workflow saves literal latest edited text without BOM and correct MIME/name',async()=>{
 const f=fixture();f.project.name='새 대본';f.project.captions=[{start:0,end:1,text:'<대사> & 한글\n\n다음'}];
 f.workflow.downloadSubtitles('txt');assert.equal(f.downloads[0].name,'새 대본.txt');
 assert.equal(f.downloads[0].blob.type,'text/plain;charset=utf-8');assert.equal(await f.downloads[0].blob.text(),'<대사> & 한글\n\n다음\n');
 assert.notDeepEqual([...new Uint8Array(await f.downloads[0].blob.arrayBuffer())].slice(0,3),[239,187,191]);
});

test('SRT NUL failure downloads nothing and preserves text, with a usable corrected retry',()=>{
 const f=fixture();f.project.captions=[{start:0,end:1,text:'Before\0After 한글'}];
 const before=structuredClone(f.project);
 f.workflow.downloadSrt();
 assert.equal(f.downloads.length,0);assert.deepEqual(f.project,before);
 assert.match(f.messages.at(-1),/SRT.*NUL/);
 f.project.captions[0].text='Before After 한글';f.workflow.downloadSrt();
 assert.equal(f.downloads.length,1);
});
