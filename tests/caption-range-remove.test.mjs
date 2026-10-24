import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCommand} from '../dist/core/commands.mjs';
import {createDemoProject,validateProject} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';
const remove=(p,args)=>prepareCommand(p,'captions.remove',args);
test('range removal preserves exact survivor metadata and clocks, including beyond current timeline',()=>{
 const p=createDemoProject();p.clips=[{start:0,end:1}];p.captions=[{start:8,end:12,text:'outside',basis:'timeline',timing:'estimated',speaker:'1',keywords:'raw'},...p.captions];validateProject(p);
 for(const [captionIndex,count] of [[0,2],[1,2],[2,2],[0,4]]){
  const before=structuredClone(p),expected=structuredClone(p);expected.captions.splice(captionIndex,count);
  const result=remove(p,{captionIndex,count});assert.deepEqual(result.project,expected);assert.deepEqual(result.data,{updated:true,captionIndex,totalCaptions:4-count,outputDuration:1});assert.deepEqual(p,before);
  if(result.project.captions.length)result.project.captions[0].text='detached';assert.deepEqual(p,before);
 }
 assert.deepEqual(remove(p,{captionIndex:1}),remove(p,{captionIndex:1,count:1}));
});
test('invalid counts and overflow never truncate or mutate; 10000 rows can all be removed',()=>{
 const p=createDemoProject(),before=structuredClone(p);
 for(const count of [0,-1,1.5,10001,null,'2',NaN,Infinity,4])assert.throws(()=>remove(p,{captionIndex:0,count}),e=>e.code==='INVALID_ARGUMENT');
 assert.throws(()=>remove(p,{captionIndex:2,count:2}),e=>e.code==='INVALID_ARGUMENT'&&e.path==='arguments.count');
 assert.throws(()=>remove(p,{captionIndex:0,count:undefined}));assert.deepEqual(p,before);
 p.captions=Array.from({length:10000},(_,i)=>({start:0,end:1,text:String(i)}));assert.deepEqual(remove(p,{captionIndex:0,count:10000}).project.captions,[]);assert.equal(p.captions.length,10000);
});
test('service batches apply sequential ranges once and roll back a later overflow',async()=>{
 let p=createDemoProject(),commits=0;const service=createEditorService({getProject:()=>p,commitProject:next=>{p=next;commits++;}});
 const before=structuredClone(p),bad=await service.execute('project.batch',{operations:[{command:'captions.remove',arguments:{captionIndex:0,count:2}},{command:'captions.remove',arguments:{captionIndex:0,count:2}}]});assert.equal(bad.ok,false);assert.equal(commits,0);assert.deepEqual(p,before);
 const good=await service.execute('project.batch',{operations:[{command:'captions.remove',arguments:{captionIndex:1,count:2}},{command:'captions.remove',arguments:{captionIndex:0}}]});assert.equal(good.ok,true);assert.equal(commits,1);assert.deepEqual(p.captions,[]);
});
test('MCP existing remove tool exposes optional count without changing acknowledgment',async()=>{
 let p=createDemoProject();const service=createEditorService({getProject:()=>p,commitProject:next=>{p=next;}}),adapter=createMcpToolAdapter({resolveService:()=>service});
 const tool=adapter.listTools().tools.find(t=>t.name==='moment_captions_remove');assert.equal(tool.inputSchema.properties.count.maximum,10000);assert.equal(tool.inputSchema.required.includes('count'),false);
 const r=await adapter.callTool('moment_captions_remove',{projectId:'session',captionIndex:0,count:2});assert.equal(r.isError,false);assert.deepEqual(r.structuredContent.data,{updated:true,captionIndex:0,totalCaptions:1,outputDuration:12});
});
