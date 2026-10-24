import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createShellPresentation} from '../dist/shell-presentation.mjs';
import {createAppFixture} from './fixtures/app.mjs';
import {createProjectDocument} from '../dist/core/project.mjs';
import {translateFor} from '../dist/i18n.mjs';

function mounted() {
  const nodes=new Map(),events=[];
  const node=id=>({focus(){events.push(['focus',id]);},click(){events.push(['click',id]);}});
  for(const id of ['#projectFilesButton','#helpButton','#projectInput']) nodes.set(id,node(id));
  const modal={open:false,close(){this.open=false;this.onclose?.();}}, query=id=>nodes.get(id)||null;
  let blocked=false,downloads=0;
  const shell=createShellPresentation({query,queryAll:()=>[],document:{},modal,
    openDialog(title,body,footer){modal.onclose?.();modal.onclose=null;nodes.delete('#importProjectSettingsButton');nodes.delete('#downloadProjectSettingsButton');for(const m of (body+footer).matchAll(/id="([^"]+)"/g))nodes.set('#'+m[1],node('#'+m[1]));modal.open=true;},
    downloadSettings(){downloads++;},filesBlocked:()=>blocked,setTimer(){},clearTimer(){}});
  return {shell,modal,query,events,get downloads(){return downloads;},block(value){blocked=value;},replace(){nodes.delete('#importProjectSettingsButton');nodes.delete('#downloadProjectSettingsButton');modal.open=true;}};
}

test('strict mounted file dialog owns actions, cancellation, repeated stale callbacks and Help route',()=>{
  const f=mounted();
  for(const open of [()=>f.shell.showProjectFiles(),()=>f.shell.showHelp()]) {
    open();const oldSave=f.query('#downloadProjectSettingsButton').onclick,oldImport=f.query('#importProjectSettingsButton').onclick;
    oldSave();oldImport();assert.equal(f.events.at(-1)[1],'#projectInput');
    const close=f.shell.captureImportClose();assert.equal(f.modal.open,true,'picker cancellation keeps dialog usable');
    close();assert.equal(f.modal.open,false);const before=f.downloads;oldSave();oldImport();assert.equal(f.downloads,before);
    open();oldSave();assert.equal(f.downloads,before);f.query('#downloadProjectSettingsButton').onclick();assert.equal(f.downloads,before+1);
    f.query('#importProjectSettingsButton').onclick();const staleClose=f.shell.captureImportClose();f.replace();staleClose();assert.equal(f.modal.open,true);
  }
});
test('queued old close event does not invalidate reopened dialog and busy actions are guarded',()=>{
  const f=mounted();f.block(true);f.shell.showProjectFiles();assert.equal(f.modal.open,false);f.block(false);f.shell.showProjectFiles();
  f.modal.close=function(){this.open=false;};f.modal.close();f.shell.showProjectFiles();f.modal.onclose();
  f.query('#downloadProjectSettingsButton').onclick();assert.equal(f.downloads,1);
  const eventCount=f.events.length;f.block(true);f.query('#downloadProjectSettingsButton').onclick();f.query('#importProjectSettingsButton').onclick();assert.equal(f.downloads,1);assert.equal(f.events.length,eventCount);
});
test('actual file action downloads latest settings without edits and browser Save remains local',async()=>{
  const f=await createAppFixture(),downloads=[];f.context.collect=(blob,name)=>downloads.push({blob,name});vm.runInContext('download=collect;history=[];',f.context);
  const before=f.evaluate('state');f.element('#projectFilesButton').onclick();assert.equal(f.element('#modal').open,true);
  vm.runInContext("state.name='latest name'",f.context);f.element('#downloadProjectSettingsButton').onclick();
  assert.equal(downloads.length,1);assert.equal(JSON.parse(await downloads[0].blob.text()).project.name,'latest name');assert.equal(f.evaluate('history.length'),0);
  await f.element('#saveButton').onclick();assert.equal(downloads.length,1);
  assert.deepEqual(f.evaluate('state.clips'),before.clips);
});
test('actual file picker import closes only owned dialog, supports undo and protects later dialogs',async()=>{
  for(const replace of [false,true]){
    const f=await createAppFixture();vm.runInContext('history=[];future=[];',f.context);const before=f.evaluate('state'),doc=createProjectDocument(before);doc.project.name='imported';
    let resolve;const file={size:1,arrayBuffer:()=>new Promise(r=>resolve=r)};
    f.element('#projectFilesButton').onclick();f.element('#projectInput').click=()=>{};f.element('#importProjectSettingsButton').onclick();
    const pending=f.element('#projectInput').onchange({target:{files:[file]}});
    if(replace)vm.runInContext("modalOpen('Other dialog','<p>Other</p>')",f.context);
    resolve(new TextEncoder().encode(JSON.stringify(doc)).buffer);await pending;
    assert.equal(f.evaluate('state.name'),'imported');assert.equal(f.evaluate('history.length'),1);
    assert.equal(f.element('#modal').open,replace);assert.equal(f.element('#projectInput').value,'');
    vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);
  }
});
test('actual pending import retains conflict and busy protection without closing the dialog',async()=>{
  for(const change of ["state.name='concurrent'",'loadingMedia=true']){
    const f=await createAppFixture();const doc=createProjectDocument(f.evaluate('state'));doc.project.name='must not apply';
    let resolve;f.element('#projectFilesButton').onclick();f.element('#projectInput').click=()=>{};f.element('#importProjectSettingsButton').onclick();
    const pending=f.element('#projectInput').onchange({target:{files:[{size:1,arrayBuffer:()=>new Promise(r=>resolve=r)}]}});
    vm.runInContext(change,f.context);const before=f.evaluate('state');resolve(new TextEncoder().encode(JSON.stringify(doc)).buffer);await pending;
    assert.deepEqual(f.evaluate('state'),before);assert.equal(f.element('#modal').open,true);
  }
});
test('valid recovered settings can still be backed up, invalid recovery cannot download',async()=>{
  for(const valid of [true,false]){
    const f=await createAppFixture();let downloads=0;f.context.collect=()=>downloads++;vm.runInContext(`download=collect;persistence.restorePhase='failed';persistence.recoveryValid=${valid};`,f.context);
    f.element('#projectFilesButton').onclick();assert.equal(f.element('#modal').open,true);f.element('#downloadProjectSettingsButton').onclick();assert.equal(downloads,valid?1:0);
  }
});
test('project file entry has three locales and remains outside compact Save/Help hiding selectors',()=>{
  const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  const button=html.match(/<button[^>]*id="projectFilesButton"[^>]*>/)?.[0];assert.ok(button);assert.match(button,/aria-haspopup="dialog"/);assert.doesNotMatch(button,/subtle/);
  const css=fs.readFileSync(new URL('../dist/styles/responsive.css',import.meta.url),'utf8');assert.match(css,/\.header-actions \.subtle,\.avatar,#helpButton\s*\{\s*display:none/);assert.doesNotMatch(css,/#projectFilesButton/);
  for(const [locale,label] of [['ko','프로젝트 파일'],['en','Project files'],['zh-CN','项目文件']])assert.equal(translateFor(locale,'shell.projectFiles'),label);
});

test('cancelled native picker cannot lend its modal ownership to programmatic imports',async()=>{
  const f=await createAppFixture();f.element('#projectFilesButton').onclick();f.element('#projectInput').click=()=>{};
  f.element('#importProjectSettingsButton').onclick();f.element('#projectInput').oncancel();
  const doc=createProjectDocument(f.evaluate('state'));doc.project.name='API import';
  await f.context.window.moment.importProject(new Blob([JSON.stringify(doc)]));
  assert.equal(f.evaluate('state.name'),'API import');assert.equal(f.element('#modal').open,true);
  // The same dialog remains usable for a subsequent actual picker selection.
  f.element('#importProjectSettingsButton').onclick();doc.project.name='picker retry';
  await f.element('#projectInput').onchange({target:{files:[new Blob([JSON.stringify(doc)])]}});
  assert.equal(f.evaluate('state.name'),'picker retry');assert.equal(f.element('#modal').open,false);
});
