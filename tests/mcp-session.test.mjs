import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpSession, MCP_PROTOCOL_VERSION } from '../cli/mcp-session.mjs';

const request = (id, method, params) => ({jsonrpc: '2.0', id, method, ...(params && {params})});
const initialize = request(1, 'initialize', {
  protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: {name: 'session-test', version: '1'},
});
const ready = {jsonrpc: '2.0', method: 'notifications/initialized'};
const call = (id, name, args = {}) => request(id, 'tools/call', {name, arguments: {projectId: 'session', ...args}});

async function open(session) {
  assert.equal((await session.dispatch(initialize)).result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.equal(await session.dispatch(ready), null);
}

test('each MCP session owns its lifecycle and project without process-global state', async () => {
  const a = createMcpSession(), b = createMcpSession();
  await open(a);
  assert.equal((await b.dispatch(request(2, 'tools/list'))).error.code, -32600);
  await open(b);
  await a.dispatch(call(2, 'moment_project_update', {patch: {name: 'session A'}}));
  const read = session => session.dispatch(call(3, 'moment_project_get'));
  assert.equal((await read(a)).result.structuredContent.data.project.name, 'session A');
  assert.notEqual((await read(b)).result.structuredContent.data.project.name, 'session A');
  assert.equal((await a.dispatch(initialize)).error.code, -32602);
});

test('failed edits and notifications leave the session available and unchanged', async () => {
  const session = createMcpSession();
  await open(session);
  const before = (await session.dispatch(call(2, 'moment_project_get'))).result.structuredContent.data;
  const invalid = await session.dispatch(call(3, 'moment_project_update', {patch: {speed: 0}}));
  assert.equal(invalid.result.isError, true);
  assert.equal(invalid.result.structuredContent.error.code, 'INVALID_ARGUMENT');
  const notification = call(4, 'moment_project_update', {patch: {name: 'ignored'}});
  delete notification.id;
  assert.equal(await session.dispatch(notification), null);
  assert.deepEqual((await session.dispatch(call(5, 'moment_project_get'))).result.structuredContent.data, before);
  assert.equal((await session.dispatch(request(6, 'tools/call', {name: 'unknown'}))).error.code, -32602);
  assert.equal((await session.dispatch(call(7, 'moment_project_update', {patch: {speed: 2}}))).result.isError, false);
});
