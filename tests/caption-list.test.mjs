import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {prepareCommand,commandDefinition} from '../dist/core/commands.mjs';
import {createDemoProject,captionSchema} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';
import {initLocale,setLocale,formatError} from '../dist/i18n.mjs';
import {createAppFixture} from './fixtures/app.mjs';
const list=(project,args={})=>prepareCommand(project,'captions.list',args);

test('pages preserve exact authored order, optional metadata and clocks without exposing mutable references',()=>{
 const p=createDemoProject();p.speed=4;p.clips=[{start:8,end:12},{start:0,end:4},{start:0,end:4}];
 p.captions=[{start:8,end:10,text:'  <b>한글 👩🏽‍💻 e\u0301</b>\n\0 '},{start:0,end:2,text:'',basis:'timeline',speaker:'1',keywords:'字,word',timing:'estimated'},{start:1,end:3,text:'Last',basis:'source',speaker:''}];
 const before=structuredClone(p),result=list(p);
 assert.equal(Object.hasOwn(result,'project'),false);
 assert.deepEqual(result.data,{totalCaptions:3,offset:0,limit:20,nextOffset:null,captions:p.captions.map((caption,captionIndex)=>({captionIndex,caption}))});
 assert.equal(Object.hasOwn(result.data.captions[0].caption,'basis'),false);
 result.data.captions[1].caption.text='Mutated result';result.data.captions.push({});assert.deepEqual(p,before);
 const page=list(p,{offset:1,limit:1}).data;assert.equal(page.nextOffset,2);assert.deepEqual(page.captions,[{captionIndex:1,caption:before.captions[1]}]);
 for(const offset of [3,4,10000])assert.deepEqual(list(p,{offset,limit:50}).data,{totalCaptions:3,offset,limit:50,nextOffset:null,captions:[]});
 p.captions=[];assert.deepEqual(list(p).data,{totalCaptions:0,offset:0,limit:20,nextOffset:null,captions:[]});
});

test('all 10000 authored rows can be traversed once using bounded pages and nextOffset',()=>{
 const p=createDemoProject();p.captions=Array.from({length:10000},(_,index)=>({start:index%10,end:index%10+1,text:'Cue '+index}));
 const before=JSON.stringify(p),rows=[];let offset=0,pages=0;
 do{const page=list(p,{offset,limit:50}).data;assert.ok(page.captions.length<=50);assert.equal(page.totalCaptions,10000);rows.push(...page.captions);offset=page.nextOffset;pages++;}while(offset!==null);
 assert.equal(pages,200);assert.equal(rows.length,10000);assert.deepEqual(rows.map(row=>row.captionIndex),Array.from({length:10000},(_,index)=>index));
 assert.deepEqual(rows.map(row=>row.caption),p.captions);assert.equal(JSON.stringify(p),before);
 assert.equal(list(p,{offset:9999,limit:50}).data.nextOffset,null);
});

test('invalid page arguments fail atomically and read commands remain outside the edit batch',()=>{
 const p=createDemoProject(),before=structuredClone(p);
 for(const offset of [-1,10001,.5,null,'0',NaN,Infinity])assert.throws(()=>list(p,{offset}),error=>error.code==='INVALID_ARGUMENT');
 for(const limit of [-1,0,51,.5,null,'20',NaN,Infinity])assert.throws(()=>list(p,{limit}),error=>error.code==='INVALID_ARGUMENT');
 for(const args of [null,[],{unknown:true},{offset:undefined}])assert.throws(()=>list(p,args));
 assert.throws(()=>prepareCommand(p,'project.batch',{operations:[{command:'captions.list',arguments:{}}]}),error=>error.code==='INVALID_ARGUMENT');
 assert.deepEqual(p,before);assert.equal(commandDefinition('captions.list').mutates,false);
});

