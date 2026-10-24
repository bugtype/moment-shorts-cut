import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCommand} from '../dist/core/commands.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {TEMPLATES,REFERENCE_SOURCES} from '../dist/template-catalog.mjs';
import {newCard} from '../dist/effects.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';
const inspect=(p,args)=>prepareCommand(p,'template.inspect',args);
test('all 16 builtins report exact apply content/timing at short, normal and long outputs in both modes',()=>{
 assert.equal(TEMPLATES.length,16);
 for(const seconds of [2,12,60])for(const speed of [.25,2])for(const template of TEMPLATES)for(const withContent of [false,true]){
  const p=createDemoProject();p.duration=seconds;p.clips=[{start:0,end:seconds}];p.speed=speed;p.design.title.lines=['Authored <b>标题','literal'];p.design.credit.text='My credit';p.overlays=[{...newCard(seconds/speed),id:'owned',text:'User card',detail:'detail',label:'label'}];
  const before=structuredClone(p),r=inspect(p,{templateId:template.id,withContent});assert.equal(Object.hasOwn(r,'project'),false);const actual=prepareCommand(p,'template.apply',{templateId:template.id,withContent}).project;
  const {title,credit}=actual.design;assert.deepEqual(r.data.title,{lines:title.lines,enabled:title.enabled,start:title.start,end:title.end});assert.deepEqual(r.data.credit,{text:credit.text,enabled:credit.enabled,start:credit.start,end:credit.end});
  assert.deepEqual(r.data.cards,actual.overlays.map((c,index)=>({index,role:c.role,text:c.text,detail:c.detail,label:c.label,enabled:c.enabled,start:c.start,end:c.end})));
  assert.equal(r.data.outputDuration,seconds/speed);assert.equal(r.data.withContent,withContent);assert.deepEqual(r.data.template.reference,REFERENCE_SOURCES[template.source]||null);assert.deepEqual(p,before);
  assert.ok(r.data.cards.every(c=>!Object.hasOwn(c,'id')));assert.equal(Object.hasOwn(r.data,'captions'),false);assert.equal(Object.hasOwn(r.data,'project'),false);
 }
});
test('default false retains authored content and nullable ends; reports/catalog references are detached',()=>{
 const p=createDemoProject();p.design.title.end=null;p.design.credit.end=null;p.design.title.lines=['My text',''];
 const before=structuredClone(TEMPLATES),r=inspect(p,{templateId:'hook-result'}).data;assert.equal(r.withContent,false);assert.deepEqual(r.title.lines,p.design.title.lines);
 r.template.flow.push('changed');r.template.exampleTitle[0]='changed';r.template.reference.title='changed';r.title.lines[0]='changed';assert.deepEqual(TEMPLATES,before);assert.equal(p.design.title.lines[0],'My text');
});
test('invalid inputs, unknown templates and batch admission fail without changing source',()=>{
 const p=createDemoProject(),before=structuredClone(p);
 assert.throws(()=>inspect(p,{templateId:'missing'}),e=>e.code==='NOT_FOUND');
 for(const args of [{},{templateId:null},{templateId:'reference',withContent:null},{templateId:'reference',extra:1}])assert.throws(()=>inspect(p,args));
 assert.throws(()=>prepareCommand(p,'project.batch',{operations:[{command:'template.inspect',arguments:{templateId:'reference'}}]}));assert.deepEqual(p,before);
});
test('service and MCP inspection are read-only, never invoking commits, guards or jobs',async()=>{
 const p=createDemoProject(),before=structuredClone(p),service=createEditorService({getProject:()=>p,commitProject(){assert.fail('commit');},jobs:Object.fromEntries(['submit','get','cancel'].map(k=>[k,()=>assert.fail('provider')]))});
 const r=await service.execute('template.inspect',{templateId:'hook-result',withContent:true},()=>assert.fail('guard'));assert.equal(r.ok,true);assert.deepEqual(p,before);
 const adapter=createMcpToolAdapter({resolveService:()=>service}),tool=adapter.listTools().tools.find(t=>t.name==='moment_template_inspect');assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,openWorldHint:false});
 const result=await adapter.callTool('moment_template_inspect',{projectId:'session',templateId:'hook-result'});assert.equal(result.isError,false);assert.equal(result.structuredContent.data.template.id,'hook-result');assert.deepEqual(p,before);
});
