import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale,setLocale} from '../dist/i18n.mjs';

async function fixture(setup=''){
    const f=await createAppFixture();
    const query=f.doc.querySelector;
    f.doc.querySelector=selector=>selector==='#captionOverlapResults' && !f.element('#modal').innerHTML.includes('captionOverlapResults') ? null : query(selector);
    vm.runInContext(`state.captions=[{start:0,end:2,text:'<script>Authored</script>'},{start:1,end:3,text:'Other'}];history=[];future=[];current=4;${setup};switchPanel('captions');`,f.context);
    f.open=()=>f.element('#inspectCaptionOverlaps').onclick();
    f.snapshot=()=>f.evaluate('({state,current,history,future,selected,playing,saveTimer:persistence.saveTimer??null})');
    return f;
}

test('overlap review counts occurrences not pairs, bounds20 rows and never renders authored text or edits',async()=>{
    const f=await fixture("state.captions=Array.from({length:30},(_,i)=>({start:0,end:2,text:'<script>'+i}))"),before=f.snapshot();
    f.open();const html=f.element('#captionOverlapResults').innerHTML;
    assert.match(html,/출력 자막 30개 · 시간 겹침 30개 · 생략 10개/);
    assert.equal([...html.matchAll(/id="overlapCaption\d+"/g)].length,20);assert.doesNotMatch(html,/<script>/);
    assert.deepEqual(f.snapshot(),before);
});

test('both caption buttons reveal global off-page authored rows without seeking or saving',async()=>{
    for(const [id,index] of [['overlapCaption0',51],['overlapOtherCaption0',52]]){
        const f=await fixture("state.duration=120;state.clips=[{start:0,end:120}];state.captions=Array.from({length:53},(_,i)=>({start:i<51?i:60+i-51,end:i<51?i+.5:62+i-51,text:'Cue'+i}))"),before=f.snapshot();
        f.open();f.element('#'+id).onclick();assert.equal(f.element('#modal').open,false);
        assert.equal(f.doc.activeElement,f.element(`[data-caption-text="${index}"]`));
        assert.match(f.element('#panelContent').innerHTML,/data-caption-text="51"/);assert.deepEqual(f.snapshot(),before);
    }
});

test('View range pauses and seeks exact overlap output start converted once through speed',async()=>{
    for(const speed of [.25,4]){
        const f=await fixture(`state.speed=${speed};state.clips=[{start:0,end:4},{start:0,end:4}];state.captions[1].start=1.23456789`),before=f.evaluate('({state,history,future})');
        f.open();f.element('#overlapOccurrence0').onclick();
        assert.equal(f.evaluate('current'),1.23456789);assert.equal(f.evaluate('playing'),false);assert.deepEqual(f.evaluate('({state,history,future})'),before);
    }
});

test('touching endpoints are not overlaps and empty reports remain read-only',async()=>{
    const f=await fixture('state.captions[1].start=2'),before=f.snapshot();f.open();
    assert.match(f.element('#captionOverlapResults').innerHTML,/겹치는 자막 시간이 없습니다/);assert.doesNotMatch(f.element('#captionOverlapResults').innerHTML,/id="overlapCaption/);assert.deepEqual(f.snapshot(),before);
});

test('changed project/media, detached/reopened dialog and unrelated panel cannot navigate',async()=>{
    for(const change of ["state.captions[0].text='Changed'",'state=structuredClone(state)','sources.videoFile={}','sources.audioFile={}',"modal.close()","switchPanel('text')","modalOpen('Other','Other')"]){
        const f=await fixture();f.open();const old=f.element('#overlapOccurrence0').onclick;vm.runInContext(change,f.context);const before=f.snapshot();old();assert.deepEqual(f.snapshot(),before);
    }
    const f=await fixture();f.open();const old=f.element('#overlapCaption0').onclick;f.element('#modal').close();f.open();old();assert.equal(f.element('#modal').open,true);
});

test('IME and busy guards are inert; failed-valid recovery permits focus but blocks media seeking and storage',async()=>{
    const f=await fixture();f.element('#panelContent').oncompositionstart();f.open();assert.notEqual(f.element('#modal').open,true);f.element('#panelContent').oncompositionend();f.open();
    const before=f.snapshot();f.element('#overlapOccurrence0').onclick({isComposing:true});assert.deepEqual(f.snapshot(),before);
    vm.runInContext('exporting=true',f.context);f.element('#overlapOccurrence0').onclick();assert.deepEqual(f.snapshot(),before);vm.runInContext('exporting=false',f.context);
    const failed=await fixture("persistence.restorePhase='failed';persistence.recoveryValid=true"),writes=[];failed.context.localStorage.setItem=(...args)=>writes.push(args);
    failed.open();const restored=failed.snapshot();failed.element('#overlapOccurrence0').onclick();assert.deepEqual(failed.snapshot(),restored);assert.equal(failed.element('#modal').open,true);
    failed.element('#overlapOtherCaption0').onclick();assert.equal(failed.doc.activeElement,failed.element('[data-caption-text="1"]'));assert.deepEqual(failed.snapshot(),restored);assert.deepEqual(writes,[]);
});

test('all three locales expose overlap action, counts and required representative-conflict caveat',async()=>{
    for(const [locale,label,notice] of [['ko','자막 시간 겹침','대표 충돌'],['en','Caption timing overlaps','representative conflict'],['zh-CN','字幕时间重叠','代表性冲突']]){
        const f=await fixture();setLocale(locale,{persist:false});vm.runInContext('renderPanel()',f.context);assert.ok(f.element('#panelContent').innerHTML.includes(label));f.open();assert.ok(f.element('#modal').innerHTML.includes(notice));assert.doesNotMatch(f.element('#captionOverlapResults').innerHTML.replace(/<[^>]*>/g,''),/panels\.|shell\./);
    }
    initLocale();
});