test('service pages honor queue order and captured arguments without commit, provider or beforeCommit work',async()=>{
 let project=createDemoProject(),commits=0,provider=0,guards=0;
 const jobs=Object.fromEntries(['submit','get','cancel'].map(name=>[name,()=>{provider++;throw new Error(name);} ]));
 const service=createEditorService({getProject:()=>project,commitProject:next=>{project=next;commits++;},jobs});
 const args={offset:1,limit:1};const read=service.execute('captions.list',args,()=>guards++);args.offset=0;
 assert.equal((await read).data.captions[0].captionIndex,1);assert.equal(commits,0);assert.equal(guards,0);assert.equal(provider,0);
 const edit=service.execute('captions.update',{captionIndex:1,patch:{text:'Queued edit'}}),next=service.execute('captions.list',{offset:1,limit:1});
 assert.equal((await edit).ok,true);assert.equal((await next).data.captions[0].caption.text,'Queued edit');assert.equal(commits,1);
 const returned=await service.execute('captions.list');returned.data.captions[0].caption.text='Detached';assert.notEqual(project.captions[0].text,'Detached');
});

test('MCP page output schemas and read-only annotations are isolated from project validation',async()=>{
 const project=createDemoProject(),service=createEditorService({getProject:()=>project,commitProject:()=>assert.fail('must not commit')});
 const adapter=createMcpToolAdapter({resolveService:()=>service});
 const tool=adapter.listTools().tools.find(tool=>tool.name==='moment_captions_list');
 assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,openWorldHint:false});
 const data=tool.outputSchema.oneOf[0].properties.data;
 assert.deepEqual(data.properties.captions.items.properties.caption,captionSchema);assert.equal(data.properties.captions.maxItems,50);
 data.properties.captions.items.properties.caption.properties.text.maxLength=1;
 assert.equal(captionSchema.properties.text.maxLength,2000);
 const again=adapter.listTools().tools.find(item=>item.name==='moment_captions_list');assert.equal(again.outputSchema.oneOf[0].properties.data.properties.captions.items.properties.caption.properties.text.maxLength,2000);
 const r=await adapter.callTool('moment_captions_list',{projectId:'session',offset:2,limit:1});assert.equal(r.isError,false);assert.equal(r.structuredContent.data.nextOffset,null);assert.equal(r.structuredContent.data.captions[0].captionIndex,2);
 assert.deepEqual(JSON.parse(r.content[0].text),r.structuredContent);
});

test('actual browser read leaves drafts, selection, history and saves unchanged even during export',async()=>{
 const f=await createAppFixture();vm.runInContext('history=[];future=[];current=2;selected=0;globalThis.listSaves=0;scheduleSave=()=>listSaves++;exporting=true;',f.context);
 f.element('#trimStart').value='1.50';f.element('#trimEnd').value='3.50';const before=f.evaluate('({state,history,future,current,selected})');
 const r=await f.context.window.moment.execute('captions.list',{offset:1,limit:1});assert.equal(r.ok,true);assert.equal(r.data.captions[0].captionIndex,1);
 assert.deepEqual(f.evaluate('({state,history,future,current,selected})'),before);assert.equal(f.evaluate('listSaves'),0);assert.deepEqual([f.element('#trimStart').value,f.element('#trimEnd').value],['1.50','3.50']);
});

test('page validation diagnostics localize without changing the error envelope',async()=>{
 const service=createEditorService({getProject:createDemoProject,commitProject:()=>assert.fail('must not commit'),formatErrorMessage:formatError});
 try{for(const locale of ['ko','en','zh-CN']){setLocale(locale,{persist:false});for(const field of ['offset','limit']){
  const r=await service.execute('captions.list',{[field]:null});assert.equal(r.error.code,'INVALID_ARGUMENT');assert.equal(r.error.path,'arguments.'+field);assert.deepEqual(Object.keys(r.error).sort(),['code','message','path']);
  if(locale!=='ko')assert.doesNotMatch(r.error.message,/[가-힣]/);
 }}}finally{initLocale();}
});
