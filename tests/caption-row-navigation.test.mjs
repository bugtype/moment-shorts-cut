import {createCaptionNavigation} from '../dist/caption-navigation.mjs';
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

test('closed/reopened chooser cannot reuse old handlers',async()=>{
    const f=await fixture('state.clips.push({start:5,end:10})');
    f.open();const old=f.element('#captionOccurrence1').onclick;
    f.element('#modal').close();f.open();old();
    assert.equal(f.evaluate('current'),0);assert.equal(f.element('#modal').open,true);
    f.element('#captionOccurrence1').onclick();assert.equal(f.evaluate('current'),6);
});


test('navigation controller ignores invalid authored indices without opening or seeking',()=>{
    let actions=0;
    const navigation=createCaptionNavigation({getProject:()=>({captions:[]}),getMedia:()=>[],query:()=>null,
        modal:{open:false},openModal:()=>actions++,blocked:()=>false,pause:()=>actions++,seek:()=>actions++,toast:()=>actions++});
    navigation.open(-1);navigation.open(999);assert.equal(actions,0);
});

test('single-clip row navigation skips unused snapshots through edits, Undo and Redo', async () => {
    const f = await fixture(), nativeStringify = JSON.stringify;
    let active = false, tracked, calls = 0;
    JSON.stringify = function(value, ...args) {
        if (active && value === tracked) calls++;
        return nativeStringify.call(this, value, ...args);
    };
    const open = () => {
        tracked = vm.runInContext('state', f.context);
        calls = 0; active = true;
        try { f.open(); } finally { active = false; }
        return calls;
    };
    try {
        const draft = f.element('[data-caption-text="0"]'), originalValue = draft.value;
        draft.value = '작성 중 자막'; draft.focus();
        let before = f.snapshot();
        assert.equal(open(), 0, 'A direct seek has no delayed action needing a snapshot');
        assert.equal(f.evaluate('current'), 1);
        assert.equal(f.element('#modal').open, false);
        assert.equal(f.doc.activeElement, draft);
        assert.equal(draft.value, '작성 중 자막');
        assert.deepEqual(f.snapshot(), before);
        draft.value = originalValue;

        vm.runInContext('state.captions[0].start=0;state.captions[0].end=5;current=0', f.context);
        before = f.snapshot();
        assert.equal(open(), 0, 'A trimmed-out cue also has no delayed action');
        assert.equal(f.evaluate('current'), 0);
        assert.equal(f.element('#modal').open, false);
        assert.deepEqual(f.snapshot(), before);
        vm.runInContext('state.captions[0].start=6;state.captions[0].end=8', f.context);

        const result = await f.context.window.moment.execute('timeline.duplicate', {clipIndex: 0});
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(f.evaluate('state.clips.length'), 2);
        before = f.snapshot();
        assert.equal(open(), 1, 'A repeated-clip chooser keeps its snapshot');
        assert.equal(f.element('#modal').open, true);
        assert.deepEqual(f.snapshot(), before);
        f.element('#modal').close();

        f.element('#undoButton').onclick();
        assert.equal(f.evaluate('state.clips.length'), 1);
        before = f.snapshot();
        assert.equal(open(), 0);
        assert.deepEqual(f.snapshot(), before);
        f.element('#redoButton').onclick();
        assert.equal(f.evaluate('state.clips.length'), 2);
        before = f.snapshot();
        assert.equal(open(), 1);
        f.element('#captionOccurrence1').onclick();
        assert.equal(f.evaluate('current'), 6);
        assert.equal(f.evaluate('playing'), false);
        assert.equal(f.element('#modal').open, false);
        assert.deepEqual(f.snapshot(), before);
    } finally { JSON.stringify = nativeStringify; }
});

test('multi-clip snapshot still precedes media callbacks, including mutation and failure', () => {
    for (const fails of [false, true]) {
        const project = {captions: [{start:6,end:8,text:'Original'}],
            clips: [{start:5,end:10},{start:5,end:10}], speed: 2};
        const trace = [], nodes = new Map(), modal = {open: false}, failure = new Error('media');
        const query = selector => {
            if (!nodes.has(selector)) nodes.set(selector, {innerHTML:'', focus() {}});
            return nodes.get(selector);
        };
        let seeks = 0;
        const navigation = createCaptionNavigation({
            getProject: () => project,
            getMedia: () => {
                trace.push('media');
                if (fails) throw failure;
                project.captions[0].text = 'Changed during media lookup';
                return [];
            },
            query, modal, blocked: () => false,
            openModal: () => { trace.push('modal'); modal.open = true; },
            pause: () => trace.push('pause'), seek: () => seeks++, toast: () => trace.push('toast'),
        });
        const nativeStringify = JSON.stringify;
        JSON.stringify = function(value, ...args) {
            if (value === project) trace.push('snapshot');
            return nativeStringify.call(this, value, ...args);
        };
        try {
            if (fails) {
                assert.throws(() => navigation.open(0), error => error === failure);
                assert.deepEqual(trace, ['snapshot', 'media']);
                assert.equal(modal.open, false);
            } else {
                navigation.open(0);
                assert.deepEqual(trace, ['snapshot', 'media', 'modal']);
                query('#captionOccurrence0').onclick();
                assert.deepEqual(trace, ['snapshot', 'media', 'modal', 'snapshot']);
                assert.match(query('#captionOccurrences').innerHTML, /role="status"/);
            }
            assert.equal(seeks, 0);
        } finally { JSON.stringify = nativeStringify; }
    }
});
