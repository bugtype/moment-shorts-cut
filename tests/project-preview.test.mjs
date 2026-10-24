import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCommand,commandDefinition} from '../dist/core/commands.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';
const op=(command,args)=>({command,arguments:args});
const preview=(p,operations)=>prepareCommand(p,'project.preview',{operations});
test('preflight reuses exact batch schema and summarizes detached sequential changes without text or IDs',()=>{
 assert.deepEqual(commandDefinition('project.preview').inputSchema,commandDefinition('project.batch').inputSchema);
 const p=createDemoProject(),before=structuredClone(p),operations=[op('timeline.duplicate',{clipIndex:0}),op('captions.remove',{captionIndex:0,count:2}),op('project.update',{patch:{speed:2}})];
 const r=preview(p,operations);assert.equal(Object.hasOwn(r,'project'),false);assert.equal(r.data.wouldCommit,true);assert.equal(r.data.operationCount,3);assert.deepEqual(r.data.before,{clipCount:1,captionCount:3,cardCount:0,outputDuration:12});assert.deepEqual(r.data.after,{clipCount:2,captionCount:1,cardCount:0,outputDuration:12});
 const actual=prepareCommand(p,'project.batch',{operations}).project;
 assert.deepEqual(r.data.changedFields,Object.keys(actual).filter(k=>JSON.stringify(p[k])!==JSON.stringify(actual[k])).sort());assert.deepEqual(p,before);assert.equal(JSON.stringify(r).includes(p.captions[0].text),false);
 r.data.before.clipCount=99;assert.equal(p.clips.length,1);
});
test('wouldCommit follows prepared project, not net equality',()=>{
 const p=createDemoProject();
 assert.equal(preview(p,[op('timeline.move',{clipIndex:0,toIndex:0})]).data.wouldCommit,false);
 const r=preview(p,[op('project.update',{patch:{name:'temporary'}}),op('project.update',{patch:{name:p.name}})]).data;assert.equal(r.wouldCommit,true);assert.deepEqual(r.changedFields,[]);
 assert.equal(preview(p,[op('project.update',{patch:{}})]).data.wouldCommit,true);
});
test('invalid operations share indexed batch failures, and preview cannot nest or enter a batch',()=>{
 const p=createDemoProject(),before=structuredClone(p),valid=op('project.update',{patch:{name:'draft'}}),invalid=op('captions.remove',{captionIndex:100});
 for(const operations of [[invalid],[valid,invalid],[valid,valid,invalid]]){
  let expected;try{prepareCommand(p,'project.batch',{operations});}catch(e){expected=e;}
  assert.throws(()=>preview(p,operations),e=>e.code===expected.code&&e.path===expected.path);
 }
 for(const command of ['project.preview','project.batch','project.import','project.get','jobs.submit'])assert.throws(()=>preview(p,[op(command,{})]));
 for(const operations of [[],Array.from({length:21},()=>valid)])assert.throws(()=>preview(p,operations));
 assert.equal(preview(p,Array.from({length:20},()=>valid)).data.operationCount,20);
 assert.throws(()=>prepareCommand(p,'project.batch',{operations:[op('project.preview',{operations:[valid]})]}));assert.deepEqual(p,before);
});
test('service captures arguments, queues current state, and never commits or runs guards/providers for preview',async()=>{
 let p=createDemoProject(),commits=0,guards=0;const service=createEditorService({getProject:()=>p,commitProject:next=>{p=next;commits++;},jobs:Object.fromEntries(['submit','get','cancel'].map(k=>[k,()=>assert.fail('provider')]))});
 const edit=service.execute('project.update',{patch:{speed:2}}),args={operations:[op('timeline.duplicate',{clipIndex:0})]};const read=service.execute('project.preview',args,()=>guards++);args.operations[0].arguments.clipIndex=99;
 assert.equal((await edit).ok,true);const result=await read;assert.equal(result.ok,true);assert.equal(result.data.before.outputDuration,6);assert.equal(result.data.after.outputDuration,12);assert.equal(p.clips.length,1);assert.equal(commits,1);assert.equal(guards,0);
 const adapter=createMcpToolAdapter({resolveService:()=>service}),tool=adapter.listTools().tools.find(t=>t.name==='moment_project_preview');assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,openWorldHint:false});
 const r=await adapter.callTool('moment_project_preview',{projectId:'session',operations:[op('project.update',{patch:{name:'not committed'}})]});assert.equal(r.isError,false);assert.deepEqual(r.structuredContent.data.changedFields,['name']);assert.notEqual(p.name,'not committed');assert.equal(commits,1);
});
