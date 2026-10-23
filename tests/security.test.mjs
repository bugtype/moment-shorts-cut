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

test('MCP discovery schemas cannot change later discovery or private input validation', async () => {
  const f=fixture();let lookups=0;
  const adapter=createMcpToolAdapter({resolveService:()=>{lookups++;return f.service;}});
  const original=adapter.listTools(),list=adapter.listTools();
  const update=list.tools.find(t=>t.name==='moment_project_update');
  update.inputSchema.properties.patch.properties.speed.minimum=0;
  update.inputSchema.properties.patch.properties.zoom.maximum=0;
  const captions=list.tools.find(t=>t.name==='moment_captions_replace').inputSchema.properties.captions;
  captions.maxItems=0;
  captions.items.required.length=0;
  captions.items.properties.basis.enum.push('invalid-clock');
  update.name='renamed';update.annotations.readOnlyHint=true;list.tools.pop();
  assert.deepEqual(adapter.listTools(),original);
  const before=structuredClone(f.state);
  for(const [name,args] of [
    ['moment_project_update',{patch:{speed:0}}],
    ['moment_captions_replace',{captions:[{start:0,end:1,text:'caption',basis:'invalid-clock'}]}],
    ['moment_captions_replace',{captions:[{start:0,end:1}]}],
  ]){
    const result=await adapter.callTool(name,{projectId:'one',...args});
    assert.equal(result.isError,true);assert.equal(result.structuredContent.error.code,'INVALID_ARGUMENT');
  }
  assert.equal(lookups,0);assert.deepEqual(f.state,before);
  assert.equal((await adapter.callTool('moment_project_update',{projectId:'one',patch:{zoom:1.5}})).isError,false);
  assert.equal(f.state.zoom,1.5);
  assert.equal((await adapter.callTool('moment_captions_replace',{projectId:'one',captions:[{start:0,end:1,text:'valid'}]})).isError,false);
  assert.equal(f.state.captions[0].text,'valid');assert.equal(lookups,2);
  assert.deepEqual(adapter.listTools(),original);
});
