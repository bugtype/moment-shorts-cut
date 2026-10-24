import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {setLocale,initLocale} from '../dist/i18n.mjs';

async function fixture(kind='title',x=.47321,y=.12345){
    const f=await createAppFixture();
    vm.runInContext(`state=initial();state.overlays=[{...newCard(12),id:'card',x:${x},y:${y}}];state.design.title.x=${x};state.design.title.y=${y};state.design.credit.x=${x};state.design.credit.y=${y};state.captionX=${x};state.captionY=${y};selectedCard='card';textLayer='${kind==='card'?'title':kind}';effectTab='cards';switchPanel('${kind==='card'?'effects':'text'}');history=[];future=[];current=2;`,f.context);
    const selector=kind==='card'?'#panelContent #effectControls #openCardPosition':'#panelContent #openPosition';
    f.open=event=>f.element(selector).onclick(event||{});
    f.apply=(x,y)=>{if(x!==undefined)f.element('#position-x').value=String(x);if(y!==undefined)f.element('#position-y').value=String(y);f.element('#applyPosition').onclick({});};
    f.coords=()=>f.evaluate(kind==='card'?'state.overlays[0]':kind==='caption'?'({x:state.captionX,y:state.captionY})':`state.design.${kind}`);
    return f;
}

test('all four layers edit one precise axis without round-tripping opposite coordinate or other content',async()=>{
    for(const kind of ['title','credit','caption','card']){
        const f=await fixture(kind),before=f.evaluate('state'),original=f.coords();f.open();
        assert.equal(Number(f.element('#position-x').value),original.x*100);assert.equal(Number(f.element('#position-y').value),original.y*100);
        f.apply(undefined,'42.12345');assert.equal(f.coords().x,original.x);assert.equal(f.coords().y,42.12345/100);
        assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('current'),2);
        vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);vm.runInContext('undo(true)',f.context);assert.equal(f.coords().y,42.12345/100);
    }
});

test('same equivalent notation and Cancel preserve exact bits, paused state and uncommitted drafts',async()=>{
    const f=await fixture('title',.1+.2,.12345);vm.runInContext('playing=true;',f.context);const before=f.evaluate('({state,history,current,playing})');
    f.open();f.apply(String((.1+.2)*100)+'0');assert.deepEqual(f.evaluate('({state,history,current,playing})'),before);
    f.element('#panelContent #titleFirst').value='draft';f.open();f.element('#cancelPosition').onclick();
    assert.equal(f.element('#panelContent #titleFirst').value,'draft');assert.deepEqual(f.evaluate('({state,history,current,playing})'),before);
});

test('title patch limits preserve imported out-of-patch-range untouched axes, other layers allow0/100',async()=>{
    const f=await fixture('title',.02,.12345);f.open();f.apply(undefined,50);assert.equal(f.coords().x,.02);assert.equal(f.coords().y,.5);
    f.open();f.apply(2.1,50);assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('modal.open'),true);f.element('#cancelPosition').onclick();
    for(const kind of ['credit','caption','card']){const a=await fixture(kind);a.open();a.apply(0,100);assert.equal(a.coords().x,0);assert.equal(a.coords().y,1);}
    const tiny=await fixture('credit',Number.MIN_VALUE,.12345);tiny.open();tiny.apply(undefined,70);assert.equal(tiny.coords().x,Number.MIN_VALUE);
});

test('invalid values never partly commit and IME/modal/stale targets stay inert',async()=>{
    const f=await fixture();f.open();for(const x of ['',-1,96,'Infinity','NaN'])f.apply(x,40);f.apply(40,99);assert.equal(f.evaluate('history.length'),0);
    for(const change of ["state.name='changed'","state=structuredClone(state)","selectedCard='other'","textLayer='credit'","switchPanel('settings')","sources.audioFile={}","loadingMedia=true","exporting=true","transcribing=true"]){
        const a=await fixture();a.open();vm.runInContext(change,a.context);a.apply(40,40);assert.equal(a.evaluate('history.length'),0,change);
    }
    const a=await fixture();a.open({isComposing:true});a.open({keyCode:229});assert.equal(a.evaluate('!!modal.open'),false);
    vm.runInContext("modalOpen('Other','Stay','');",a.context);const html=a.element('#modal').innerHTML;a.open();assert.equal(a.element('#modal').innerHTML,html);
});

test('failed-valid position edits and undo keep storage blocked; localized dialogs preserve authored values',async()=>{
    try {for(const [locale,label] of [['ko','가로 위치'],['en','Horizontal position'],['zh-CN','水平位置']]){
        const f=await fixture(),writes=[];f.context.localStorage.setItem=(...args)=>writes.push(args);setLocale(locale,{persist:false});
        vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true;",f.context);f.open();assert.ok(f.element('#modal').innerHTML.includes(label));f.apply(40,40);
        assert.equal(f.evaluate('history.length'),1);await vm.runInContext('saveProject(true);scheduleSave();undo();',f.context);assert.deepEqual(writes,[]);assert.equal(f.coords().x,.47321);
    }}finally{initLocale();}
});


test('position confirmations preserve ownership through rerender/reopen and guarded Enter',async()=>{
    const f=await fixture(),oldOpen=f.element('#panelContent #openPosition').onclick;
    vm.runInContext('renderPanel()',f.context);oldOpen({});assert.equal(f.evaluate('!!modal.open'),false);
    f.open();const oldApply=f.element('#applyPosition').onclick;f.element('#cancelPosition').onclick();f.open();oldApply({});assert.equal(f.evaluate('history.length'),0);
    const input=f.element('#position-x');input.value='40';let prevented=0;
    input.oncompositionstart();f.element('#applyPosition').onclick({});input.oncompositionend();assert.equal(f.evaluate('history.length'),0);
    for(const flags of [{isComposing:true},{keyCode:229},{ctrlKey:true},{shiftKey:true}])input.onkeydown({key:'Enter',preventDefault(){prevented++;},...flags});
    assert.equal(prevented,0);input.onkeydown({key:'Enter',preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(f.evaluate('history.length'),1);
});


test('successful position commit restores focus to replacement panel action, not detached opener',async()=>{
    const f=await fixture(),root=f.element('#panelContent'),query=root.querySelector.bind(root);
    let markup=root.innerHTML,current=f.element('#panelContent #openPosition');const original=current;
    root.querySelector=selector=>selector==='#openPosition'?current:query(selector);
    Object.defineProperty(root,'innerHTML',{configurable:true,get:()=>markup,set:value=>{markup=value;current={focus(){f.doc.activeElement=this;}};}});
    f.open();f.apply(40,40);
    assert.notEqual(current,original);assert.equal(f.doc.activeElement,current);assert.equal(f.evaluate('history.length'),1);
});


test('retained position openers cannot launch after switching to another panel',async()=>{
    for(const kind of ['title','card']){
        const f=await fixture(kind),selector=kind==='card'?'#panelContent #effectControls #openCardPosition':'#panelContent #openPosition';
        const open=f.element(selector).onclick;vm.runInContext("switchPanel('media')",f.context);open({});assert.equal(f.evaluate('!!modal.open'),false);
    }
});
