import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppFixture} from './fixtures/app.mjs';
import {createTextFileWorkflow} from '../dist/text-file-workflow.mjs';
import {createTemplateWorkspace} from '../dist/template-workspace.mjs';
import {createDemoProject, createProjectDocument} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createTemplateDocument} from '../dist/template-library.mjs';
import {saveCustomTemplate} from '../dist/template-catalog.mjs';
import {setLocale, translateFor, formatError} from '../dist/i18n.mjs';

for (const kind of ['settings', 'template']) {
  test(`${kind} JSON syntax failures localize visible toasts without changing state and allow retry`, async () => {
    const f = await createAppFixture();
    let project = createDemoProject(), commits = 0, writes = 0, closed = 0, api;
    const before = structuredClone(project), notices = [];
    const toast = value => {
      notices.push(value);
      f.context.importNotice = value;
      f.evaluate('toast(importNotice); true');
    };
    const service = createEditorService({getProject: () => project,
      commitProject: next => {project = next; commits++;}, formatErrorMessage: formatError});
    const flow = createTextFileWorkflow({getProject: () => project, execute: service.execute,
      query: () => ({value: ''}), closeModal: () => closed++, toast});
    const workspace = createTemplateWorkspace({getProject: () => project, query: () => null,
      modal: {}, toast, refresh() {}}, {readStorage: () => null,
      writeStorage: () => writes++, mount: (_, actions) => {api = actions;}});
    workspace.render({});
    const importFile = file => kind === 'settings' ? flow.importProjectSettings(file) : api.import(file);
    const key = kind === 'settings' ? 'errors.settingsCheck' : 'templates.invalidFile';
    try {
      for (const locale of ['ko', 'en', 'zh-CN']) {
        setLocale(locale, {persist: false});
        await importFile(new Blob(['{"PRIVATE_EXCERPT": broken}']));
        assert.equal(notices.at(-1).messageKey, key);
        const node = f.element('#toast');
        assert.equal(node.textContent, translateFor(locale, key));
        assert.doesNotMatch(node.textContent, /PRIVATE_EXCERPT|Unexpected token|SyntaxError/);
        for (const changed of ['en', 'zh-CN', 'ko']) {
          setLocale(changed, {persist: false});
          assert.equal(node.textContent, translateFor(changed, key));
        }
        assert.deepEqual(project, before);
        assert.equal(commits, 0); assert.equal(writes, 0); assert.equal(closed, 0);
      }
      // SyntaxError from a file reader is not a JSON.parse error: retain it.
      await importFile({size: 1, arrayBuffer: async () => {throw new SyntaxError('reader failure');}});
      assert.equal(formatError(notices.at(-1)), 'reader failure');
      const document = kind === 'settings' ? createProjectDocument(project) :
        createTemplateDocument(saveCustomTemplate('Authored 中文 한글', project));
      const invalid = structuredClone(document);
      if (kind === 'settings') invalid.project.speed = 0;
      else invalid.template.accent = '#invalid';
      await importFile(new Blob([JSON.stringify(invalid)]));
      assert.notEqual(formatError(notices.at(-1)), translateFor('ko', key));
      assert.equal(formatError(notices.at(-1)), translateFor('ko',
        kind === 'settings' ? 'errors.numberRange' : 'errors.templateColor'));
      assert.deepEqual(project, before);
      assert.equal(commits, 0); assert.equal(writes, 0);
      await importFile(new Blob([JSON.stringify(document)]));
      assert.equal(commits, kind === 'settings' ? 1 : 0);
      assert.equal(writes, kind === 'template' ? 1 : 0);
      assert.deepEqual(project, before);
      if (kind === 'template') {
        workspace.render({});
        assert.equal(api.custom[0].name, 'Authored 中文 한글');
      }
    } finally {setLocale('ko', {persist: false});}
  });
}
