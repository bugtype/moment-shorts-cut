import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextFileWorkflow } from '../dist/text-file-workflow.mjs';
import { createDemoProject, createProjectDocument } from '../dist/core/project.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';

function fixture() {
  const f = { project: createDemoProject(), messages: [], downloads: [], closed: 0, focused: 0 };
  const controls = { '#projectInput': { value: 'selected' }, '#srtInput': { value: 'selected' } };
  const service = createEditorService({
    getProject: () => f.project,
    commitProject: next => { f.project = next; },
  });
  f.workflow = createTextFileWorkflow({
    getProject: () => f.project, execute: service.execute,
    query: id => controls[id], closeModal: () => f.closed++,
    focusImportedCaption: () => f.focused++, settingsUnavailable: () => false,
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
