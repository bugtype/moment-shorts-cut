import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCommand,commandDefinition} from '../dist/core/commands.mjs';
import {createDemoProject,validateProject} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';
const list=(p,args={})=>prepareCommand(p,'timeline.list',args);

test('timeline pages preserve source order and playback prefix clocks across all 1000 clips',()=>{
 const p=createDemoProject();p.duration=1000;p.captions=Array.from({length:10000},()=>({start:0,end:1,text:'PRIVATE CAPTION'}));
 p.clips=Array.from({length:1000},(_,i)=>({start:i%3===0?8.123:0.2,end:i%3===0?9.987:0.5}));
 validateProject(p);const before=structuredClone(p);
 for(const speed of [.25,1,2,4]){
  p.speed=speed;let offset=0,position=0,index=0;
  do{
   const result=list(p,{offset,limit:17});assert.equal(Object.hasOwn(result,'project'),false);
   const page=result.data;assert.equal(page.totalClips,1000);assert.equal(page.speed,speed);assert.ok(page.clips.length<=17);
   assert.equal(JSON.stringify(page).includes('PRIVATE'),false);
   for(const row of page.clips){const c=p.clips[index];const start=position;position+=c.end-c.start;
    assert.deepEqual(row,{clipIndex:index++,sourceStart:c.start,sourceEnd:c.end,timelineStart:start,timelineEnd:position,outputStart:start/speed,outputEnd:position/speed});
   }
   offset=page.nextOffset;
  }while(offset!==null);
  assert.equal(index,1000);
 }
 p.speed=before.speed;assert.deepEqual(p,before);
 const page=list(p,{offset:999,limit:50}).data;assert.equal(page.clips.length,1);assert.equal(page.nextOffset,null);
 page.clips[0].sourceStart=99;assert.deepEqual(p,before);
 assert.deepEqual(list(p,{offset:1000}).data.clips,[]);
 const demo=createDemoProject();for(const offset of [1,2,1000])assert.equal(list(demo,{offset}).data.nextOffset,null);
 assert.deepEqual(list(demo).data,{totalClips:1,offset:0,limit:20,nextOffset:null,speed:1,clips:[{clipIndex:0,sourceStart:0,sourceEnd:12,timelineStart:0,timelineEnd:12,outputStart:0,outputEnd:12}]});
});

test('tiny valid intervals expose actual floating-point positions without fabricated width',()=>{
 const p=createDemoProject();p.duration=86400;p.clips=[{start:0,end:86400},{start:0,end:Number.MIN_VALUE}];validateProject(p);
 const row=list(p,{offset:1}).data.clips[0];assert.equal(row.sourceEnd,Number.MIN_VALUE);assert.equal(row.timelineStart,86400);assert.equal(row.timelineEnd,86400);
});

test('invalid pagination rejects atomically and timeline reads stay outside batches',()=>{
 const p=createDemoProject(),before=structuredClone(p);
 for(const offset of [-1,1001,.5,null,'0',NaN,Infinity])assert.throws(()=>list(p,{offset}),e=>e.code==='INVALID_ARGUMENT');
 for(const limit of [0,51,.5,null,'20',NaN,Infinity])assert.throws(()=>list(p,{limit}),e=>e.code==='INVALID_ARGUMENT');
 for(const args of [null,[],{unknown:true},{offset:undefined}])assert.throws(()=>list(p,args));
 assert.throws(()=>prepareCommand(p,'project.batch',{operations:[{command:'timeline.list',arguments:{}}]}),e=>e.code==='INVALID_ARGUMENT');
 assert.deepEqual(p,before);assert.equal(commandDefinition('timeline.list').mutates,false);
});

test('queued service and MCP reads capture arguments without mutation guards or providers',async()=>{
 let project=createDemoProject(),commits=0,guards=0;
 const service=createEditorService({getProject:()=>project,commitProject:next=>{project=next;commits++;},jobs:Object.fromEntries(['submit','get','cancel'].map(name=>[name,()=>assert.fail('provider')]))});
 const edit=service.execute('timeline.duplicate',{clipIndex:0});
 const args={offset:1,limit:1},reading=service.execute('timeline.list',args,()=>guards++);args.offset=0;
 assert.equal((await edit).ok,true);assert.equal((await reading).data.clips[0].timelineStart,12);assert.equal(commits,1);assert.equal(guards,0);
 const adapter=createMcpToolAdapter({resolveService:()=>service}),tool=adapter.listTools().tools.find(t=>t.name==='moment_timeline_list');
 assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,openWorldHint:false});
 const response=await adapter.callTool('moment_timeline_list',{projectId:'session',offset:1});assert.equal(response.isError,false);assert.equal(response.structuredContent.data.clips[0].clipIndex,1);
 response.structuredContent.data.clips[0].sourceEnd=99;assert.equal(project.clips[1].end,12);assert.equal(commits,1);
});
