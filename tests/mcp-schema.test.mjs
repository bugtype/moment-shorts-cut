import test from 'node:test';
import assert from 'node:assert/strict';
import { commandDefinitions } from '../dist/core/commands.mjs';
import { createDemoProject, createProjectDocument } from '../dist/core/project.mjs';
import { validate } from '../dist/core/validation.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';

function fixture() {
  let project = createDemoProject();
  const service = createEditorService({ getProject: () => project, commitProject: next => { project = next; } });
  return createMcpToolAdapter({ resolveService: id => id === 'session' ? service : null });
}

// The production validator supports the branch vocabulary, not JSON Schema oneOf.
// Check both branches explicitly; this is not a general JSON Schema validator.
function matches(schema, value) {
  assert.equal(schema.type, 'object');
  assert.equal(schema.oneOf.length, 2);
  return schema.oneOf.filter(branch => {
    try { validate(branch, value); return true; }
    catch { return false; }
  }).length === 1;
}

const inputs = {
  'project.get': {},
  'project.update': { patch: { name: '스키마 검사' } },
  'project.import': { document: createProjectDocument(createDemoProject()) },
  'templates.list': {},
  'template.apply': { templateId: 'reference', withContent: false },
  'timeline.split': {clipIndex:0,sourceTime:6},
  'timeline.replace': { clips: [{ start: 0, end: 12 }] },
  'title.update': { patch: { lines: ['첫째 줄', '둘째 줄'] } },
  'captions.replace': { captions: [{ start: 0, end: 1, text: '자막' }] },
  'captions.text.replace': {find:'자막',replacement:'교정'},
  'captions.style.update': {patch:{captionSize:44,captionY:.8}},
  'captions.export': {},
  'render.plan': { quality: 720, format: 'webm' },
};

test('all advertised output schemas cover actual success and inaccessible-project errors', async () => {
  const adapter = fixture();
  const tools = adapter.listTools().tools;
  assert.equal(tools.length, Object.keys(inputs).length);
  for (const command of commandDefinitions()) {
    const name = `moment_${command.name.replaceAll('.', '_')}`;
    const tool = tools.find(tool => tool.name === name);
    const args = { projectId: 'session', ...inputs[command.name] };
    const result = await adapter.callTool(name, args);
    assert.equal(result.isError, false, command.name);
    assert.ok(matches(tool.outputSchema, result.structuredContent), command.name);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    const denied = await adapter.callTool(name, { ...args, projectId: 'missing' });
    assert.equal(denied.isError, true);
    assert.equal(denied.structuredContent.error.code, 'NOT_FOUND');
    assert.ok(matches(tool.outputSchema, denied.structuredContent));
    assert.equal(matches(tool.outputSchema, { ...result.structuredContent, error: denied.structuredContent.error }), false, 'success and error fields must not mix');
  }
});

test('schema models validation errors, document exports and plans without promising encoded video', async () => {
  const adapter = fixture();
  const tools = adapter.listTools().tools;
  const update = tools.find(tool => tool.name === 'moment_project_update');
  const invalid = await adapter.callTool(update.name, { projectId: 'session', patch: { speed: 0 } });
  assert.equal(invalid.structuredContent.error.path, 'arguments.patch.speed');
  assert.ok(matches(update.outputSchema, invalid.structuredContent));

  const planTool = tools.find(tool => tool.name === 'moment_render_plan');
  const plan = (await adapter.callTool(planTool.name, { projectId: 'session' })).structuredContent;
  assert.ok(matches(planTool.outputSchema, plan));
  plan.data.rendered = true;
  assert.equal(matches(planTool.outputSchema, plan), false);

  const document = createProjectDocument(createDemoProject());
  document.project.kind = 'video';
  document.project.fileName = 'source.mp4';
  document.project.audioName = 'voice.wav';
  await adapter.callTool('moment_project_import', { projectId: 'session', document });
  const withMedia = (await adapter.callTool(planTool.name, { projectId: 'session' })).structuredContent;
  assert.ok(matches(planTool.outputSchema, withMedia));
  assert.deepEqual(withMedia.data.media, { video: { name: 'source.mp4', required: true }, audio: { name: 'voice.wav', required: true } });
});

test('tool discovery describes time bases and returns isolated schemas without changing command validation', () => {
  const original = commandDefinitions();
  const adapter = fixture();
  const first = adapter.listTools();
  const captions = first.tools.find(tool => tool.name === 'moment_captions_replace');
  assert.match(captions.inputSchema.properties.captions.items.properties.basis.description, /BEFORE speed/);
  const title = first.tools.find(tool => tool.name === 'moment_title_update');
  assert.match(title.inputSchema.properties.patch.properties.start.description, /AFTER speed/);
  const before = adapter.listTools();
  first.tools[0].outputSchema.oneOf[0].properties.data.properties.format.enum[0] = 'corrupted';
  captions.inputSchema.properties.captions.items.properties.basis.enum.push('output');
  first.tools[0].annotations.readOnlyHint = false;
  assert.deepEqual(adapter.listTools(), before);
  assert.deepEqual(commandDefinitions(), original);
});
