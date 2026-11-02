import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoProject, createProjectDocument, validateProject} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';

const commands = ['project.get', 'render.plan'];
const documentOf = result => result.command === 'project.get' ? result.data : result.data.project;
const serviceFor = (project, asynchronous = false) => createEditorService({
  getProject: () => asynchronous ? Promise.resolve(project) : project,
  commitProject() { assert.fail('document reads must not commit'); },
});

for (const command of commands) test(`${command} copies a large project once at the document owner`, async () => {
  const project = createDemoProject();
  project.duration = 10000;
  project.clips = [{start:0, end:10000}];
  project.captions = Array.from({length:10000}, (_, index) => ({start:index, end:index+1, text:'a'.repeat(800)}));
  validateProject(project);
  const original = structuredClone(project), nativeClone = globalThis.structuredClone;
  let copiedCues = 0;
  globalThis.structuredClone = (value, ...options) => {
    const document = value?.project?.project || value?.project || value;
    if (Array.isArray(document?.captions)) copiedCues += document.captions.length;
    return nativeClone(value, ...options);
  };
  let result;
  try { result = await serviceFor(project).execute(command); }
  finally { globalThis.structuredClone = nativeClone; }
  assert.equal(result.ok, true);
  assert.equal(copiedCues, project.captions.length, 'no second full-document response copy');
  assert.deepEqual(documentOf(result).project, original);
  assert.deepEqual(project, original);
});

for (const command of commands) test(`${command} retains bidirectional nested snapshot isolation for sync and async hosts`, async () => {
  for (const asynchronous of [false, true]) {
    const project = createDemoProject(), service = serviceFor(project, asynchronous);
    const original = createProjectDocument(project), result = await service.execute(command);
    assert.equal(result.ok, true);
    const document = documentOf(result);
    assert.deepEqual(document, original);
    document.project.captions[0].text = 'Caller change';
    document.project.design.title.lines[0] = 'Caller title';
    document.project.clips[0].end = 1;
    assert.deepEqual(createProjectDocument(project), original);
    project.captions[0].text = 'Later host edit';
    project.design.title.lines[1] = 'Later host title';
    assert.equal(document.project.captions[0].text, 'Caller change');
    assert.equal(document.project.design.title.lines[1], original.project.design.title.lines[1]);
    const next = documentOf(await service.execute(command));
    assert.equal(next.project.captions[0].text, 'Later host edit');
    assert.notEqual(next.project, document.project);
  }
});

test('document copy reuse does not cache validation or exempt malformed projects', async () => {
  for (const command of commands) {
    const project = createDemoProject(), service = serviceFor(project);
    const snapshot = await service.execute(command);
    assert.equal(snapshot.ok, true);
    const previous = project.captions.at(-1).end;
    project.captions.at(-1).end = NaN;
    const invalid = await service.execute(command);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, 'INVALID_ARGUMENT');
    assert.equal(Object.hasOwn(invalid, 'data'), false);
    project.captions.at(-1).end = previous;
    assert.deepEqual(await service.execute(command), snapshot);
  }
});

test('MCP document reads keep matching JSON content and isolated structured results', async () => {
  for (const command of commands) {
    const project = createDemoProject(), original = createProjectDocument(project);
    const adapter = createMcpToolAdapter({resolveService: () => serviceFor(project)});
    const response = await adapter.callTool(command === 'project.get' ? 'moment_project_get' : 'moment_render_plan', {projectId:'local'});
    assert.equal(response.isError, false);
    assert.deepEqual(JSON.parse(response.content[0].text), response.structuredContent);
    documentOf(response.structuredContent).project.captions[0].text = 'Client change';
    assert.deepEqual(createProjectDocument(project), original);
  }
});

test('provider results retain their existing defensive response-copy boundary', async () => {
  const project = createDemoProject(), record = {id:'job-1',status:'succeeded',artifact:{names:['output.mp4']}};
  const jobs = {submit:() => record, get:() => record, cancel:() => record};
  const service = createEditorService({getProject:() => project, commitProject() { assert.fail('provider should not commit'); }, jobs});
  const nativeClone = globalThis.structuredClone;
  let recordCopies = 0;
  globalThis.structuredClone = (value, ...options) => {
    if (value?.id === 'job-1') recordCopies++;
    return nativeClone(value, ...options);
  };
  let result;
  try { result = await service.execute('jobs.get', {jobId:'job-1'}); }
  finally { globalThis.structuredClone = nativeClone; }
  assert.equal(result.ok, true);
  assert.equal(recordCopies, 2, 'provider detachment/validation and final response copy are unchanged');
  result.data.artifact.names.push('Client only');
  assert.deepEqual(record.artifact.names, ['output.mp4']);
  record.artifact.names[0] = 'Later provider edit';
  assert.equal(result.data.artifact.names[0], 'output.mp4');
});
