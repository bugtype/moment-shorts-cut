import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';
import { createMcpSession } from '../cli/mcp-session.mjs';
import { createDemoProject, createProjectDocument } from '../dist/core/project.mjs';

const init = {jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'subset-test', version: '1'},
}};
const ready = {jsonrpc: '2.0', method: 'notifications/initialized'};
const request = (id, method, params) => ({jsonrpc: '2.0', id, method, params});
const call = (id, name, args = {}) => request(id, 'tools/call', {
  name: 'moment_' + name.replaceAll('.', '_'), arguments: {projectId: 'session', ...args},
});
const server = fileURLToPath(new URL('../cli/mcp.mjs', import.meta.url));

async function initialize(options) {
  const session = createMcpSession(options);
  const response = await session.dispatch(init);
  await session.dispatch(ready);
  return {session, instructions: response.result.instructions};
}

test('adapter subset is copied, ordered like the catalog and has identical schemas', async () => {
  let resolutions = 0;
  const resolveService = () => { resolutions++; throw new Error('must not resolve'); };
  const commands = ['captions.list', 'project.summary'];
  const adapter = createMcpToolAdapter({resolveService, commands});
  const expected = createMcpToolAdapter({resolveService}).listTools().tools.filter(tool =>
    ['moment_project_summary', 'moment_captions_list'].includes(tool.name));
  commands.push('project.update');
  commands[0] = 'project.import';
  assert.deepEqual(adapter.listTools().tools, expected);
  const first = adapter.listTools();
  first.tools[0].outputSchema.oneOf[0].properties.data.properties.kind.enum.push('bad');
  assert.deepEqual(adapter.listTools().tools, expected);
  await assert.rejects(adapter.callTool('moment_project_update', null), {code: 'UNKNOWN_TOOL'});
  assert.equal(resolutions, 0);
  const poisoned = new Proxy({}, {get: () => assert.fail('disabled tool read arguments')});
  await assert.rejects(adapter.callTool('moment_project_get', poisoned), {code: 'UNKNOWN_TOOL'});
  for (const selection of [null, [], Array(1), 'project.get', ['unknown'], ['project.get', 'project.get'], [' project.get']]) {
    assert.throws(() => createMcpToolAdapter({resolveService, commands: selection}), TypeError);
  }
});

test('session subset instructions describe only available handoff operations', async () => {
  const {instructions} = await initialize({commands: ['project.summary']});
  assert.match(instructions, /starts with demo metadata/);
  assert.match(instructions, /Project import is disabled/);
  assert.match(instructions, /Complete project retrieval is disabled/);
  assert.doesNotMatch(instructions, /moment_project_import|moment_project_get/);
  const imported = await initialize({commands: ['project.import']});
  assert.match(imported.instructions, /moment_project_import/);
  assert.doesNotMatch(imported.instructions, /moment_project_get/);
  const exported = await initialize({commands: ['project.get']});
  assert.match(exported.instructions, /moment_project_get/);
  assert.doesNotMatch(exported.instructions, /moment_project_import/);
  const planned = await initialize({commands: ['render.plan']});
  assert.match(planned.instructions, /moment_render_plan data.project/);
  assert.doesNotMatch(planned.instructions, /Complete project retrieval is disabled/);
  const plan = await planned.session.dispatch(call(2, 'render.plan'));
  assert.equal(plan.result.structuredContent.data.project.format, 'moment-project');
  const defaults = await initialize();
  assert.equal(defaults.instructions, 'Use projectId "session". Changes exist only in this process. Import an editing document with moment_project_import; retrieve moment_project_get before disconnecting to save it through your client. No media upload or video rendering is available.');
});

test('batch and preview retain full nested schemas and mutations despite hidden direct tools', async () => {
  const {session, instructions} = await initialize({commands: ['project.batch', 'project.preview', 'project.summary']});
  assert.match(instructions, /full existing nested edit allowlist/);
  assert.match(instructions, /Batch applies edits; preview only simulates them without committing/);
  const operations = [{command: 'project.update', arguments: {patch: {speed: 2}}}];
  const disabled = await session.dispatch(call(2, 'project.update', {patch: {speed: 4}}));
  assert.equal(disabled.error.code, -32602);
  const preview = await session.dispatch(call(3, 'project.preview', {operations}));
  assert.equal(preview.result.structuredContent.data.after.outputDuration, 6);
  assert.equal((await session.dispatch(call(4, 'project.summary'))).result.structuredContent.data.speed, 1);
  assert.equal((await session.dispatch(call(5, 'project.batch', {operations}))).result.isError, false);
  assert.equal((await session.dispatch(call(6, 'project.summary'))).result.structuredContent.data.speed, 2);
});

test('real stdio subset supports import edit recovery and complete document handoff', () => {
  const p = createDemoProject();
  const messages = [init, ready, request(2, 'tools/list', {}),
    call(3, 'project.import', {document: createProjectDocument(p)}),
    call(4, 'project.update', {patch: {speed: 0}}),
    call(5, 'project.update', {patch: {speed: 2}}),
    call(6, 'captions.list'), call(7, 'project.get')];
  const result = spawnSync(process.execPath, [server, '--tools', 'project.update,project.get,project.import'], {
    input: messages.map(value => JSON.stringify(value)).join('\n') + '\n', encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const responses = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  const response = id => responses.find(item => item.id === id);
  assert.deepEqual(response(2).result.tools.map(tool => tool.name), ['moment_project_get', 'moment_project_update', 'moment_project_import']);
  assert.equal(response(4).result.isError, true);
  assert.equal(response(5).result.isError, false);
  assert.equal(response(6).error.code, -32602);
  assert.equal(response(7).result.structuredContent.data.project.speed, 2);
  const fresh = createMcpToolAdapter({resolveService: () => null});
  assert.equal(fresh.listTools().tools.length, 41);
});

test('invalid startup selection exits without waiting for stdin or emitting protocol output', async () => {
  const invalid = [
    ['--tools'], ['--tools', ''], ['--tools', ','], ['--tools', 'project.get,'],
    ['--tools', 'unknown'], ['--tools', 'moment_project_get'], ['--tools', 'Project.get'],
    ['--tools', 'project.get, project.summary'], ['--tools', 'project.get,project.get'],
    ['--tools=project.get'], ['--tools', 'project.get', '--tools', 'project.summary'], ['--other'],
  ];
  for (const args of invalid) {
    const child = spawn(process.execPath, [server, ...args], {stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('startup waited for stdin')); }, 5000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(code, 1, JSON.stringify(args));
    assert.equal(stdout, '');
    assert.match(stderr, /Moment MCP stopped/);
  }
});
