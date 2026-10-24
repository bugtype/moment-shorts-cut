import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_ASPECT_RATIOS, outputDimensions } from '../dist/core/aspect-ratio.mjs';
import { createDemoProject, createProjectDocument, readProjectDocument, validateProject } from '../dist/core/project.mjs';
import { prepareCommand } from '../dist/core/commands.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';
import { saveCustomTemplate } from '../dist/template-catalog.mjs';
import { createTemplateDocument } from '../dist/template-library.mjs';

const dimensions = {
  '9:16': [[720, 1280], [1080, 1920]],
  '4:5': [[720, 900], [1080, 1350]],
  '1:1': [[720, 720], [1080, 1080]],
  '16:9': [[1280, 720], [1920, 1080]],
};

test('all supported ratios share exact short-edge render-plan geometry and roundtrip unchanged', () => {
  assert.deepEqual(SUPPORTED_ASPECT_RATIOS, ['9:16', '4:5', '1:1', '16:9']);
  assert.ok(Object.isFrozen(SUPPORTED_ASPECT_RATIOS));
  for (const ratio of SUPPORTED_ASPECT_RATIOS) {
    const project = createDemoProject();
    project.ratio = ratio;
    const before = structuredClone(project);
    validateProject(project);
    assert.deepEqual(readProjectDocument(JSON.parse(JSON.stringify(createProjectDocument(project)))), project);
    for (const [index, quality] of [720, 1080].entries()) {
      const [width, height] = dimensions[ratio][index];
      assert.deepEqual(outputDimensions(ratio, quality), { width, height });
      const plan = prepareCommand(project, 'render.plan', { quality }).data;
      assert.deepEqual(plan.output, { width, height, fps: 30, format: 'mp4', duration: 12 });
    }
    assert.deepEqual(project, before);
  }
});

test('ratio update changes only framing, preview is read-only and templates omit ratio', () => {
  const project = createDemoProject();
  project.zoom = 2;
  project.panX = .25;
  project.panY = -.4;
  const before = structuredClone(project);
  const operation = { command: 'project.update', arguments: { patch: { ratio: '4:5' } } };
  const preview = prepareCommand(project, 'project.preview', { operations: [operation] });
  assert.equal(preview.project, undefined);
  assert.deepEqual(preview.data.changedFields, ['panX', 'panY', 'ratio', 'zoom']);
  const next = prepareCommand(project, 'project.batch', { operations: [operation] }).project;
  assert.deepEqual(next, { ...project, ratio: '4:5', zoom: 1, panX: 0, panY: 0 });
  const document = createTemplateDocument(saveCustomTemplate('Feed', next, { id: 'feed-test' }));
  assert.equal(Object.hasOwn(document.template.settings, 'ratio'), false);
  const applied = prepareCommand(next, 'template.apply.document', { document, withContent: true }).project;
  assert.equal(applied.ratio, '4:5');
  assert.deepEqual(project, before);
  for (const ratio of ['5:4', '4:3', '4/5', '', null, 4]) {
    assert.throws(() => prepareCommand(project, 'project.update', { patch: { ratio } }), { code: 'INVALID_ARGUMENT' });
    assert.throws(() => validateProject({ ...project, ratio }), { code: 'INVALID_ARGUMENT' });
  }
});

test('service and MCP expose the bounded ratio enum, commit once and return 4:5 geometry', async () => {
  let project = createDemoProject(), commits = 0;
  const service = createEditorService({ getProject: () => project, commitProject: next => { project = next; commits++; } });
  const adapter = createMcpToolAdapter({ resolveService: () => service });
  const tool = adapter.listTools().tools.find(item => item.name === 'moment_project_update');
  assert.deepEqual(tool.inputSchema.properties.patch.properties.ratio.enum, SUPPORTED_ASPECT_RATIOS);
  const result = await adapter.callTool('moment_project_update', { projectId: 'session', patch: { ratio: '4:5' } });
  assert.equal(result.isError, false);
  const plan = await adapter.callTool('moment_render_plan', { projectId: 'session', quality: 1080 });
  assert.equal(plan.structuredContent.data.output.width, 1080);
  assert.equal(plan.structuredContent.data.output.height, 1350);
  assert.equal(commits, 1);
  const invalid = await service.execute('project.update', { patch: { ratio: '5:4' } });
  assert.equal(invalid.error.code, 'INVALID_ARGUMENT');
  assert.equal(commits, 1);
});

test('CLI edits and reopens 4:5 settings, rejects unsupported ratios without overwriting', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moment-ratio-'));
  try {
    const input = path.join(directory, 'input.json'), output = path.join(directory, 'output.json');
    await fs.writeFile(input, JSON.stringify(createProjectDocument(createDemoProject())));
    const cli = fileURLToPath(new URL('../cli/moment.mjs', import.meta.url));
    const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    const update = ratio => run(['exec', 'project.update', '--project', input, '--json', JSON.stringify({ patch: { ratio } }), '--out', output, '--overwrite']);
    assert.equal(update('4:5').status, 0);
    const saved = await fs.readFile(output, 'utf8');
    assert.equal(readProjectDocument(JSON.parse(saved)).ratio, '4:5');
    const plan = run(['exec', 'render.plan', '--project', output, '--json', '{"quality":720}']);
    assert.equal(plan.status, 0, plan.stderr);
    assert.equal(JSON.parse(plan.stdout).data.output.height, 900);
    assert.equal(update('5:4').status, 1);
    assert.equal(await fs.readFile(output, 'utf8'), saved);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
