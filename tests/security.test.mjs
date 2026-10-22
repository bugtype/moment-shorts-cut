import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProject, createProjectDocument, readProjectDocument } from '../dist/core/project.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';

const fixture = () => {
  let state = createDemoProject();
  const service = createEditorService({getProject: () => state, commitProject: next => { state = next; }});
  return {service, get state() { return state; }};
};

test('current-format imports reject broken fields instead of silently replacing authored settings', async () => {
  const f = fixture();
  const original = createProjectDocument(f.state);
  for (const mutate of [
    p => { p.design = null; },
    p => { p.overlays = null; },
    p => { delete p.design.title; },
    p => { p.effects = []; },
  ]) {
    const document = structuredClone(original);
    mutate(document.project);
    const result = await f.service.execute('project.import', {document});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'INVALID_ARGUMENT');
    assert.deepEqual(createProjectDocument(f.state), original);
  }
});

test('older documents still migrate without losing authored text', () => {
  const document = createProjectDocument(createDemoProject());
  document.project.schemaVersion = 1;
  delete document.project.design;
  document.project.overlay = '기존 작성 문구';
  document.project.overlayColor = '#ff0000';
  const project = readProjectDocument(document);
  assert.equal(project.schemaVersion, 4);
  assert.equal(project.design.title.lines[0], '기존 작성 문구');
});

test('MCP captures arguments before the asynchronous authorization lookup', async () => {
  const f = fixture();
  let allow;
  const authorized = new Promise(resolve => { allow = resolve; });
  const adapter = createMcpToolAdapter({resolveService: async () => { await authorized; return f.service; }});
  const args = {projectId: 'one', patch: {name: 'Requested name'}};
  const pending = adapter.callTool('moment_project_update', args, {user: 'owner'});
  args.patch.name = 'Changed while authorizing';
  allow();
  assert.equal((await pending).isError, false);
  assert.equal(f.state.name, 'Requested name');
});

test('MCP rejects invalid input before resolving storage and hides internal errors', async () => {
  let lookups = 0;
  const adapter = createMcpToolAdapter({resolveService: () => { lookups++; throw new Error('secret storage path'); }});
  const invalid = await adapter.callTool('moment_project_update', {projectId: 'one', patch: {speed: -1}}, {});
  assert.equal(invalid.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.equal(lookups, 0);
  const internal = await adapter.callTool('moment_project_get', {projectId: 'one'}, {});
  assert.equal(internal.structuredContent.error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(internal), /secret storage path/);
});
