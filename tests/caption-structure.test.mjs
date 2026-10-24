import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCommand,commandDefinition} from '../dist/core/commands.mjs';
import {createDemoProject,captionSchema} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';
import {formatError,setLocale,initLocale} from '../dist/i18n.mjs';
const insert=(project,captionIndex,caption)=>prepareCommand(project,'captions.insert',{captionIndex,caption});
const remove=(project,captionIndex)=>prepareCommand(project,'captions.remove',{captionIndex});
const cue={start:1,end:2,text:'  <b>字 👩🏽‍💻 e\u0301</b>\n',basis:'source',speaker:'1',keywords:'字,raw',timing:'estimated'};

test('insert first, middle, append and empty arrays copies exact cue data without sorting or retiming',()=>{
 for(const index of [0,1,3]){
  const p=createDemoProject();p.speed=2;p.clips=[{start:8,end:12},{start:0,end:4},{start:0,end:4}];const before=structuredClone(p),input=structuredClone(cue);
  const result=insert(p,index,input),expected=structuredClone(p);expected.captions.splice(index,0,cue);
  assert.deepEqual(result.project,expected);assert.deepEqual(result.data,{updated:true,captionIndex:index,totalCaptions:4,outputDuration:6});assert.deepEqual(p,before);assert.deepEqual(input,cue);
  result.project.captions[index].text='Result only';assert.deepEqual(input,cue);assert.deepEqual(p,before);
 }
 const p=createDemoProject();p.captions=[];
 for(const text of ['', '  ', '\0', '😀'.repeat(1000)]){
  const result=insert(p,0,{start:0,end:12,text});assert.equal(result.project.captions[0].text,text);assert.equal(Object.hasOwn(result.project.captions[0],'basis'),false);
 }
});

test('remove first, middle, last and final cue preserves all surviving content and metadata',()=>{
 for(const index of [0,1,2]){
  const p=createDemoProject();p.captions[1]=structuredClone(cue);const before=structuredClone(p),expected=structuredClone(p);expected.captions.splice(index,1);
  const result=remove(p,index);assert.deepEqual(result.project,expected);assert.deepEqual(result.data,{updated:true,captionIndex:index,totalCaptions:2,outputDuration:12});assert.deepEqual(p,before);
 }
 const p=createDemoProject();p.captions=[structuredClone(cue)];assert.deepEqual(remove(p,0).project.captions,[]);assert.deepEqual(remove(p,0).data,{updated:true,captionIndex:0,totalCaptions:0,outputDuration:12});
});

test('new cues use explicit source or pre-speed timeline bounds without repairing existing cues',()=>{
 const p=createDemoProject();p.speed=4;p.clips=[{start:0,end:2},{start:0,end:2}];p.captions[0]={start:8,end:12,text:'Existing out-of-range timeline',basis:'timeline'};
 assert.equal(insert(p,1,{start:11,end:12,text:'Source'}).project.captions[1].end,12);
 assert.equal(insert(p,1,{start:3.9,end:4,text:'Timeline',basis:'timeline'}).project.captions[1].end,4);
 assert.throws(()=>insert(p,1,{start:4,end:5,text:'Too late',basis:'timeline'}),e=>e.code==='INVALID_ARGUMENT'&&e.path==='arguments.caption');
 assert.deepEqual(insert(p,0,{start:0,end:.1,text:'A'}).project.captions[1],p.captions[0]);
 p.duration=86400;p.clips=[{start:0,end:86400},{start:0,end:86400}];
 assert.equal(insert(p,0,{start:86399,end:86400,text:'Boundary',basis:'timeline'}).project.captions[0].end,86400);
 assert.throws(()=>insert(p,0,{start:86400,end:86401,text:'Schema ceiling',basis:'timeline'}));
});

