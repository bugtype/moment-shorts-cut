import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDemoProject, createProjectDocument } from '../dist/core/project.mjs';

const server = fileURLToPath(new URL('../cli/mcp.mjs', import.meta.url));
const request = (id, method, params) => ({jsonrpc: '2.0', id, method, ...(params && {params})});
const init = request(1, 'initialize', {
  protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'test', version: '1'},
});
const ready = {jsonrpc: '2.0', method: 'notifications/initialized'};
const call = (id, name, args = {}) => request(id, 'tools/call', {
  name: 'moment_' + name, arguments: {projectId: 'session', ...args},
});
function run(messages) {
  const child = spawnSync(process.execPath, [server], {
    input: messages.map(message => typeof message === 'string' ? message : JSON.stringify(message)).join('\n') + '\n',
    encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  return child.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('stdio negotiates its supported version, waits for initialization and lists tools', () => {
  const replies = run([
    request(0, 'tools/list'), {...init, params: {...init.params, protocolVersion: 'future'}},
    request(2, 'tools/list'), ready, request(3, 'tools/list'), request(4, 'ping'),
  ]);
  assert.equal(replies[0].error.code, -32600);
  assert.equal(replies[1].result.protocolVersion, '2025-11-25');
  assert.deepEqual(replies[1].result.capabilities, {tools: {}});
  assert.equal(replies[2].error.code, -32600);
  assert.equal(replies[3].result.tools.length,35);
  assert.ok(replies[3].result.tools.some(tool => tool.name === 'moment_project_import'));
  assert.ok(replies[3].result.tools.every(tool => tool.inputSchema.required.includes('projectId')));
  assert.equal(replies[3].result.resultType, undefined);
  assert.deepEqual(replies[4].result, {});
});

test('stdio imports, edits and exports a document without persisting across processes', () => {
  const document = createProjectDocument(createDemoProject());
  document.project.name = 'Imported';
  const replies = run([
    init, ready, call(2, 'project_import', {document}),
    call(3, 'project_update', {patch: {name: 'Edited'}}), call(4, 'project_get'),
  ]);
  assert.ok(replies.slice(1).every(reply => !reply.result.isError));
  const result = replies.at(-1).result;
  assert.equal(result.structuredContent.data.project.name, 'Edited');
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.resultType, undefined);
  const fresh = run([init, ready, call(2, 'project_get')]).at(-1);
  assert.notEqual(fresh.result.structuredContent.data.project.name, 'Edited');
});

test('stdio separates protocol errors from tool failures and ignores mutating notifications', () => {
  const replies = run([
    '{broken', [], {jsonrpc: '2.0', id: null, method: 'ping'}, init, ready,
    request(2, 'unknown'), request(3, 'tools/call', {name: 'missing'}),
    call(4, 'project_get', {projectId: 'other'}),
    call(5, 'project_update', {patch: {speed: -1}}),
    {jsonrpc: '2.0', method: 'tools/call', params: {name: 'moment_project_update',
      arguments: {projectId: 'session', patch: {name: 'Should not apply'}}}},
    call(6, 'project_get'), request(7, 'tools/list', {cursor: 'unknown'}),
    request(8, 'tools/call', {name: 12}), request(9, 'tools/list', []),
  ]);
  assert.deepEqual(replies.slice(0, 3).map(reply => reply.error.code), [-32700, -32600, -32600]);
  assert.equal(replies[4].error.code, -32601);
  assert.equal(replies[5].error.code, -32602);
  assert.equal(replies[6].result.structuredContent.error.code, 'NOT_FOUND');
  assert.equal(replies[7].result.isError, true);
  assert.notEqual(replies[8].result.structuredContent.data.project.name, 'Should not apply');
  assert.ok(replies.slice(9).every(reply => reply.error.code === -32602));
});

test('stdio rejects malformed initialization and oversized frames without protocol noise', () => {
  const replies = run([request(1, 'initialize', {}), init, ready, init]);
  assert.equal(replies[0].error.code, -32602);
  assert.equal(replies[1].result.serverInfo.name, 'moment-shorts-studio');
  assert.equal(replies[2].error.code, -32602);
  const child = spawnSync(process.execPath, [server], {
    input: 'x'.repeat(10 * 1024 * 1024 + 1), encoding: 'utf8',
  });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /oversized input/);
});


test('stdio reads bounded authored pages from 10000 cues and applies a targeted edit without full-list output',()=>{
 const p=createDemoProject();p.captions=Array.from({length:10000},(_,i)=>({start:0,end:1,text:'Cue '+i,...(i===9999?{basis:'timeline',speaker:'1',keywords:'last',timing:'estimated'}:{})}));
 const replies=run([init,ready,call(2,'project_import',{document:createProjectDocument(p)}),call(3,'captions_list',{offset:9998,limit:2}),call(4,'captions_list',{limit:51}),call(5,'captions_update',{captionIndex:9999,patch:{text:'Reviewed'}}),call(6,'captions_list',{offset:9999,limit:1}),call(7,'captions_list',{offset:10000})]);
 const byId=new Map(replies.map(reply=>[reply.id,reply]));
 const first=byId.get(3).result.structuredContent.data;assert.equal(first.totalCaptions,10000);assert.equal(first.nextOffset,null);assert.deepEqual(first.captions,[9998,9999].map(captionIndex=>({captionIndex,caption:p.captions[captionIndex]})));
 assert.equal(byId.get(4).result.isError,true);assert.equal(byId.get(4).result.structuredContent.error.code,'INVALID_ARGUMENT');
 assert.equal(byId.get(5).result.isError,false);const last=byId.get(6).result.structuredContent.data;
 assert.deepEqual(last.captions,[{captionIndex:9999,caption:{...p.captions[9999],text:'Reviewed'}}]);
 assert.deepEqual(byId.get(7).result.structuredContent.data,{totalCaptions:10000,offset:10000,limit:20,nextOffset:null,captions:[]});
 assert.ok(Buffer.byteLength(JSON.stringify(byId.get(6)))<2000,'Actual returned page stays small for this fixture');
});


test('stdio inserts, removes the final cue and recovers from a stale removal index',()=>{
 const initial={start:0,end:1,text:'Original'};
 const replies=run([init,ready,call(2,'captions_replace',{captions:[initial]}),call(3,'captions_insert',{captionIndex:1,caption:{start:1,end:2,text:'Inserted',basis:'timeline',timing:'estimated'}}),call(4,'captions_list'),call(5,'captions_remove',{captionIndex:0}),call(6,'captions_remove',{captionIndex:0}),call(7,'captions_list'),call(8,'captions_remove',{captionIndex:0}),call(9,'captions_insert',{captionIndex:0,caption:initial}),call(10,'captions_list')]);
 const byId=new Map(replies.map(reply=>[reply.id,reply]));
 assert.deepEqual(byId.get(3).result.structuredContent.data,{updated:true,captionIndex:1,totalCaptions:2,outputDuration:12});
 assert.equal(byId.get(4).result.structuredContent.data.captions[1].caption.timing,'estimated');
 assert.equal(byId.get(6).result.structuredContent.data.totalCaptions,0);assert.deepEqual(byId.get(7).result.structuredContent.data.captions,[]);
 assert.equal(byId.get(8).result.isError,true);assert.equal(byId.get(8).result.structuredContent.error.code,'INVALID_ARGUMENT');
 assert.deepEqual(byId.get(10).result.structuredContent.data.captions,[{captionIndex:0,caption:initial}]);
});

test('stdio lists clip-only output clocks after edits and rejects malformed pages',()=>{
 const replies=run([init,ready,call(2,'timeline_duplicate',{clipIndex:0}),call(3,'project_update',{patch:{speed:2}}),call(4,'timeline_list',{offset:1,limit:1}),call(5,'timeline_list',{offset:1.5}),call(6,'timeline_list',{offset:1000})]);
 const page=replies.find(r=>r.id===4).result.structuredContent.data;
 assert.equal(page.totalClips,2);assert.deepEqual(page.clips,[{clipIndex:1,sourceStart:0,sourceEnd:12,timelineStart:12,timelineEnd:24,outputStart:6,outputEnd:12}]);
 assert.equal(replies.find(r=>r.id===5).result.structuredContent.error.code,'INVALID_ARGUMENT');
 assert.deepEqual(replies.find(r=>r.id===6).result.structuredContent.data.clips,[]);
});

test('stdio removes authored ranges atomically and allows removing all remaining captions',()=>{
 const replies=run([init,ready,call(2,'captions_remove',{captionIndex:1,count:3}),call(3,'captions_list'),call(4,'captions_remove',{captionIndex:1,count:2}),call(5,'captions_remove',{captionIndex:0,count:1}),call(6,'captions_list')]);
 assert.equal(replies.find(r=>r.id===2).result.structuredContent.error.code,'INVALID_ARGUMENT');assert.equal(replies.find(r=>r.id===3).result.structuredContent.data.totalCaptions,3);
 assert.equal(replies.find(r=>r.id===4).result.structuredContent.data.totalCaptions,1);assert.deepEqual(replies.find(r=>r.id===6).result.structuredContent.data.captions,[]);
});
