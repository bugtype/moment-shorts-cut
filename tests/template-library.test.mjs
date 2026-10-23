import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoProject,validateProject} from '../dist/core/project.mjs';
import {TEMPLATES,applyTemplate,saveCustomTemplate} from '../dist/template-catalog.mjs';
import {readTemplateLibrary,validateTemplateLibrary} from '../dist/template-library.mjs';

function saved(){const project=createDemoProject();applyTemplate(project,TEMPLATES.find(t=>t.id==='recipe'),true);return saveCustomTemplate('내 구성',project);}

test('current and supported legacy templates validate without normalizing their stored representation',()=>{
 const current=saved(),legacy=structuredClone(current);legacy.id+='-legacy';delete legacy.relativeTiming;
 for(const card of legacy.cards)for(const key of ['presentation','backgroundOpacity','stroke','role','enabled','x'])delete card[key];
 const templates=[current,legacy],raw=JSON.stringify(templates),favorites=[current.id,'reference','deleted-old-id'];
 assert.deepEqual(readTemplateLibrary(raw,JSON.stringify(favorites)),{templates,favorites});
 assert.equal(JSON.stringify(templates),raw);
 for(const template of templates)for(const withContent of [false,true]){
  const project=createDemoProject();applyTemplate(project,template,withContent);validateProject(project);
 }
 assert.deepEqual(readTemplateLibrary(null,null),{templates:[],favorites:[]});
});

test('malformed entries and nested settings reject the entire library without mutation',()=>{
 const good=saved();
 const invalid=[null,1,'template',[],{}, {...good,custom:false},{...good,id:'reference'}, {...good,name:''},
  {...good,flow:null},{...good,title:['one']},{...good,cards:[null]}, {...good,cards:[{}]},
  {...good,relativeTiming:'true'}, {...good,settings:null}, {...good,settings:{...good.settings,duration:1}},
  {...good,settings:{...good.settings,design:{}}}, {...good,settings:{...good.settings,captionSize:NaN}},
  {...good,settings:{...good.settings,captionColor:'not a color'}},
  {...good,settings:{...good.settings,effects:{...good.settings.effects,motion:'unknown'}}},
 ];
 for(const entry of invalid){
  const templates=[good,entry],before=structuredClone(templates);
  assert.throws(()=>validateTemplateLibrary(templates,[]));assert.deepEqual(templates,before);
 }
 assert.throws(()=>validateTemplateLibrary([good,good],[]));
 assert.throws(()=>validateTemplateLibrary(Array.from({length:21},(_,i)=>({...good,id:'custom-'+i})),[]));
 for(const raw of ['','null','{}','true','[null]','['])assert.throws(()=>readTemplateLibrary(raw,'[]'));
 for(const raw of ['','null','{}','[null]','[3]','['])assert.throws(()=>readTemplateLibrary('[]',raw));
});
