// Dependency-free interactive stdio example. Only synthetic project metadata is used.
// No project files, browser, media provider, network or persistent service is involved.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createDemoProject, createProjectDocument } from '../dist/core/project.mjs';

async function withClient(work) {
  const server = fileURLToPath(new URL('../cli/mcp.mjs', import.meta.url));
  const child = spawn(process.execPath, [server], {stdio: ['pipe', 'pipe', 'pipe']});
  const exited = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  exited.catch(() => {}); // Observe spawn errors even before the first response wait.
  let stderr = '', nextId = 0;
  child.stderr.setEncoding('utf8').on('data', text => { stderr += text; });
  const lines = createInterface({input: child.stdout, crlfDelay: Infinity});
  const responses = lines[Symbol.asyncIterator]();
  const send = message => new Promise((resolve, reject) => {
    child.stdin.write(JSON.stringify(message) + '\n', error => error ? reject(error) : resolve());
  });
  async function request(method, params) {
    const id = ++nextId;
    let timeout;
    try {
      const response = await Promise.race([
        (async () => {
          await send({jsonrpc: '2.0', id, method, params});
          const line = await responses.next();
          if (line.done) throw new Error(`Server exited before replying: ${stderr}`);
          return JSON.parse(line.value);
        })(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('MCP response timed out')), 10000); }),
      ]);
      assert.equal(response.id, id);
      if (response.error) throw new Error(`${response.error.code}: ${response.error.message}`);
      return response.result;
    } finally { clearTimeout(timeout); }
  }
  try {
    const hello = await request('initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'moment-example', version: '1'},
    });
    assert.equal(hello.protocolVersion, '2025-11-25');
    await send({jsonrpc: '2.0', method: 'notifications/initialized'});
    const call = (name, args = {}) => request('tools/call', {name, arguments: {projectId: 'session', ...args}});
    const data = async (name, args) => {
      const result = await call(name, args);
      assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
      assert.equal(result.structuredContent.ok, true);
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
      return result.structuredContent.data;
    };
    const result = await work({request, call, data});
    child.stdin.end();
    let shutdownTimer;
    try {
      const code = await Promise.race([exited, new Promise((_, reject) => {
        shutdownTimer = setTimeout(() => reject(new Error('MCP shutdown timed out')), 3000);
      })]);
      assert.equal(code, 0, stderr);
    } finally { clearTimeout(shutdownTimer); }
    assert.equal(stderr, '');
    return result;
  } finally {
    lines.close();
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

const saved = await withClient(async ({request, call, data}) => {
  const {tools} = await request('tools/list', {});
  assert.equal(tools.length, 13);
  assert.ok(tools.some(tool => tool.name === 'moment_project_import'));
  await data('moment_project_import', {document: createProjectDocument(createDemoProject())});
  await data('moment_project_update', {patch: {name: 'MCP 예제', speed: 2}});
  const before = await data('moment_project_get');
  const rejected = await call('moment_project_update', {patch: {speed: 0}});
  assert.equal(rejected.isError, true);
  assert.equal(rejected.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.deepEqual(await data('moment_project_get'), before, 'failed input must not change the project');
  await data('moment_timeline_replace', {clips: [{start: 2, end: 6}]});
  await data('moment_captions_replace', {captions: [{start: 2, end: 4, text: '안녕하세요', basis: 'source'}]});
  const srt = await data('moment_captions_export');
  assert.match(srt.text, /00:00:00,000 --> 00:00:01,000/);
  assert.match(srt.text, /안녕하세요/);
  const vtt = await data('moment_captions_export', {format: 'vtt'});
  assert.equal(vtt.format, 'vtt');
  assert.equal(vtt.text, 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\n안녕하세요\n');
  const invalidFormat = await call('moment_captions_export', {format: 'ass'});
  assert.equal(invalidFormat.isError, true);
  assert.equal(invalidFormat.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.deepEqual(await data('moment_captions_export'), srt);
  const corrected = await data('moment_captions_text_replace', {find: '안녕하세요', replacement: '안녕 세상'});
  assert.deepEqual(corrected, {updated: true, matches: 1, changedCaptions: 1});
  const noChange = await data('moment_captions_text_replace', {find: '없는 말', replacement: '교정'});
  assert.deepEqual(noChange, {updated: false, matches: 0, changedCaptions: 0});
  assert.match((await data('moment_captions_export')).text, /안녕 세상/);
  const styled = await data('moment_captions_style_update', {patch: {captionSize: 44, captionY: .8}});
  assert.equal(styled.updated, true);
  assert.equal((await data('moment_project_get')).project.captionSize, 44);
  const split = await data('moment_timeline_split', {clipIndex: 0, sourceTime: 4});
  assert.equal(split.outputDuration, 2);
  assert.deepEqual((await data('moment_project_get')).project.clips, [{start: 2, end: 4}, {start: 4, end: 6}]);
  const plan = await data('moment_render_plan', {quality: 720, format: 'webm'});
  assert.equal(plan.rendered, false);
  assert.equal(plan.output.duration, 2);
  // Save this document through the client's authorized file workflow in a real integration.
  return JSON.parse(JSON.stringify(await data('moment_project_get')));
});
await withClient(async ({data}) => {
  assert.notEqual((await data('moment_project_get')).project.name, saved.project.name);
  await data('moment_project_import', {document: saved});
  assert.deepEqual(await data('moment_project_get'), saved);
});
console.log(JSON.stringify({ok: true, tools: 13, recoveredFromInvalidInput: true, reimported: true, rendered: false}));
