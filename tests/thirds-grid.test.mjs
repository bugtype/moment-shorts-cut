import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { initLocale, setLocale } from '../dist/i18n.mjs';

function toggle(f,id,value,event={}) {
    const input=f.element('#'+id);
    input.checked=value;
    input.onchange(event);
}

test('thirds grid defaults off and synchronizes desktop/mobile without project, playback, painting or storage changes', async () => {
    const f=await createAppFixture(), writes=[];
    f.context.localStorage.setItem=(...args)=>writes.push(args);
    vm.runInContext("switchPanel('settings');playing=true;history=[];future=[]",f.context);
    assert.equal(f.element('#thirdsGuide').hidden,true);
    assert.equal(f.element('#thirdsGridDesktop').checked,false);
    assert.equal(f.element('#thirdsGridPanel').checked,false);
    const before=f.evaluate('({state,current,playing,history,future,width:canvas.width,height:canvas.height})');
    vm.runInContext("pause=draw=requestDraw=scheduleSave=()=>{throw Error('view-only toggle invoked editor action')}",f.context);
    toggle(f,'thirdsGridDesktop',true);
    assert.equal(f.element('#thirdsGuide').hidden,false);
    assert.equal(f.element('#thirdsGridPanel').checked,true);
    toggle(f,'thirdsGridPanel',false);
    assert.equal(f.element('#thirdsGridDesktop').checked,false);
    assert.equal(f.element('#thirdsGuide').hidden,true);
    assert.deepEqual(f.evaluate('({state,current,playing,history,future,width:canvas.width,height:canvas.height})'),before);
    assert.deepEqual(writes,[]);
});

test('session choice survives panel rerenders, project replacement and all ratios but not a fresh editor', async () => {
    const f=await createAppFixture();
    toggle(f,'thirdsGridDesktop',true);
    for(const ratio of ['9:16','4:5','1:1','16:9']) {
        vm.runInContext(`state.ratio='${ratio}';resizePreview();switchPanel('settings')`,f.context);
        assert.equal(f.element('#thirdsGridPanel').checked,true);
        assert.equal(f.element('#thirdsGuide').hidden,false);
        vm.runInContext("switchPanel('captions')",f.context);
    }
    vm.runInContext("state=initial();switchPanel('settings')",f.context);
    assert.equal(f.element('#thirdsGridPanel').checked,true);
    const fresh=await createAppFixture();
    assert.equal(fresh.element('#thirdsGuide').hidden,true);
});

test('stale mobile handlers and composing or behind-modal toggles cannot change the session choice', async () => {
    const f=await createAppFixture();
    vm.runInContext("switchPanel('settings')",f.context);
    const old=f.element('#thirdsGridPanel').onchange;
    vm.runInContext('renderPanel()',f.context);
    f.element('#thirdsGridPanel').checked=true;old();
    assert.equal(f.element('#thirdsGuide').hidden,true);
    toggle(f,'thirdsGridDesktop',true,{isComposing:true});
    assert.equal(f.element('#thirdsGridDesktop').checked,false);
    vm.runInContext("modalOpen('Other','Other')",f.context);
    toggle(f,'thirdsGridPanel',true);
    assert.equal(f.element('#thirdsGridPanel').checked,false);
    assert.equal(f.element('#thirdsGuide').hidden,true);
});

test('localized settings retain the session choice and both controls have associated labels', async () => {
    try {
        const f=await createAppFixture();
        toggle(f,'thirdsGridDesktop',true);
        for(const [locale,label] of [['ko','삼분할 격자'],['en','Thirds grid'],['zh-CN','三分法网格']]) {
            setLocale(locale,{persist:false});
            vm.runInContext("switchPanel('settings')",f.context);
            assert.ok(f.element('#panelContent').innerHTML.includes(label));
            assert.equal(f.element('#thirdsGridPanel').checked,true);
        }
    } finally {initLocale();}
    const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
    assert.match(html,/<label class="preview-guide-option"><input id="thirdsGridDesktop"[^>]*aria-controls="thirdsGuide"/);
});

test('guides remain a clipped noninteractive DOM sibling, below editing handles and outside canvas capture', () => {
    const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
    const css=fs.readFileSync(new URL('../dist/styles/preview-timeline.css',import.meta.url),'utf8');
    assert.match(html,/<\/canvas><div class="thirds-guide" id="thirdsGuide" aria-hidden="true" hidden><i><\/i><i><\/i><i><\/i><i><\/i><\/div>/);
    assert.match(css,/\.thirds-guide\s*\{[^}]*inset:0;[^}]*z-index:2;[^}]*pointer-events:none/s);
    assert.match(css,/\.thirds-guide\[hidden\],body.exporting \.thirds-guide\s*\{\s*display:none/);
    assert.match(css,/\.canvas-wrap\s*\{[^}]*overflow:hidden/s);
    assert.match(css,/left:33\.333333%/);assert.match(css,/top:66\.666667%/);
});

test('enabled guide is excluded from preview PNG and output PNG renderer inputs', async () => {
    const f=await createAppFixture(), copies=[], scenes=[];
    vm.runInContext("switchPanel('settings');sample.complete=true;sampleRaster={width:540,height:960};video.paused=audio.paused=true",f.context);
    toggle(f,'thirdsGridPanel',true);
    const before=f.evaluate('({state,width:canvas.width,height:canvas.height})');
    f.doc.fonts.status='loaded';
    f.doc.createElement=()=>({getContext:()=>({drawImage:source=>copies.push(source)}),toBlob(){}});
    f.element('#savePreviewPng').onclick();
    assert.equal(copies.length,1);
    assert.equal(copies[0],f.element('#preview'));
    f.context.scenes=scenes;
    vm.runInContext('app.composition.draw=(...args)=>scenes.push(args)',f.context);
    f.element('#openScenePng').onclick();f.element('#saveScenePng').onclick();
    assert.equal(scenes.length,1);
    assert.equal(scenes[0][4].source,vm.runInContext('sampleRaster || sample',f.context));
    assert.notEqual(scenes[0][4].source,f.element('#thirdsGuide'));
    assert.deepEqual(f.evaluate('({state,width:canvas.width,height:canvas.height})'),before);
    assert.equal(f.element('#thirdsGridPanel').checked,true);
});
