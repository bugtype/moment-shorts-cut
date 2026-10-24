import test from 'node:test';
import assert from 'node:assert/strict';
import {mountEffectsPanel} from '../dist/effects-panel.mjs';
import {mountDesignPanel} from '../dist/design-panel.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {newCard} from '../dist/effects.mjs';

// Minimal numeric DOM controls, seeded from the actual emitted input values.
function fixture(kind,start=1.234567,end=11.987654){
    let project=createDemoProject(),html='',history=[];
    project.overlays=[{...newCard(12),start,end}];
    if(kind!=='card'){project.design[kind].start=start;project.design[kind].end=end;}
    let inputs=[];const buttons=new Map();
    const controls={querySelector(selector){if(!buttons.has(selector))buttons.set(selector,{focus(){}});return buttons.get(selector);},querySelectorAll(selector){return selector==='[data-card]'?inputs:[];}};
    function parse(value){
        html=value;inputs=[];
        const attr=kind==='card'?'card':'design';
        for(const match of value.matchAll(new RegExp(`<input[^>]*data-${attr}="([^"]+)"[^>]*>`, 'g'))){
            if(!(match[1]==='start'||match[1]==='end'||match[1].endsWith('.start')||match[1].endsWith('.end')))continue;
            inputs.push({type:'number',step:/step="([^"]*)"/.exec(match[0])?.[1],dataset:{[attr]:match[1]},value:/value="([^"]*)"/.exec(match[0])?.[1]||'',
                setCustomValidity(value){this.validationMessage=value;},reportValidity(){},setAttribute(){},removeAttribute(){}});
        }
    }
    Object.defineProperty(controls,'innerHTML',{set:parse,get:()=>html});
    const root={querySelector:selector=>selector==='#effectControls'?controls:null,querySelectorAll:selector=>selector==='[data-design]'?inputs:[]};
    Object.defineProperty(root,'innerHTML',{set:value=>{if(kind==='card')html=value;else parse(value);},get:()=>html});
    const render=()=>{
        const api={state:project,total:12,snapshot(){history.push(structuredClone(project));},input(){},update(change){change(project);},layer:kind,tab:'cards',selected:project.overlays[0].id};
        if(kind==='card')mountEffectsPanel(root,api);else mountDesignPanel(root,api);
    };
    render();
    return {render,get html(){return html;},get project(){return project;},get inputs(){return inputs;},get history(){return history;},layer:()=>kind==='card'?project.overlays[0]:project.design[kind],undo(){project=history.pop();render();}};
}

for(const kind of ['card','title','credit']){
    test(`${kind} editable timing preserves full decimals through recommit, single-bound edits, rerender and undo`,()=>{
        const f=fixture(kind);assert.equal(f.inputs[0].value,'1.234567');assert.equal(f.inputs[1].value,'11.987654');
        assert.deepEqual(f.inputs.map(input=>input.step),['any','any']);
        f.inputs[0].onchange();f.inputs[1].onchange();assert.equal(f.layer().start,1.234567);assert.equal(f.layer().end,11.987654);
        f.inputs[0].value='2.3456789';f.inputs[0].onchange();assert.equal(f.layer().start,2.3456789);assert.equal(f.layer().end,11.987654);
        f.render();assert.equal(f.inputs[0].value,'2.3456789');f.undo();assert.equal(f.layer().start,1.234567);
        f.inputs[1].value='12';f.inputs[1].onchange();assert.equal(f.layer().end,12);
        const before=structuredClone(f.layer());f.inputs[0].value='12';f.inputs[0].onchange();assert.deepEqual(f.layer(),before);assert.ok(f.inputs[0].validationMessage);
    });
    test(`${kind} tiny exponent timing round-trips through decimal input markup`,()=>{
        for(const [start,end] of [[1e-20,3e-20],[Number.MIN_VALUE,Number.MIN_VALUE*2]]){
            const f=fixture(kind,start,end);assert.equal(Number(f.inputs[0].value),start);assert.equal(Number(f.inputs[1].value),end);
            assert.doesNotMatch(f.inputs[0].value,/e/i);f.inputs[0].onchange();f.inputs[1].onchange();assert.equal(f.layer().start,start);assert.equal(f.layer().end,end);
        }
    });
}
for(const kind of ['title','credit'])test(`${kind} null end stays blank and null through render/change`,()=>{
    const f=fixture(kind,1.234567,null);assert.equal(f.inputs[1].value,'');f.inputs[1].onchange();assert.equal(f.layer().end,null);
    f.inputs[0].value='2.3456789';f.inputs[0].onchange();f.render();assert.equal(f.inputs[1].value,'');assert.equal(f.layer().end,null);
});
