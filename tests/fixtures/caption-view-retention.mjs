import vm from 'node:vm';
import {setImmediate} from 'node:timers/promises';
import {createAppFixture} from './app.mjs';
const f = await createAppFixture();
const root = f.element('#panelContent');
const queryAll = f.doc.querySelectorAll, query = f.doc.querySelector;
let rows = [], markup = '';
f.doc.querySelectorAll = selector => selector === '[data-caption-text]' ? rows : queryAll(selector);
f.doc.querySelector = selector => {
    const index = /^\[data-caption-text="(\d+)"\]$/.exec(selector)?.[1];
    return index === undefined ? query(selector) : rows.find(input => input.dataset.captionText === index);
};
Object.defineProperty(root, 'innerHTML', {
    get: () => markup,
    set(value) {
        rows = []; markup = value;
        for (const [, index, text] of value.matchAll(/<textarea[^>]*data-caption-text="(\d+)"[^>]*>([^<]*)<\/textarea>/g)) {
            rows.push({dataset: {captionText: index}, value: text, setAttribute() {}, removeAttribute() {},
                focus() {}, scrollIntoView() {}, setSelectionRange() {}});
        }
    },
});
vm.runInContext("state.captions=Array.from({length:10000},(_,i)=>({start:i/1000,end:(i+1)/1000,text:'Caption '+i+' '+ 'x'.repeat(100)}));switchPanel('captions');", f.context);
if (rows.length !== 50) throw new Error('Expected the actual caption markup to mount 50 modeled rows');
const project = new WeakRef(vm.runInContext('state', f.context));
const row = new WeakRef(rows[0]);
const serializedBytes = vm.runInContext('JSON.stringify(state).length', f.context);
const mode = process.argv[2] || 'reset';
if (mode !== 'active') {
    vm.runInContext("switchPanel('media')", f.context);
    if (mode === 'reset' || mode === 'return') {
        vm.runInContext('confirmReset()', f.context);
        f.element('#confirmReset').onclick();
    }
    if (mode === 'return') vm.runInContext("switchPanel('captions')", f.context);
}
for (let i=0; i<10; i++) { await setImmediate(); global.gc(); }
console.log(JSON.stringify({serializedBytes, oldProjectRetained: !!project.deref(), detachedRowRetained: !!row.deref(),
    currentCaptions: f.evaluate('state.captions.length'), history: f.evaluate('history.length'), future: f.evaluate('future.length'), panel: f.evaluate('panel')}));
