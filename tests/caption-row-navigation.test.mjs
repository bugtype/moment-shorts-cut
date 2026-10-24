import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {initLocale, setLocale} from '../dist/i18n.mjs';
import {createAppFixture} from './fixtures/app.mjs';

async function fixture(setup = '') {
    const f = await createAppFixture();
    f.element('#modal').open=false;
    const originalQuery = f.doc.querySelector;
    f.doc.querySelector = selector => selector === '#captionOccurrences' && !f.element('#modal').innerHTML.includes('captionOccurrences') ? null : originalQuery(selector);
    const originalQueryAll = f.doc.querySelectorAll;
    f.doc.querySelectorAll = selector => {
        if (selector !== '[data-view-caption]') return originalQueryAll(selector);
        return [...f.element('#panelContent').innerHTML.matchAll(/data-view-caption="(\d+)"/g)].map(([,index]) => {
            const node=f.element(`[data-view-caption="${index}"]`);node.dataset.viewCaption=index;return node;
        });
    };
    vm.runInContext(`state.duration=20;state.clips=[{start:5,end:10}];state.captions=[{start:6,end:8,text:'<script>caption</script>'}];state.speed=2;history=[];future=[];current=0;globalThis.saves=0;scheduleSave=()=>saves++;${setup};switchPanel('captions');`, f.context);
    f.open = (index = 0, event) => f.element(`[data-view-caption="${index}"]`).onclick(event);
    f.snapshot = () => f.evaluate('({state,history,future,saves,selected})');
    return f;
}

test('row navigation projects only requested cue, source and timeline clocks, with no edits or autoplay', async () => {
    for (const [setup, expected] of [['',1],["state.captions[0]={start:2,end:3,text:'Narration',basis:'timeline'}",2], ["state.captions.unshift({start:0,end:1,text:'Other'})",1]]) {
        const f=await fixture(setup), before=f.snapshot();
        const index=setup.includes('unshift')?1:0;
        const draft=f.element(`[data-caption-text="${index}"]`);draft.value='Uncommitted draft';draft.focus();
        f.open(index);
        assert.equal(f.evaluate('current'),expected);assert.equal(f.evaluate('playing'),false);
        assert.equal(f.element('#modal').open,false);assert.equal(draft.value,'Uncommitted draft');
        assert.deepEqual(f.snapshot(),before);
    }
});

test('trimmed-out caption is inert; clipped interval seeks its actual retained start', async()=>{
    const f=await fixture("state.captions[0].start=0;state.captions[0].end=5");const before=f.snapshot();f.open();
    assert.equal(f.evaluate('current'),0);assert.equal(f.element('#modal').open,false);assert.deepEqual(f.snapshot(),before);
    vm.runInContext('state.captions[0].end=7;current=3',f.context);f.open();assert.equal(f.evaluate('current'),0);
});

test('1000 repeated clips render 20 rows per page and navigate exact reordered output occurrence',async()=>{
    const f=await fixture("state.clips=Array.from({length:1000},(_,i)=>({start:i%2?6:5,end:i%2?9:10}));state.captions[0].text='x'.repeat(2000)");
    const before=f.snapshot();f.open();
    const html=()=>f.element('#captionOccurrences').innerHTML;
    assert.equal([...html().matchAll(/id="captionOccurrence\d+"/g)].length,20);
    assert.doesNotMatch(html(),/x{20}/);assert.match(html(),/50/);
    const stale=f.element('#captionOccurrence0').onclick;
    f.element('#nextCaptionOccurrencePage').onclick();stale();assert.equal(f.element('#modal').open,true);
    assert.match(html(),/21번째/);f.element('#captionOccurrence0').onclick();
    assert.equal(f.evaluate('current'),81);assert.equal(f.element('#modal').open,false);assert.deepEqual(f.snapshot(),before);
});

test('changed project/media, closed/replaced dialogs and stale row actions do not navigate',async()=>{
    for(const change of ["state.speed=1", "state=structuredClone(state)","sources.videoFile={name:'new'}", "sources.audioFile={name:'new'}", "modal.close()", "modalOpen('Other','Other')"]){
        const f=await fixture('state.clips.push({start:5,end:10})');f.open();const old=f.element('#captionOccurrence0').onclick;
        vm.runInContext(change,f.context);old();assert.equal(f.evaluate('current'),0);
    }
    const f=await fixture();const old=f.element('[data-view-caption="0"]').onclick;
    vm.runInContext("renderPanel()",f.context);old();assert.equal(f.evaluate('current'),0);
});

