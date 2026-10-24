import {newCard} from '../dist/effects.mjs';
import {saveCustomTemplate} from '../dist/template-catalog.mjs';
import {createTemplateDocument} from '../dist/template-library.mjs';
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

const schemaProject=createDemoProject();schemaProject.overlays=[{...newCard(12),id:'schema-card'}];
const inputs = {
  'project.batch': {operations:[{command:'project.update',arguments:{patch:{name:'Batch schema'}}}]},
  'project.get': {},
  'project.update': { patch: { name: '스키마 검사' } },
  'project.import': { document: createProjectDocument(schemaProject) },
  'templates.list': {},
  'template.export': {id:'schema-export',name:'Schema style'},
  'template.apply.document': {document:createTemplateDocument(saveCustomTemplate('스키마',createDemoProject()))},
  'template.apply': { templateId: 'reference', withContent: false },
  'captions.split': {captionIndex:0,textOffset:1},
  'captions.merge': {captionIndex:0},
  'timeline.move': {clipIndex:0,toIndex:0},
  'timeline.duplicate': {clipIndex:0},
  'timeline.split': {clipIndex:0,sourceTime:6},
  'timeline.replace': { clips: [{ start: 0, end: 12 }] },
  'overlays.move': {id:'schema-card',toIndex:0},
  'overlays.add': {id:'schema-added',patch:{text:'추가',start:0,end:1}},
  'overlays.remove': {id:'schema-added'},
  'overlays.update': {id:'schema-card',patch:{text:'카드 교정'}},
  'credit.update': {patch:{text:'출처: 테스트',start:0,end:null}},
  'title.update': { patch: { lines: ['첫째 줄', '둘째 줄'] } },
  'captions.import': {text:'1\n00:00:00,000 --> 00:00:01,000\n자막\n\n2\n00:00:01,000 --> 00:00:02,000\n다음',basis:'source'},
  'captions.insert': {captionIndex:0,caption:{start:0,end:1,text:'추가'}},
  'captions.remove': {captionIndex:0},
  'captions.update': {captionIndex:0,patch:{text:'개별 자막'}},
  'captions.replace': { captions: [{ start: 0, end: 1, text: '자막' }] },
  'captions.text.replace': {find:'자막',replacement:'교정'},
  'captions.timing.shift': {basis:'source',delta:.1},
  'captions.style.update': {patch:{captionSize:44,captionY:.8}},
  'timeline.list': {offset:0,limit:2},
  'captions.list': {offset:0,limit:2},
  'captions.overlaps': {limit:20},
  'captions.inspect': {maxGraphemesPerSecond:1,limit:2},
  'captions.export': {},
  'effects.update': {patch:{brightness:1.1}},
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
