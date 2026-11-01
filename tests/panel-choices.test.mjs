import test from 'node:test';
import assert from 'node:assert/strict';
import {bindPanelChoices} from '../dist/panel-choices.mjs';

// Native-button callback/DOM-owner model only; no browser focus or keyboard emulation.
function fixture() {
 const document={body:{name:'body'},documentElement:{name:'html'},activeElement:null};
 const f={document,calls:[],focus:[],current:true,context:true,nodes:[]};
 const root={ownerDocument:document,isConnected:true,hidden:false,
  querySelectorAll:()=>f.nodes,contains:node=>f.nodes.includes(node),
  querySelector:selector=>f.nodes.find(node=>selector.includes(`"${node.dataset.choice}"`))??null};
 f.root=root;
 f.mount=(pressed='b')=>{
  for(const node of f.nodes)node.isConnected=false;
  f.nodes=['a','b'].map(value=>({dataset:{choice:value},ownerDocument:document,tagName:'BUTTON',
   disabled:false,hidden:false,isConnected:true,
   getAttribute:name=>name==='aria-pressed'?String(value===pressed):name==='data-choice'?value:null,
   closest:selector=>selector==='[hidden]'?null:null,
   focus(options){document.activeElement=this;f.focus.push({node:this,options});}}));
  return f.nodes;
 };
 f.mount();
 f.bind=(activate=value=>f.calls.push(value))=>bindPanelChoices(root,{selector:'[data-choice]',key:'choice',activate,
  current:()=>f.current,contextCurrent:()=>f.context});
 return f;
}

test('focused choice restores selected replacement after remount without consulting old render owner',()=>{
 for(const fallback of ['old','body','documentElement','null']){
  const f=fixture(),old=f.nodes[1];f.document.activeElement=old;
  f.bind(value=>{f.calls.push(value);f.current=false;f.mount(value);f.document.activeElement=fallback==='old'?old:fallback==='null'?null:f.document[fallback];});
  old.onclick({});assert.deepEqual(f.calls,['b']);assert.equal(f.document.activeElement,f.nodes[1]);
  assert.equal(f.focus.length,1);assert.equal(f.focus[0].options?.preventScroll,true);
 }
});

test('context change, removed/disabled/hidden or unselected replacement cannot reclaim focus',()=>{
 for(const mode of ['context','removed','disabled','hidden','unselected']){
  const f=fixture(),old=f.nodes[1];f.document.activeElement=old;
  f.bind(()=>{f.mount(mode==='unselected'?'a':'b');f.document.activeElement=f.document.body;
   if(mode==='context')f.context=false;
   if(mode==='removed')f.nodes=f.nodes.filter(node=>node.dataset.choice!=='b');
   if(mode==='disabled')f.nodes[1].disabled=true;
   if(mode==='hidden')f.nodes[1].hidden=true;
  });old.onclick({});assert.equal(f.focus.length,0,mode);
 }
});

test('new external or modal focus is not stolen and unfocused activation does not move focus',()=>{
 for(const mode of ['external','modal','unfocused']){
  const f=fixture(),old=f.nodes[1],external={name:mode};f.document.activeElement=mode==='unfocused'?external:old;
  f.bind(()=>{f.mount();f.document.activeElement=external;});old.onclick({});
  assert.equal(f.document.activeElement,external);assert.equal(f.focus.length,0);
 }
});

test('pre-action stale owner, detached/removed/disabled/hidden controls and composition are inert',()=>{
 for(const mode of ['stale','removed','detached','disabled','hidden','composing','legacyIme','prevented']){
  const f=fixture(),old=f.nodes[1];f.bind();
  const event={};
  if(mode==='stale')f.current=false;
  if(mode==='removed')f.nodes=[];
  if(mode==='detached')old.isConnected=false;
  if(mode==='disabled')old.disabled=true;
  if(mode==='hidden')old.hidden=true;
  if(mode==='composing')event.isComposing=true;
  if(mode==='legacyIme')event.keyCode=229;
  if(mode==='prevented')event.defaultPrevented=true;
  old.onclick(event);assert.deepEqual(f.calls,[],mode);assert.equal(f.focus.length,0);
 }
});

test('active presets still invoke native click action and independent instances do not share ownership',()=>{
 const a=fixture(),b=fixture();a.bind();b.bind();
 a.nodes[1].onclick({});assert.deepEqual(a.calls,['b'],'already-selected preset is not a helper no-op');
 a.current=false;b.nodes[0].onclick({});assert.deepEqual(b.calls,['a']);
 assert.equal(a.nodes[1].onkeydown,undefined);assert.equal(b.nodes[0].onkeydown,undefined);
});

test('composition lifecycle clears for retry without changing native button keys',()=>{
 const f=fixture();f.bind();const button=f.nodes[1];
 button.oncompositionstart();button.onclick({});assert.deepEqual(f.calls,[]);
 button.oncompositionend();button.onclick({});assert.deepEqual(f.calls,['b']);
 assert.equal(button.onkeydown,undefined);
});

test('an unchanged mounted choice keeps focus without an unnecessary focus call',()=>{
 const f=fixture(),button=f.nodes[1];f.document.activeElement=button;f.bind();
 button.onclick({});assert.deepEqual(f.calls,['b']);assert.equal(f.document.activeElement,button);
 assert.equal(f.focus.length,0);
});

test('throwing action retains its error and does not attempt restoration',()=>{
 const f=fixture(),old=f.nodes[1],error=new Error('action failure');f.document.activeElement=old;
 f.bind(()=>{f.mount();throw error;});assert.throws(()=>old.onclick({}),value=>value===error);
 assert.equal(f.focus.length,0);
});
