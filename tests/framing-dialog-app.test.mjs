import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale,setLocale} from '../dist/i18n.mjs';
import {createCompositionRenderer} from '../dist/composition-renderer.mjs';
import {videoFrame} from '../dist/typography.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {createCanvasTrace} from './fixtures/canvas-trace.mjs';

async function fixture(mobile=false){
    const f=await createAppFixture();
    vm.runInContext(`state.panX=.1+.2;state.panY=-.1234567;state.zoom=1.234567;switchPanel('${mobile?'settings':'media'}');current=2;history=[];future=[];`,f.context);
    f.open=event=>f.element(mobile?'#openPanelFraming':'#openFraming').onclick(event||{});
    f.apply=(patch={})=>{for(const [key,value] of Object.entries(patch))f.element('#framing-'+key).value=String(value);f.element('#applyFraming').onclick({});};
    return f;
}

test('desktop and Settings framing preserve untouched coordinates, complete content and one undo',async()=>{
    for(const mobile of [false,true]){
        const f=await fixture(mobile),before=f.evaluate('state');f.open();
        assert.equal(Number(f.element('#framing-panX').value),before.panX*100);
        assert.equal(Number(f.element('#framing-zoom').value),before.zoom*100);
        f.apply({panY:-42.12345});const after=f.evaluate('state');
        assert.equal(after.panY,-42.12345/100);after.panY=before.panY;assert.deepEqual(after,before);
        assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('current'),2);
        assert.equal(f.doc.activeElement,f.element(mobile?'#openPanelFraming':'#openFraming'));
        vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);
        vm.runInContext('undo(true)',f.context);assert.equal(f.evaluate('state.panY'),-42.12345/100);
    }
});

test('same/cancel preserve exact tiny coordinates, active playback and drafts; changed edit keeps trim drafts',async()=>{
    const f=await fixture(true);vm.runInContext('state.panX=Number.MIN_VALUE;state.panY=-0;playing=true;',f.context);
    f.element('#trimStart').value='1.2345';f.element('#panelTrimStart').value='1.2345';
    const before=f.evaluate('({state,history,current,playing})');f.open();f.apply({zoom:String(1.234567*100)+'0'});
    assert.deepEqual(f.evaluate('({state,history,current,playing})'),before);assert.equal(vm.runInContext('Object.is(state.panY,-0)',f.context),true);
    f.open();f.element('#cancelFraming').onclick();assert.deepEqual(f.evaluate('({state,history,current,playing})'),before);
    assert.equal(f.element('#panelTrimStart').value,'1.2345');
    f.open();f.apply({zoom:200});assert.equal(vm.runInContext('state.panX===Number.MIN_VALUE && Object.is(state.panY,-0)',f.context),true);
    assert.equal(f.element('#trimStart').value,'1.2345');assert.equal(f.element('#panelTrimStart').value,'1.2345');
});

test('entered tiny negative offsets reopen unchanged and allow an independent zoom edit', async () => {
    try {
        for (const locale of ['ko', 'en', 'zh-CN']) for (const mobile of [false, true]) {
            const f = await fixture(mobile);
            setLocale(locale, { persist: false });
            f.open();
            f.apply({ panX: '-0.00000001', panY: '-0.00000002' });
            const before = f.evaluate('state');
            assert.equal(before.panX, -1e-8 / 100);
            assert.equal(before.panY, -2e-8 / 100);
            assert.equal(f.evaluate('history.length'), 1);
            f.open();
            for (const key of ['panX', 'panY']) {
                assert.equal(Number(f.element('#framing-' + key).value), before[key] * 100);
            }
            f.apply();
            assert.equal(f.evaluate('modal.open'), false);
            assert.deepEqual(f.evaluate('state'), before);
            assert.equal(f.evaluate('history.length'), 1);
            f.open();
            f.apply({ zoom: 200 });
            assert.deepEqual(f.evaluate('state'), { ...before, zoom: 2 });
            assert.equal(f.evaluate('history.length'), 2);
            vm.runInContext('undo()', f.context);
            assert.deepEqual(f.evaluate('state'), before);
            vm.runInContext('undo(true)', f.context);
            assert.deepEqual(f.evaluate('state'), { ...before, zoom: 2 });
        }
    } finally { initLocale(); }
});

test('framing preserves untouched negative subnormal model coordinates when zoom changes', async () => {
    const f = await fixture();
    vm.runInContext('state.panX=-Number.MIN_VALUE;state.panY=-1e-300;', f.context);
    const before = f.evaluate('state');
    f.open();
    for (const key of ['panX', 'panY']) {
        assert.equal(Number(f.element('#framing-' + key).value), before[key] * 100);
    }
    f.apply({ zoom: 200 });
    assert.deepEqual(f.evaluate('state'), { ...before, zoom: 2 });
    assert.equal(f.evaluate('history.length'), 1);
});

