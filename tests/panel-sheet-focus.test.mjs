import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createPanelSheet} from '../dist/panel-sheet.mjs';
import {createAppFixture} from './fixtures/app.mjs';

// Synthetic ownership/focus checks only, not native browser resize or IME QA.
function fixture(initialCompact = false) {
  let compact = initialCompact;
  const focusCalls = [], classes = new Set();
  const input = {value:'작성 중 draft', selectionStart:1, selectionEnd:3, composing:true};
  const document = {activeElement:input, body:{classList:{
    remove:name=>classes.delete(name), toggle(name,on){if(on)classes.add(name);else classes.delete(name);},
  }}};
  const library = {hidden:false, contains:node=>node===input,
    style:{removeProperty(){delete this.maxHeight;}}};
  const rail = {dataset:{panel:'captions'},setAttribute(name,value){this[name]=value;},
    focus(){focusCalls.push('rail');document.activeElement=this;}};
  const close = {focus(){focusCalls.push('close');document.activeElement=this;}};
  const app = {panel:'captions',document,window:{matchMedia:query=>({matches:compact && !query.includes('720px')})}};
  const nodes = {'#libraryPanel':library,'#panelClose':close,
    '#canvasWrap':{getBoundingClientRect:()=>({bottom:400})},'.rail':{getBoundingClientRect:()=>({top:786})}};
  const sheet = createPanelSheet(app,{query:selector=>nodes[selector],queryAll:()=>[rail]});
  return {sheet,input,document,library,rail,classes,focusCalls,setCompact(value){compact=value;}};
}

test('desktop-to-compact keeps the focused editor visible without focus, draft or composition writes', () => {
  const f=fixture(), before={...f.input};
  f.sheet.syncSheet();
  for (let cycle=0;cycle<2;cycle++) {
    f.setCompact(true);
    for(let duplicate=0;duplicate<3;duplicate++) f.sheet.syncSheet();
    assert.equal(f.library.hidden,false);
    assert.equal(f.rail['aria-expanded'],'true');
    assert.equal(f.classes.has('panel-sheet-open'),true);
    assert.equal(f.document.activeElement,f.input);
    assert.deepEqual(f.input,before);
    assert.deepEqual(f.focusCalls,[]);
    f.setCompact(false);f.sheet.syncSheet();
    assert.equal(f.library.hidden,false);
    assert.equal(f.classes.has('panel-sheet-open'),false);
  }
});

test('initial compact, outside/modal focus and already hidden panels do not gain a sheet', () => {
  const initial=fixture(true);initial.sheet.syncSheet();assert.equal(initial.library.hidden,true);
  for(const outside of [null,{}, {id:'modalInput'}]) {
    const f=fixture();f.sheet.syncSheet();f.document.activeElement=outside;
    f.setCompact(true);f.sheet.syncSheet();
    assert.equal(f.library.hidden,true);assert.equal(f.document.activeElement,outside);
    assert.deepEqual(f.focusCalls,[]);
  }
  const hidden=fixture();hidden.sheet.syncSheet();hidden.library.hidden=true;
  hidden.setCompact(true);hidden.sheet.syncSheet();assert.equal(hidden.library.hidden,true);
});

test('explicit close wins at a breakpoint and later sync never resurrects the closed sheet', () => {
  const f=fixture();f.sheet.syncSheet();f.setCompact(true);f.sheet.setSheetOpen(false);
  f.sheet.syncSheet();assert.equal(f.library.hidden,true);assert.deepEqual(f.focusCalls,[]);
  f.setCompact(false);f.sheet.syncSheet();f.setCompact(true);f.sheet.syncSheet();
  assert.equal(f.library.hidden,false);
  f.sheet.closePanelSheet(); // Same public close action used by Escape.
  assert.equal(f.library.hidden,true);assert.equal(f.document.activeElement,f.rail);
  f.sheet.syncSheet();f.sheet.closePanelSheet();
  assert.equal(f.library.hidden,true);assert.deepEqual(f.focusCalls,['rail']);
});

test('breakpoint focus retention and explicit opening remain instance-local', () => {
  const first=fixture(),second=fixture();first.sheet.syncSheet();second.sheet.syncSheet();
  second.document.activeElement={id:'outside'};
  first.setCompact(true);second.setCompact(true);first.sheet.syncSheet();second.sheet.syncSheet();
  assert.equal(first.library.hidden,false);assert.equal(second.library.hidden,true);
  second.sheet.setSheetOpen(true);assert.equal(second.library.hidden,false);
  first.sheet.closePanelSheet();assert.equal(first.library.hidden,true);assert.equal(second.library.hidden,false);
});

test('registered resize preserves a focused panel draft across duplicate sheet synchronization', async () => {
  const f=await createAppFixture(), events=new Map();let compact=false;
  f.context.window.matchMedia=query=>({matches:compact && query.includes('max-width:700px')});
  f.context.window.addEventListener=(name,handler)=>events.set(name,handler);
  vm.runInContext('bind();switchPanel("captions");history=[];future=[];',f.context);
  const library=f.element('#libraryPanel'), input=f.element('#captionFind');
  library.contains=node=>node===input;
  input.value='작성 중';input.setSelectionRange(1,2);input.focus();
  const panel=f.element('#panelContent');
  panel.oncompositionstart();
  const before=f.evaluate('({state,history,future,current,selected,playing,exporting})');
  const focusCount=f.focusEvents.length;
  vm.runInContext(`renderPanel=renderInspector=snapshot=scheduleSave=persistMedia=()=>{throw Error('resize invoked editor mutation')}`,f.context);
  compact=true;events.get('resize')();events.get('resize')();
  assert.equal(library.hidden,false);assert.equal(f.doc.activeElement,input);
  assert.equal(input.value,'작성 중');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,2);
  assert.equal(f.focusEvents.length,focusCount);
  assert.deepEqual(f.evaluate('({state,history,future,current,selected,playing,exporting})'),before);
  f.element('#importSrt').onclick({});
  assert.notEqual(f.element('#modal').open,true,'resize does not clear the caption composition owner');
  panel.oncompositionend();f.element('#importSrt').onclick({});
  assert.equal(f.element('#modal').open,true,'composition can end normally after resize');
});