test('IME and every busy/recovery state block row and pending modal navigation',async()=>{
    for(const flag of ['loadingMedia=true','transcribing=true','exporting=true',"Object.defineProperty(persistence,'restorePhase',{get:()=> 'failed'})", "Object.defineProperty(audioRecording,'requesting',{get:()=>true})"]){
        const f=await fixture('state.clips.push({start:5,end:10})');f.open();const before=f.snapshot();
        vm.runInContext(flag,f.context);f.element('#captionOccurrence1').onclick();assert.equal(f.evaluate('current'),0);assert.deepEqual(f.snapshot(),before);
    }
    const f=await fixture();f.open(0,{isComposing:true});assert.equal(f.evaluate('current'),0);
    f.element('#panelContent').oncompositionstart();f.open();assert.equal(f.evaluate('current'),0);
    f.element('#panelContent').oncompositionend();f.open();assert.equal(f.evaluate('current'),1);
});

test('chooser reaches last and first pages without edits and keeps row count bounded',async()=>{
    const f=await fixture('state.clips=Array.from({length:43},()=>({start:5,end:10}))');const before=f.snapshot();f.open();
    f.element('#nextCaptionOccurrencePage').onclick();f.element('#nextCaptionOccurrencePage').onclick();
    assert.equal([...f.element('#captionOccurrences').innerHTML.matchAll(/id="captionOccurrence\d+"/g)].length,3);
    assert.match(f.element('#captionOccurrences').innerHTML,/43번째/);
    f.element('#previousCaptionOccurrencePage').onclick();f.element('#previousCaptionOccurrencePage').onclick();
    assert.match(f.element('#captionOccurrences').innerHTML,/1번째/);assert.deepEqual(f.snapshot(),before);
    f.element('#captionOccurrence0').onclick({isComposing:true});assert.equal(f.evaluate('current'),0);
    f.element('#captionOccurrence0').onclick();assert.equal(f.evaluate('current'),1);
});


test('fractional timing at both speed extremes uses exact unrounded seek and localized controls',async()=>{
    for (const [locale,label] of [['ko','영상에서 보기'],['en','View in video'],['zh-CN','在视频中查看']]) {
        for (const speed of [.25,4]) {
            const f=await fixture(`state.speed=${speed};state.captions[0].start=6.123456789;state.clips.push({start:5,end:10})`);
            setLocale(locale,{persist:false});
            f.open();assert.ok(f.element('#captionOccurrences').innerHTML.includes(label));
            f.element('#captionOccurrence1').onclick();
            assert.equal(f.evaluate('current'), (5 + 6.123456789 - 5) / speed * speed);
        }
    }
    initLocale();
});

test('switching to text panel while chooser is open preserves unrelated input drafts',async()=>{
    const f=await fixture('state.clips.push({start:5,end:10})');f.open();
    const choose=f.element('#captionOccurrence1').onclick;
    vm.runInContext("switchPanel('text')",f.context);
    const draft=f.element('#titleInput');draft.value='Uncommitted title';draft.focus();
    const before=f.snapshot();choose();
    assert.equal(f.evaluate('current'),0);assert.equal(draft.value,'Uncommitted title');
    assert.equal(f.doc.activeElement,draft);assert.deepEqual(f.snapshot(),before);
});

test('invalid authored index and closed/reopened chooser cannot reuse old handlers',async()=>{
    const f=await fixture('state.clips.push({start:5,end:10})');
    vm.runInContext('captionRowNavigation.open(-1);captionRowNavigation.open(999)',f.context);
    assert.equal(f.element('#modal').open,false);
    f.open();const old=f.element('#captionOccurrence1').onclick;
    f.element('#modal').close();f.open();old();
    assert.equal(f.evaluate('current'),0);assert.equal(f.element('#modal').open,true);
    f.element('#captionOccurrence1').onclick();assert.equal(f.evaluate('current'),6);
});
