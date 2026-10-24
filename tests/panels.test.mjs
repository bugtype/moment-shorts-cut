import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProject } from '../dist/core/project.mjs';
import { createInputHistory } from '../dist/input-history.mjs';
import * as effectsModule from '../dist/effects.mjs';
import * as templateModule from '../dist/template-catalog.mjs';
import { mountDesignPanel } from '../dist/design-panel.mjs';
import { mountEffectsPanel } from '../dist/effects-panel.mjs';
import { mountTemplateGallery } from '../dist/template-gallery.mjs';

test('design, effects and template panel controls and hierarchy', () => {
  const defaults = createDemoProject(), savedProject = structuredClone(defaults);
  templateModule.applyTemplate(savedProject,templateModule.TEMPLATES.find(t=>t.id==='recipe'),true);
  const custom=templateModule.saveCustomTemplate('내 요리 구성',savedProject);
  // Panel controls are exercised with supplied DOM controls (not a browser layout test).
  function control(type,dataset,value){return {type,dataset,value,checked:false,setCustomValidity(message){this.error=message;},reportValidity(){this.reported=true;}};}
  function panelRoot(lists={},byId={}){return {innerHTML:'',querySelectorAll(selector){return lists[selector]||[];},querySelector(selector){return byId[selector]||null;}};}
  const inputs=[control('number',{design:'design.title.start'},'5'),control('number',{design:'design.title.end'},'3'),control('text',{design:'speakerLabels.1'},'인터뷰이'),control('text',{design:'globalKeywords'},'순간, C++'),control('range',{design:'captionY',unit:'%'},'75')];
  let panelProject=structuredClone(defaults),snapshots=0;
  const panelRanges=createInputHistory(()=>snapshots++);
  mountDesignPanel(panelRoot({'[data-design]':inputs}),{state:panelProject,layer:'caption',total:12,snapshot(){snapshots++;},input:panelRanges.bind,update(fn){fn(panelProject);}});
  inputs[0].onchange();assert.equal(panelProject.design.title.start,5);
  inputs[1].onchange();assert.equal(panelProject.design.title.end,null);assert.ok(inputs[1].error);
  inputs[1].value='9';inputs[1].onchange();assert.equal(panelProject.design.title.end,9);assert.equal(inputs[1].error,'');
  inputs[2].oninput();assert.equal(panelProject.speakerLabels[1],'인터뷰이');
  inputs[3].oninput();assert.equal(panelProject.globalKeywords,'순간, C++');
  inputs[4].oninput();assert.equal(panelProject.captionY,.75);const rangeSnapshots=snapshots;inputs[4].oninput();assert.equal(snapshots,rangeSnapshots);
  const testCard=effectsModule.newCard(12,2);panelProject.overlays=[testCard];
  const cardInputs=[control('number',{card:'start'},'8'),control('number',{card:'end'},'9'),control('text',{card:'text'},'수정한 카드'),control('range',{card:'size'},'42')];
  const buttons=Object.fromEntries(['#addSceneCard','#toggleSceneLayers','#removeSceneCard','#duplicateSceneCard','#previewSceneCard'].map(id=>[id,{}]));
  const cardRoot=panelRoot({'[data-card]':cardInputs},buttons);
  mountEffectsPanel(panelRoot({}, {'#effectControls':cardRoot}),{state:panelProject,total:12,tab:'cards',selected:testCard.id,snapshot(){snapshots++;},input:panelRanges.bind,update(fn){fn(panelProject);},add(){},remove(){},duplicate(){},play(){}});
  cardInputs[0].onchange();assert.equal(testCard.start,2);assert.ok(cardInputs[0].error);
  cardInputs[1].onchange();cardInputs[0].onchange();assert.equal(testCard.start,8);assert.equal(testCard.end,9);
  cardInputs[2].oninput();assert.equal(testCard.text,'수정한 카드');cardInputs[3].oninput();assert.equal(testCard.size,42);
  const fxInputs=[control('range',{effect:'brightness'},'1.25'),control('select-one',{effect:'motion'},'out'),control('checkbox',{effect:'progress'},'')];fxInputs[2].checked=true;
  mountEffectsPanel(panelRoot({}, {'#effectControls':panelRoot({'[data-effect]':fxInputs},{'#resetEffects':{}})}),{state:panelProject,total:12,tab:'motion',snapshot(){snapshots++;},input:panelRanges.bind,update(fn){fn(panelProject);},reset(){}});
  fxInputs[0].oninput();fxInputs[1].onchange();fxInputs[2].onchange();
  assert.equal(panelProject.effects.brightness,1.25);assert.equal(panelProject.effects.motion,'out');assert.equal(panelProject.effects.progress,true);
  console.log('PASS: actual panel event handlers, invalid timing rejection and correction, speaker/global keyword edits and motion/color controls.');
  
  // Primary controls precede composition presets; moving markup keeps existing actions intact.
  const panelActions=[];
  for(const layer of ['title','caption','credit','frame']){
   const layerButtons=['title','caption','credit','frame'].map(textLayer=>({dataset:{textLayer}}));
   const presetButtons=['reference','punch','clean'].map(layoutPreset=>({dataset:{layoutPreset}}));
   const links=Object.fromEntries(['#openTemplateGallery','#openCaptionEditor','#openScreenEditor'].map(id=>[id,{}]));
   const root=panelRoot({'[data-text-layer]':layerButtons,'[data-layout-preset]':presetButtons},links);
   mountDesignPanel(root,{state:panelProject,layer,total:12,select(value){panelActions.push(['layer',value]);},preset(value){panelActions.push(['preset',value]);},navigate(value){panelActions.push(['navigate',value]);}});
   assert.match(root.innerHTML,/<h1 class="panel-heading">타이틀 · 디자인<\/h1>/);
   assert.ok(root.innerHTML.indexOf('class="layer-tabs"')<root.innerHTML.indexOf('class="layer-controls"'));
   assert.ok(root.innerHTML.indexOf('class="layer-controls"')<root.innerHTML.indexOf('class="design-presets"'));
   assert.ok(!root.innerHTML.includes('SHORTS TYPOGRAPHY'));assert.ok(!root.innerHTML.includes('각각의 역할에 맞게 디자인하세요'));
   assert.match(root.innerHTML,new RegExp(`aria-selected="true" data-text-layer="${layer}"`));
   assert.equal((root.innerHTML.match(/aria-selected="true"/g)||[]).length,1);
   assert.ok(root.innerHTML.includes('출력 시 해상도에 맞춰 확대됩니다.'));
   if(layer==='title'||layer==='credit')assert.ok(root.innerHTML.includes('끝을 비워두면 영상 끝까지 표시합니다.'));
   if(layer==='caption')assert.ok(root.innerHTML.includes('쉼표로 구분합니다.'));
   layerButtons.find(button=>button.dataset.textLayer===layer).onclick();
   if(layer==='title'){presetButtons.forEach(button=>button.onclick());links['#openTemplateGallery'].onclick();}
   if(layer==='caption')links['#openCaptionEditor'].onclick();
   if(layer==='frame')links['#openScreenEditor'].onclick();
  }
  assert.deepEqual(panelActions,[['layer','title'],['preset','reference'],['preset','punch'],['preset','clean'],['navigate','templates'],['layer','caption'],['navigate','captions'],['layer','credit'],['layer','frame'],['navigate','settings']]);
  for(const tab of ['cards','motion']){
   const tabs=['cards','motion'].map(effectTab=>({dataset:{effectTab}})),selected=[];
   const root=panelRoot({'[data-effect-tab]':tabs},{'#effectControls':tab==='cards'?cardRoot:panelRoot({},{'#resetEffects':{}})});
   mountEffectsPanel(root,{state:panelProject,total:12,tab,selected:testCard.id,input:panelRanges.bind,changeTab(value){selected.push(value);}});
   assert.match(root.innerHTML,/<h1 class="panel-heading">연출<\/h1><div class="layer-tabs" role="tablist" aria-label="연출 도구">/);
   assert.match(root.innerHTML,new RegExp(`data-effect-tab="${tab}" role="tab" aria-selected="true"`));
   assert.equal((root.innerHTML.match(/aria-selected="true"/g)||[]).length,1);assert.ok(!root.innerHTML.includes('STORY & MOTION'));
   tabs.forEach(button=>button.onclick());assert.deepEqual(selected,['cards','motion']);
  }
  console.log('PASS: design/effects control-first hierarchy retains selected tabs, preset/navigation actions and essential timing/input instructions.');
  
  
  // Gallery hierarchy, accessible filter groups and existing actions remain connected.
  const search={},grid={innerHTML:''},count={},saveButton={};
  const categories=['전체','리뷰','정보','라이프','대화','참여','즐겨찾기','내 템플릿'].map(category=>({dataset:{category},classList:{toggle(){}},setAttribute(name,value){this[name]=value;}}));
  const previewButton={dataset:{previewTemplate:'recipe'}},favoriteButton={dataset:{favorite:'recipe'}},removeButton={dataset:{removeTemplate:custom.id}};
  const galleryActions=[];
  const galleryRoot=panelRoot({'[data-category]':categories,'[data-preview-template]':[previewButton],'[data-favorite]':[favoriteButton],'[data-remove-template]':[removeButton]}, {'#templateSearch':search,'#templateGrid':grid,'#templateCount':count,'#saveMyTemplate':saveButton,'#importMyTemplate':{},'#templateFileInput':{}});
  const galleryState={query:'',category:'전체'},galleryApi={ui:galleryState,custom:[],favorites:['recipe'],active:'reference',save(){galleryActions.push('save');},preview(item){galleryActions.push(['preview',item.id]);},favorite(id){galleryActions.push(['favorite',id]);},remove(id){galleryActions.push(['remove',id]);}};
  mountTemplateGallery(galleryRoot,galleryApi);assert.equal(count.textContent,'10개의 구성');
  assert.match(galleryRoot.innerHTML,/<div class="gallery-heading"><h1 class="panel-heading">템플릿<\/h1><button[^>]*id="importMyTemplate"/);
  assert.ok(galleryRoot.innerHTML.indexOf('id="saveMyTemplate"')<galleryRoot.innerHTML.indexOf('id="templateSearch"'));
  assert.match(galleryRoot.innerHTML,/role="group" aria-label="템플릿 분류"/);
  assert.match(galleryRoot.innerHTML,/role="group" aria-label="개인 템플릿"/);
  assert.match(galleryRoot.innerHTML,/aria-label="템플릿 검색"/);
  assert.equal((galleryRoot.innerHTML.match(/data-category=/g)||[]).length,8);
  assert.ok(!galleryRoot.innerHTML.includes('TEMPLATE STUDIO'));assert.ok(!galleryRoot.innerHTML.includes('gallery-disclosure'));
  assert.ok(!grid.innerHTML.includes('template-tag'));assert.ok(grid.innerHTML.includes('· 적용됨'));
  assert.match(grid.innerHTML,/aria-label="한눈에 보는 레시피 미리보기"/);assert.match(grid.innerHTML,/aria-label="한눈에 보는 레시피 즐겨찾기" aria-pressed="true"/);
  saveButton.onclick();previewButton.onclick();favoriteButton.onclick();removeButton.onclick();
  assert.deepEqual(galleryActions,['save',['preview','recipe'],['favorite','recipe'],['remove',custom.id]]);
  categories[6].onclick();assert.equal(galleryState.category,'즐겨찾기');assert.equal(count.textContent,'1개의 구성');
  assert.deepEqual(categories.map(button=>button['aria-pressed']),[false,false,false,false,false,false,true,false]);
  categories[1].onclick();assert.equal(galleryState.category,'리뷰');assert.equal(categories[6]['aria-pressed'],false);assert.equal(categories[1]['aria-pressed'],true);
  categories[0].onclick();assert.equal(count.textContent,'10개의 구성');
  search.oninput({target:{value:' 요리 '}});assert.ok(grid.innerHTML.includes('한눈에 보는 레시피'));
  search.oninput({target:{value:'인터뷰'}});assert.ok(grid.innerHTML.includes('인터뷰 하이라이트'));assert.ok(!grid.innerHTML.includes('시네마틱 모먼트'));
  galleryState.query='';galleryState.category='즐겨찾기';mountTemplateGallery(galleryRoot,galleryApi);assert.equal(count.textContent,'1개의 구성');assert.ok(grid.innerHTML.includes('한눈에 보는 레시피'));
  galleryState.category='내 템플릿';galleryApi.custom=[{...custom,name:'<img src=x onerror=alert(1)>'}];mountTemplateGallery(galleryRoot,galleryApi);assert.ok(grid.innerHTML.includes('&lt;img'));assert.ok(!grid.innerHTML.includes('<img'));
  galleryApi.error='<읽기 실패>';mountTemplateGallery(galleryRoot,galleryApi);assert.match(galleryRoot.innerHTML,/role="alert">&lt;읽기 실패&gt;<\/p>/);
  search.oninput({target:{value:'no matching template'}});assert.ok(grid.innerHTML.includes('조건에 맞는 템플릿이 없습니다.'));assert.equal(count.textContent,'0개의 구성');
  console.log('PASS: template gallery hierarchy, accessible filters, preview/save/favorite/delete actions, empty/error states and HTML escaping.');
  
});
