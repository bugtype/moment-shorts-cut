import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale, setLocale, translateFor} from '../dist/i18n.mjs';

async function fixture({clips = [{start:0,end:12}], speed = .75, captions}) {
    const f = await createAppFixture(), queryAll = f.doc.querySelectorAll;
    f.doc.querySelectorAll = selector => selector === '[data-view-caption]'
        ? captions.map((_, index) => {
            const row = f.element(`[data-view-caption="${index}"]`);
            row.dataset.viewCaption = String(index);
            return row;
        }) : queryAll(selector);
    vm.runInContext(`state.clips=${JSON.stringify(clips)};state.speed=${speed};state.captions=${JSON.stringify(captions)};
        history=[];future=[];current=0;globalThis.saves=0;scheduleSave=()=>saves++;
        renderTimeline();switchPanel('captions');`, f.context);
    f.snapshot = () => f.evaluate('({state,history,future,selected,saves})');
    f.active = () => f.evaluate(`state.captions.map((caption,index)=>{
        const clock=caption.basis==='timeline'?current/state.speed*state.speed:locate(current).source;
        return clock>=caption.start&&clock<caption.end?index:null;
    }).filter(index=>index!==null)`);
    return f;
}

test('row and timeline targets remain inside fractional source and timeline cues', async () => {
    const cases = [
        {captions:[{start:.21,end:.6,text:'Speed'}]},
        {speed:1,clips:[{start:.1,end:.7}],captions:[{start:.41,end:.43,text:'Offset'}]},
        {speed:1,clips:[{start:0,end:12},{start:.1,end:.7}],captions:[{start:.11,end:.13,text:'Repeat'}], occurrence:1},
        {captions:[{start:.21,end:.6,text:'Timeline',basis:'timeline'}]},
    ];
    for (const setup of cases) for (const action of ['row','timeline']) {
        const f = await fixture(setup), before = f.snapshot();
        if (action === 'row') {
            f.element('[data-view-caption="0"]').onclick();
            if (setup.occurrence) f.element(`#captionOccurrence${setup.occurrence}`).onclick();
        } else {
            const block = f.element('#captionTrack').children[setup.occurrence || 0];
            f.element('#captionTrack').onclick({target:{closest:()=>block}});
        }
        assert.deepEqual(f.active(), [0], `${action}: ${JSON.stringify(setup)}`);
        if (setup.occurrence) assert.equal(f.evaluate('locate(current).index'), 1);
        assert.equal(f.evaluate('playing'), false);
        assert.deepEqual(f.snapshot(), before);
    }
});

test('inspection and overlap targets include the requested cue and overlap witness', async () => {
    for (const action of ['inspection','overlap','inspection-overlap']) for (const basis of [undefined,'timeline']) {
        const f = await fixture({captions:[{start:0,end:.5,text:'First'},{start:.21,end:.6,text:'Target',...(basis ? {basis} : {})}]}), before = f.snapshot();
        if (action === 'overlap') {
            f.element('#inspectCaptionOverlaps').onclick();
            f.element('#overlapOccurrence0').onclick();
        } else {
            f.element('#inspectCaptions').onclick();
            f.element('#captionInspectionMin').value = action === 'inspection' ? '1' : '';
            f.element('#captionInspectionOverlaps').checked = action !== 'inspection';
            f.element('#runCaptionInspection').onclick();
            f.element(action === 'inspection' ? '#inspectOccurrence1' : '#inspectOccurrence0').onclick();
        }
        assert.deepEqual(f.active(), [0,1], `${action}: ${basis}`);
        assert.equal(f.element('#modal').open, false);
        assert.equal(f.evaluate('playing'), false);
        assert.deepEqual(f.snapshot(), before);
    }
});

test('unrepresentable repeated occurrences preserve playback and chooser, including retry and localized errors', async () => {
    for (const locale of ['ko','en','zh-CN']) for (const action of ['row','timeline']) {
        const f = await fixture({speed:1,clips:[{start:0,end:12},{start:0,end:1}],
            captions:[{start:1e-20,end:2e-20,text:'Tiny'}]});
        setLocale(locale,{persist:false});
        vm.runInContext('current=4;playing=true',f.context);
        if (action === 'row') f.element('[data-view-caption="0"]').onclick();
        const before = f.evaluate('({state,current,playing,history,future,selected,saves})');
        for (let retry=0;retry<2;retry++) {
            if (action === 'row') f.element('#captionOccurrence1').onclick();
            else {
                const block=f.element('#captionTrack').children[1];
                f.element('#captionTrack').onclick({target:{closest:()=>block}});
            }
            assert.deepEqual(f.evaluate('({state,current,playing,history,future,selected,saves})'),before);
            assert.equal(f.element('#toast').getAttribute('data-i18n'),'panels.captionNavigationUnavailable');
            assert.equal(f.element('#toast').textContent,translateFor(locale,'panels.captionNavigationUnavailable'));
        }
        if (action === 'row') {
            assert.equal(f.element('#modal').open,true);
            f.element('#captionOccurrence0').onclick();
            assert.equal(f.element('#modal').open,false);
            assert.deepEqual(f.active(),[0]);
            assert.equal(f.evaluate('playing'),false);
        }
    }
    initLocale();
});

test('unrepresentable report navigation keeps the dialog and playback but still allows authored-row focus', async () => {
    for (const action of ['inspection','overlap','inspection-overlap']) {
        const tiny=Number.MIN_VALUE;
        const f=await fixture({speed:2,captions:[
            {start:0,end:tiny*2,text:'First',basis:'timeline'},
            {start:tiny,end:tiny*2,text:'Tiny',basis:'timeline'},
        ]});
        vm.runInContext('current=4;playing=true',f.context);
        if (action === 'overlap') f.element('#inspectCaptionOverlaps').onclick();
        else {
            f.element('#inspectCaptions').onclick();
            f.element('#captionInspectionMin').value=action==='inspection'?'1':'';
            f.element('#captionInspectionOverlaps').checked=action!=='inspection';
            f.element('#runCaptionInspection').onclick();
        }
        const before=f.evaluate('({state,current,playing,history,future,saves})');
        const move=action==='overlap'?'#overlapOccurrence0':action==='inspection'?'#inspectOccurrence1':'#inspectOccurrence0';
        f.element(move).onclick();f.element(move).onclick();
        assert.deepEqual(f.evaluate('({state,current,playing,history,future,saves})'),before);
        assert.equal(f.element('#modal').open,true);
        assert.equal(f.element('#toast').getAttribute('data-i18n'),'panels.captionNavigationUnavailable');
        const focus=action==='overlap'?'#overlapOtherCaption0':action==='inspection'?'#inspectCaption1':'#inspectOther0';
        f.element(focus).onclick();
        assert.equal(f.element('#modal').open,false);
        assert.equal(f.doc.activeElement,f.element('[data-caption-text="1"]'));
        assert.deepEqual(f.evaluate('({state,current,playing,history,future,saves})'),before);
    }
});
