import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelSheet} from '../dist/panel-sheet.mjs';

function presentation() {
  const calls=[], classes=new Set();
  const library={hidden:false,style:{removeProperty(){delete this.maxHeight;}}};
  const close={focus(){calls.push('focus:close');}};
  const buttons=['templates','captions'].map(panel=>({dataset:{panel},expanded:null,
    setAttribute(name,value){assert.equal(name,'aria-expanded');this.expanded=value;},
    focus(){calls.push('focus:'+panel);}}));
  const view={panel:'templates',window:{matchMedia:query=>({matches:!query.includes('720px')})},
    document:{body:{classList:{remove:name=>classes.delete(name),toggle(name,on){if(on)classes.add(name);else classes.delete(name);}}}}};
  const app=new Proxy(view,{get(target,key){
    assert.ok(['panel','window','document'].includes(key),`unexpected editor dependency: ${String(key)}`);
    calls.push('read:'+key);return target[key];
  }});
  const ports={query(selector){
    calls.push(selector);
    const nodes={'#libraryPanel':library,'#panelClose':close,
      '#canvasWrap':{getBoundingClientRect:()=>({bottom:400})},'.rail':{getBoundingClientRect:()=>({top:786})}};
    assert.ok(Object.hasOwn(nodes,selector),`unexpected control: ${selector}`);return nodes[selector];
  },queryAll(selector){calls.push(selector);assert.equal(selector,'[data-panel]');return buttons;}};
  const sheet=createPanelSheet(app,ports);
  return {sheet,view,calls,library,buttons,classes};
}

test('sheet construction is inert and presentation needs no grid, PNG or editor state services', () => {
  const {sheet,calls,library,buttons,classes}=presentation();
  assert.deepEqual(calls,[]);
  assert.deepEqual(Object.keys(sheet),['syncSheet','setSheetOpen','closePanelSheet','togglePanelSheet']);
  sheet.syncSheet();assert.equal(library.hidden,true);
  sheet.togglePanelSheet();assert.equal(library.hidden,false);assert.equal(library.style.maxHeight,'378px');
  assert.equal(classes.has('panel-sheet-open'),true);
  assert.deepEqual(buttons.map(button=>button.expanded),['true','false']);
  assert.equal(calls.at(-1),'focus:close');
  sheet.closePanelSheet();assert.equal(library.hidden,true);assert.equal(calls.at(-1),'focus:templates');
});

test('sheet state stays instance-local while panel, window and document remain live', () => {
  const first=presentation(),second=presentation();
  first.sheet.setSheetOpen(true);second.sheet.syncSheet();
  assert.equal(first.library.hidden,false);assert.equal(second.library.hidden,true);
  first.view.panel='captions';first.sheet.syncSheet();
  assert.deepEqual(first.buttons.map(button=>button.expanded),['false','true']);
  first.sheet.closePanelSheet();assert.equal(first.calls.at(-1),'focus:captions');
  first.sheet.togglePanelSheet();
  const writes=[];first.view.document={body:{classList:{remove:name=>writes.push(['remove',name]),toggle:(name,on)=>writes.push(['toggle',name,on])}}};
  first.view.window={matchMedia:()=>({matches:false})};first.sheet.syncSheet();
  assert.equal(first.library.hidden,false);assert.deepEqual(writes,[['remove','panel-sheet-open']]);
  first.view.window={matchMedia:query=>({matches:!query.includes('720px')})};first.sheet.syncSheet();
  assert.equal(first.library.hidden,true);assert.deepEqual(writes.at(-1),['toggle','panel-sheet-open',false]);
  second.sheet.togglePanelSheet();assert.equal(second.library.hidden,false);assert.equal(first.library.hidden,true);
});
