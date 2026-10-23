import test from 'node:test';
import assert from 'node:assert/strict';
import {assertJson} from '../dist/core/validation.mjs';
import {createDemoProject,createProjectDocument,readProjectDocument} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';

test('JSON validation rejects missing, inherited and non-enumerable array indices',()=>{
  const inherited=Array(1);
  Object.setPrototypeOf(inherited,Object.assign(Object.create(Array.prototype),{0:'inherited'}));
  const hidden=['hidden'];Object.defineProperty(hidden,'0',{enumerable:false});
  for(const value of [Array(1),[, 'second'],inherited,hidden]){
    assert.throws(()=>assertJson({items:value}),error=>error.code==='INVALID_ARGUMENT'&&error.path==='$.items[0]');
  }
  for(const value of [[],[null],['',0,false,null],['first','second']])assert.doesNotThrow(()=>assertJson(value));
  assert.throws(()=>assertJson([undefined]),error=>error.code==='INVALID_ARGUMENT');
});

test('array length checks use the existing JSON node budget before inspecting huge sparse payloads',()=>{
  const huge=Array(2**32-1);let reads=0;
  Object.defineProperty(huge,'0',{enumerable:true,get(){reads++;return 'first';}});
  assert.throws(()=>assertJson(huge),error=>error.code==='INVALID_ARGUMENT'&&error.path==='$');
  assert.equal(reads,0);
  assert.doesNotThrow(()=>assertJson(Array(99999).fill(null)));
  assert.throws(()=>assertJson(Array(100000).fill(null)),error=>error.code==='INVALID_ARGUMENT');
  assert.throws(()=>assertJson([Array(50000).fill(0),Array(50000).fill(0)]),error=>error.code==='INVALID_ARGUMENT');
});

test('sparse command/import arrays never commit, resolve MCP storage or corrupt JSON round-trips',async()=>{
  let state=createDemoProject(),commits=0,lookups=0;
  const service=createEditorService({getProject:()=>state,commitProject:next=>{state=next;commits++;}});
  const adapter=createMcpToolAdapter({resolveService:()=>{lookups++;return service;}});
  const original=structuredClone(state),document=createProjectDocument(state);
  document.project.design.title.lines=[, 'second'];
  for(const [command,args] of [
    ['title.update',{patch:{lines:[, 'second']}}],
    ['timeline.replace',{clips:[, {start:0,end:1}]}],
    ['captions.replace',{captions:[{start:0,end:1,text:'caption'},,]}],
    ['project.import',{document}],
  ]){
    const result=await service.execute(command,args);
    assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_ARGUMENT');
    const mcp=await adapter.callTool(`moment_${command.replaceAll('.','_')}`,{projectId:'fixture',...args});
    assert.equal(mcp.isError,true);assert.equal(mcp.structuredContent.error.code,'INVALID_ARGUMENT');
    assert.deepEqual(state,original);assert.equal(commits,0);assert.equal(lookups,0);
  }
  assert.throws(()=>readProjectDocument(document),error=>error.code==='INVALID_ARGUMENT');
  assert.throws(()=>createProjectDocument(document.project),error=>error.code==='INVALID_ARGUMENT');
  const result=await service.execute('title.update',{patch:{lines:['','second'],end:null}});
  assert.equal(result.ok,true);assert.equal(commits,1);
  assert.deepEqual(readProjectDocument(JSON.parse(JSON.stringify(createProjectDocument(state)))),state);
});
