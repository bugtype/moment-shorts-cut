import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createSpeedDialog,syncSpeedControl} from '../dist/speed-dialog.mjs';
import {createDemoProject,projectSubtitles} from '../dist/core/project.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {createAppFixture} from './fixtures/app.mjs';
import {setLocale,initLocale} from '../dist/i18n.mjs';
const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const presetValues=[...html.match(/<select id="speed"[\s\S]*?<\/select>/)[0].matchAll(/<option value="([\d.]+)"/g)].map(m=>m[1]);
function strictSelect(select,option){
 let value='1';Object.defineProperty(select,'value',{configurable:true,get:()=>value,set:v=>{v=String(v);value=[...presetValues,'custom',option.value].includes(v)?v:'';}});
}
function fixture(){
 let project=createDemoProject(),media=[{},{}],busy=false;const nodes=new Map(),events=[];
 const node=()=>({value:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;},focus(){events.push('focus');}});
 nodes.set('#speed',node());nodes.set('#currentSpeedOption',node());strictSelect(nodes.get('#speed'),nodes.get('#currentSpeedOption'));
 const modal={open:false,close(){this.open=false;this.onclose?.();}},query=id=>nodes.get(id)||null;
 const controller=createSpeedDialog({getProject:()=>project,getMedia:()=>media,query,modal,blocked:()=>busy,
 openModal(title,body,footer){modal.onclose?.();modal.onclose=null;for(const id of ['#customSpeedValue','#confirmCustomSpeed','#cancelCustomSpeed'])nodes.delete(id);for(const m of(body+footer).matchAll(/id="([^"]+)"/g))nodes.set('#'+m[1],node());modal.open=true;},
 execute(name,args){events.push({name,args});project=prepareCommand(project,name,args).project;return true;},toast:error=>events.push(error)});
 return{controller,query,modal,events,project:()=>project,change:()=>{project=structuredClone(project);},relink:()=>{media=[{},{}];},block:v=>{busy=v;},submit:value=>{query('#customSpeedValue').value=value;query('#confirmCustomSpeed').onclick();}};
}
test('strict select retains every valid imported/API rate, preset identity and exact accessibility label',()=>{
 const f=fixture();assert.deepEqual(presetValues,['0.5','0.75','1','1.25','1.5','2']);
 for(const speed of [.25,.5,1,1.1,1.2345678901234567,2,4]){
  syncSpeedControl(f.query('#speed'),f.query('#currentSpeedOption'),speed);
  assert.equal(Number(f.query('#speed').value),speed);
  assert.equal(f.query('#currentSpeedOption').hidden,presetValues.includes(String(speed)));
  assert.ok(f.query('#speed').attributes.title.includes(String(speed)));
 }
});
test('custom dialog validates finite range, unchanged input is no-op and cancellation preserves exact rate',()=>{
 const f=fixture();f.project().speed=1.1234567890123457;f.controller.open();assert.equal(f.query('#customSpeedValue').value,String(f.project().speed));
 for(const value of ['', ' ', 'NaN','Infinity','0','0.249999','4.00001']){f.submit(value);assert.equal(f.modal.open,true);}
 assert.equal(f.events.filter(e=>e?.name).length,0);f.submit(String(f.project().speed));assert.equal(f.modal.open,false);assert.equal(f.events.filter(e=>e?.name).length,0);
 f.controller.open();f.query('#cancelCustomSpeed').onclick();assert.equal(f.modal.open,false);
 for(const value of ['0.25','4']){f.controller.open();f.submit(value);assert.equal(f.project().speed,Number(value));}
});
test('stale project/media/dialog callbacks and busy states cannot commit',()=>{
 for(const alter of [f=>f.change(),f=>{f.project().name='changed';},f=>f.relink(),f=>f.modal.close(),f=>f.controller.open(),f=>f.block(true)]){
  const f=fixture();f.controller.open();f.query('#customSpeedValue').value='1.1';const old=f.query('#confirmCustomSpeed').onclick;alter(f);old();assert.equal(f.project().speed,1);
 }
 const f=fixture();f.block(true);f.controller.open();assert.equal(f.modal.open,false);assert.equal(f.query('#speed').value,'1');
});
test('Enter ignores composition/modifiers and queued close cannot invalidate reopened dialog',()=>{
 const f=fixture();f.controller.open();let handled=0;
 for(const extra of [{isComposing:true},{keyCode:229},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{defaultPrevented:true}])f.query('#customSpeedValue').onkeydown({key:'Enter',preventDefault:()=>handled++,...extra});assert.equal(handled,0);
 f.modal.close=function(){this.open=false;};f.modal.close();f.controller.open();f.modal.onclose();f.query('#customSpeedValue').value='1.1';f.query('#customSpeedValue').onkeydown({key:'Enter',preventDefault:()=>handled++});assert.equal(handled,1);assert.equal(f.project().speed,1.1);
});
async function appFixture(){const f=await createAppFixture();strictSelect(f.element('#speed'),f.element('#currentSpeedOption'));vm.runInContext('renderInspector()',f.context);return f;}
function open(f){f.element('#speed').value='custom';f.element('#speed').onchange({target:f.element('#speed')});}
test('actual open/cancel and unchanged confirmation preserve playback, trim drafts, history and saves',async()=>{
 const f=await appFixture();vm.runInContext('state.speed=1.1;history=[];future=[];current=3;playing=true;globalThis.saves=0;scheduleSave=()=>saves++;renderInspector();',f.context);
 f.element('#trimStart').value='1.234567';f.element('#trimEnd').value='11.987654';const before=f.evaluate('({state,current,playing,history,future})');
 open(f);assert.equal(f.element('#speed').value,'1.1');f.element('#cancelCustomSpeed').onclick();assert.deepEqual(f.evaluate('({state,current,playing,history,future})'),before);
 open(f);f.element('#confirmCustomSpeed').onclick();assert.deepEqual(f.evaluate('({state,current,playing,history,future})'),before);assert.equal(f.evaluate('saves'),0);
 assert.deepEqual([f.element('#trimStart').value,f.element('#trimEnd').value],['1.234567','11.987654']);
});
test('actual custom speed reuses one command/undo and preserves caption clocks, audio and established output retiming',async()=>{
 const f=await appFixture();vm.runInContext("state.clips=[{start:0,end:6},{start:0,end:6}];state.captions=[{start:1,end:2,text:'speech'},{start:7,end:8,text:'narration',basis:'timeline'}];state.audioOffset=2;state.design.title.start=1;state.design.title.end=5;history=[];future=[];timelineCache=null;renderInspector();",f.context);
 const before=f.evaluate('state'),expected=prepareCommand(before,'project.update',{patch:{speed:1.1}}).project;
 open(f);f.element('#customSpeedValue').value='1.1';const confirm=f.element('#confirmCustomSpeed').onclick;confirm();confirm();
 assert.deepEqual(f.evaluate('state'),expected);assert.equal(f.evaluate('history.length'),1);assert.equal(f.element('#speed').value,'1.1');
 assert.deepEqual(f.evaluate('state.captions'),before.captions);assert.equal(f.evaluate('state.audioOffset'),2);assert.equal(projectSubtitles(f.evaluate('state'),{format:'txt'}),'speech\n\nspeech\n\nnarration\n');
 vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);vm.runInContext('undo(true)',f.context);assert.deepEqual(f.evaluate('state'),expected);
});
test('actual custom action respects failed recovery, export, media and transcription guards',async()=>{
 for(const expression of ["persistence.restorePhase='failed'",'exporting=true','loadingMedia=true','transcribing=true',"Object.defineProperty(audioRecording,'requesting',{get:()=>true})"]){
  const f=await appFixture();vm.runInContext(expression,f.context);open(f);assert.ok(!f.element('#modal').open);assert.equal(f.element('#speed').value,'1');
 }
});
test('locale switching preserves imported rate and full label, while collapsed control has bounded width',async()=>{
 const f=await appFixture();vm.runInContext('state.speed=1.2345678901234567;renderInspector()',f.context);
 for(const locale of ['en','zh-CN','ko']){setLocale(locale,{persist:false});assert.equal(f.element('#speed').value,'1.2345678901234567');assert.ok(f.element('#speed').getAttribute('aria-label').includes('1.2345678901234567'));}
 initLocale();const css=fs.readFileSync(new URL('../dist/styles/shell-fit.css',import.meta.url),'utf8');assert.match(css,/#speed\s*\{[^}]*max-width:76px/);
});

test('rejected preset selection restores the real arbitrary rate without overwriting trim drafts',async()=>{
 for(const blocked of ['exporting=true','loadingMedia=true',"persistence.restorePhase='failed';persistence.recoveryValid=false"]){
  const f=await appFixture();vm.runInContext('state.speed=1.1;history=[];renderInspector();'+blocked,f.context);
  f.element('#trimStart').value='1.234567';f.element('#trimEnd').value='11.987654';
  f.element('#speed').value='2';f.element('#speed').onchange({target:f.element('#speed')});
  assert.equal(f.element('#speed').value,'1.1');assert.equal(f.evaluate('state.speed'),1.1);assert.equal(f.evaluate('history.length'),0);
  assert.deepEqual([f.element('#trimStart').value,f.element('#trimEnd').value],['1.234567','11.987654']);
 }
});

test('valid recovered project permits preset/custom rescue edits and file backup without browser persistence',async()=>{
 const f=await appFixture(),writes=[],downloads=[];
 f.context.localStorage.setItem=(key,value)=>writes.push({key,value});f.context.collect=(blob,name)=>downloads.push({blob,name});
 vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true;history=[];future=[];download=collect;",f.context);
 f.element('#speed').value='2';f.element('#speed').onchange({target:f.element('#speed')});assert.equal(f.evaluate('state.speed'),2);
 open(f);assert.equal(f.element('#modal').open,true);f.element('#customSpeedValue').value='1.1';f.element('#confirmCustomSpeed').onclick();
 assert.equal(f.evaluate('state.speed'),1.1);assert.equal(f.evaluate('history.length'),2);
 await vm.runInContext('saveProject(true)',f.context);assert.equal(writes.length,0);
 f.element('#projectFilesButton').onclick();f.element('#downloadProjectSettingsButton').onclick();assert.equal(downloads.length,1);
 assert.equal(JSON.parse(await downloads[0].blob.text()).project.speed,1.1);assert.equal(writes.length,0);
 vm.runInContext('undo()',f.context);assert.equal(f.evaluate('state.speed'),2);assert.equal(writes.length,0);
});