test('invalid positions, fields and timing reject atomically; insertion capacity is exactly 10000',()=>{
 const p=createDemoProject(),before=structuredClone(p);
 for(const index of [-1,4,10000,.5,'0',null,NaN,Infinity])assert.throws(()=>insert(p,index,cue),e=>e.code==='INVALID_ARGUMENT');
 for(const index of [-1,3,9999,.5,'0',null,NaN,Infinity])assert.throws(()=>remove(p,index),e=>e.code==='INVALID_ARGUMENT');
 for(const caption of [null,{}, {...cue,unknown:true},{...cue,text:7},{...cue,text:'x'.repeat(2001)},{...cue,keywords:'x'.repeat(501)},{...cue,speaker:'2'},{...cue,timing:'exact'},{...cue,basis:'output'},{...cue,start:-1},{...cue,start:2},{...cue,end:1},{...cue,end:13},{...cue,end:NaN}])assert.throws(()=>insert(p,1,caption),e=>e.code==='INVALID_ARGUMENT');
 assert.deepEqual(p,before);p.captions=[];assert.throws(()=>remove(p,0));
 p.captions=Array.from({length:9999},()=>({start:0,end:1,text:'Same'}));const full=insert(p,9999,cue);assert.equal(full.project.captions.length,10000);assert.equal(full.data.captionIndex,9999);assert.equal(p.captions.length,9999);
 const fullBefore=JSON.stringify(full.project);assert.throws(()=>insert(full.project,10000,cue),e=>e.code==='INVALID_ARGUMENT');assert.equal(JSON.stringify(full.project),fullBefore);
 assert.equal(remove(full.project,9999).project.captions.length,9999);
});

test('sequential batch indices prepare atomically and service commits once with detached captured input',async()=>{
 let project=createDemoProject(),commits=0;const service=createEditorService({getProject:()=>project,commitProject:next=>{project=next;commits++;}});
 const input={captionIndex:1,caption:structuredClone(cue)},pending=service.execute('captions.insert',input);input.caption.text='Changed caller';input.captionIndex=0;
 assert.equal((await pending).ok,true);assert.deepEqual(project.captions[1],cue);assert.equal(commits,1);
 const before=structuredClone(project);const rejected=await service.execute('project.batch',{operations:[{command:'captions.remove',arguments:{captionIndex:0}},{command:'captions.insert',arguments:{captionIndex:99,caption:cue}}]});
 assert.equal(rejected.ok,false);assert.match(rejected.error.path,/arguments.operations\[1\]/);assert.deepEqual(project,before);assert.equal(commits,1);
 const result=await service.execute('project.batch',{operations:[{command:'captions.remove',arguments:{captionIndex:1}},{command:'captions.insert',arguments:{captionIndex:0,caption:{start:0,end:1,text:'Inserted'}}},{command:'captions.update',arguments:{captionIndex:0,patch:{text:'Reviewed'}}}]});
 assert.equal(result.ok,true);assert.equal(commits,2);assert.equal(project.captions[0].text,'Reviewed');assert.deepEqual(project.captions.slice(1),createDemoProject().captions);
 const failing=createEditorService({getProject:()=>project,commitProject:()=>{throw new Error('storage');}});const failed=await failing.execute('captions.remove',{captionIndex:0});assert.equal(failed.ok,false);assert.equal(project.captions[0].text,'Reviewed');assert.equal((await failing.execute('captions.list')).ok,true);
});

test('MCP advertises structural mutation and isolated cue schemas; diagnostics remain localized',async()=>{
 let p=createDemoProject();const service=createEditorService({getProject:()=>p,commitProject:next=>{p=next;},formatErrorMessage:formatError});const adapter=createMcpToolAdapter({resolveService:()=>service});
 const tools=adapter.listTools().tools;
 for(const name of ['captions.insert','captions.remove']){assert.equal(commandDefinition(name).mutates,true);assert.equal(tools.find(t=>t.name==='moment_'+name.replace('.','_')).annotations.readOnlyHint,false);}
 const schema=tools.find(t=>t.name==='moment_captions_insert').inputSchema.properties.caption;assert.deepEqual(Object.keys(schema.properties),Object.keys(captionSchema.properties));schema.properties.text.maxLength=1;assert.equal(captionSchema.properties.text.maxLength,2000);
 assert.equal((await adapter.callTool('moment_captions_insert',{projectId:'session',captionIndex:0,caption:cue})).isError,false);
 const result=await adapter.callTool('moment_captions_remove',{projectId:'session',captionIndex:0});assert.equal(result.isError,false);assert.equal(result.structuredContent.data.totalCaptions,3);
 try{for(const locale of ['ko','en','zh-CN']){setLocale(locale,{persist:false});for(const name of ['captions.insert','captions.remove']){const r=await service.execute(name,{captionIndex:null,...(name==='captions.insert'?{caption:cue}:{})});assert.equal(r.error.code,'INVALID_ARGUMENT');assert.equal(r.error.path,'arguments.captionIndex');if(locale!=='ko')assert.doesNotMatch(r.error.message,/[가-힣]/);}}}finally{initLocale();}
});