test('framing validates all changed fields atomically without clamping and accepts model endpoints',async()=>{
    const f=await fixture();f.open();const before=f.evaluate('state');
    for(const value of ['', 'Infinity','NaN',-100.0001,100.0001]){
        f.apply({panX:value,panY:40});assert.deepEqual(f.evaluate('state'),before);assert.equal(f.evaluate('history.length'),0);
    }
    for(const value of ['',99.999,300.001]){f.apply({panX:0,zoom:value});assert.deepEqual(f.evaluate('state'),before);}
    f.apply({panX:-100,panY:100,zoom:300});assert.deepEqual(f.evaluate('({x:state.panX,y:state.panY,z:state.zoom})'),{x:-1,y:1,z:3});
    f.open();f.apply({panX:100,panY:-100,zoom:100});assert.deepEqual(f.evaluate('({x:state.panX,y:state.panY,z:state.zoom})'),{x:1,y:-1,z:1});
});

test('framing refuses stale context, media, modal owners, busy and IME without stealing newer focus',async()=>{
    for(const mutation of ['state=structuredClone(state)',"state.name+='x'",'selected=1',"switchPanel('captions')",'sources.videoFile={}', 'sources.audioFile={}', 'loadingMedia=true','exporting=true','transcribing=true',"persistence.restorePhase='restoring'","persistence.restorePhase='failed';persistence.recoveryValid=false"]){
        const f=await fixture();f.open();vm.runInContext(mutation,f.context);const before=f.evaluate('state');f.apply({panX:40});assert.deepEqual(f.evaluate('state'),before);assert.equal(f.evaluate('history.length'),0,mutation);
    }
    const f=await fixture(true);const opener=f.element('#openPanelFraming').onclick;
    vm.runInContext('renderPanel()',f.context);opener({});assert.equal(f.evaluate('!!modal.open'),false);
    vm.runInContext("switchPanel('media')",f.context);f.open();assert.equal(f.evaluate('!!modal.open'),false);
    f.element('#openFraming').onclick({isComposing:true});assert.equal(f.evaluate('!!modal.open'),false);
    f.element('#openFraming').onclick({});const old=f.element('#applyFraming').onclick;
    f.element('#cancelFraming').onclick();f.element('#openFraming').onclick({});old({});assert.equal(f.evaluate('history.length'),0);
    const input=f.element('#framing-panX');input.value='40';input.oncompositionstart();f.element('#applyFraming').onclick({});input.oncompositionend();
    let prevented=0;for(const flags of [{isComposing:true},{keyCode:229},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true}])input.onkeydown({key:'Enter',preventDefault(){prevented++;},...flags});
    assert.equal(prevented,0);input.onkeydown({key:'Enter',preventDefault(){prevented++;}});assert.equal(f.evaluate('history.length'),1);
    f.element('#openFraming').onclick({});const stale=f.element('#applyFraming').onclick;
    vm.runInContext("modalOpen('other','new dialog');",f.context);const focus=f.doc.activeElement;stale({});assert.equal(f.doc.activeElement,focus);assert.equal(f.evaluate('history.length'),1);
});

test('replacement Settings action receives focus after commit, not detached opener',async()=>{
    const f=await fixture(true),root=f.element('#panelContent'),query=f.doc.querySelector;
    let markup=root.innerHTML,current=f.element('#openPanelFraming');const original=current;
    f.doc.querySelector=selector=>selector==='#openPanelFraming'?current:query(selector);
    Object.defineProperty(root,'innerHTML',{configurable:true,get:()=>markup,set:value=>{markup=value;current={focus(){f.doc.activeElement=this;}};}});
    original.onclick({});f.apply({zoom:150});assert.notEqual(current,original);assert.equal(f.doc.activeElement,current);assert.equal(f.evaluate('history.length'),1);
});

test('failed-valid framing is metadata-only with zero saves and all three locale labels',async()=>{
    try{for(const [locale,label] of [['ko','가로 이동'],['en','Horizontal offset'],['zh-CN','水平偏移']]){
        const f=await fixture(),writes=[];f.context.localStorage.setItem=(...args)=>writes.push(args);setLocale(locale,{persist:false});
        vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true;",f.context);f.open();assert.ok(f.element('#modal').innerHTML.includes(label));
        f.apply({panX:20,zoom:150});assert.equal(f.evaluate('history.length'),1);await vm.runInContext('saveProject(true);scheduleSave();undo();',f.context);assert.deepEqual(writes,[]);
    }}finally{initLocale();}
});

test('source trace uses video-region offsets and fitted zoom for cover, contain and framed layouts',()=>{
    for(const fit of ['cover','contain'])for(const layout of ['full','framed']){
        const project=createDemoProject();project.fit=fit;project.design.layout=layout;project.panX=.1234567;project.panY=-.2;project.zoom=1.234567;
        const trace=createCanvasTrace(),renderer=createCompositionRenderer(trace.makeCanvas);
        const media={source:{traceName:'video'},sw:400,sh:200,ready:true,sourceTime:1,time:1,total:12,elapsed:1,remaining:11,progress:1/12};
        const before=structuredClone(project);renderer.draw(trace.context,200,300,project,media);
        const frame=videoFrame(project.design,200,300),scale=(fit==='cover'?Math.max:Math.min)(frame.w/400,frame.h/200)*project.zoom;
        const expected=['output','drawImage','video',frame.x+(frame.w-400*scale)/2+project.panX*frame.w,frame.y+(frame.h-200*scale)/2+project.panY*frame.h,400*scale,200*scale];
        assert.deepEqual(trace.events.find(event=>event[1]==='drawImage'&&event[2]==='video'),expected);assert.deepEqual(project,before);
    }
});
