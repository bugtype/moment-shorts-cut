import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { createTextFileWorkflow } from '../dist/text-file-workflow.mjs';
import { createDemoProject, createProjectDocument, projectSrt } from '../dist/core/project.mjs';
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
    toast: message => f.messages.push(message),
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
});

for (const format of ['srt', 'vtt']) {
  test(`${format} download refuses empty edited output and invalid captions without partial files`, () => {
    const f = fixture();
    f.project.clips = [{ start: 8, end: 12 }];
    f.project.captions = [{ start: 0, end: 1, text: 'outside selected clip' }];
    f.workflow.downloadSubtitles(format);
    assert.equal(f.downloads.length, 0);
    assert.equal(f.messages.at(-1), '저장할 자막이 없습니다.');
    f.project.captions = [{ start: 8, end: 10, text: 'first\n\nsecond' }];
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
  element('#downloadVtt').onclick({ type: 'click' });
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, '패널 저장.vtt');
  assert.equal(downloads[0].blob.type, 'text/vtt;charset=utf-8');
  assert.ok((await downloads[0].blob.text()).startsWith('WEBVTT\n\n'));
});
