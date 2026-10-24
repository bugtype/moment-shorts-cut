import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {setLocale,initLocale} from '../dist/i18n.mjs';

async function fixture({video=true,audio=true}={}) {
    const f=await createAppFixture();
    for(const id of ['audioSourceVolume','audioVolume','volume']) f.element('#'+id).type='range';
    vm.runInContext(`state.kind='${video?'video':'demo'}';state.volume=.8;state.audioVolume=.4;
        sources.audioFile=${audio?'Object.assign(new Blob(["audio"]),{name:"music.wav"})':'null'};state.audioName='music.wav';
        history=[];future=[];switchPanel('audio');renderInspector()`,f.context);
    f.change=(id,value,event={})=>{const control=f.element('#'+id);control.value=String(value);control.oninput(event);};
    return f;
}

test('Audio panel offers independent original and added gain only when applicable',async()=>{
    for(const video of [false,true]) for(const audio of [false,true]) {
        const f=await fixture({video,audio}),html=f.element('#panelContent').innerHTML;
        assert.equal(html.includes('id="audioSourceVolume"'),video);
        assert.equal(html.includes('id="audioVolume"'),audio);
        if(video) assert.match(html,/for="audioSourceVolume"/);
        if(audio) assert.match(html,/for="audioVolume"/);
    }
});

test('one slider gesture creates one Undo, affects only its gain and synchronizes existing Frame controls',async()=>{
    const f=await fixture(),before=f.evaluate('state');
    f.element('#audioSourceVolume').onpointerdown();
    f.change('audioSourceVolume',.6);f.change('audioSourceVolume',.3);
    f.element('#audioSourceVolume').onpointerup();
    assert.equal(f.evaluate('history.length'),1);
    assert.equal(f.evaluate('state.audioVolume'),.4);
    assert.equal(Number(f.element('#volume').value),.3);
    assert.equal(f.element('#audioSourceVolumeOutput').textContent,'30%');
    vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);
    vm.runInContext('undo(true)',f.context);assert.equal(f.evaluate('state.volume'),.3);
    f.change('volume',.7);
    assert.equal(Number(f.element('#audioSourceVolume').value),.7);
    assert.equal(f.element('#audioSourceVolumeOutput').textContent,'70%');
    const count=f.evaluate('history.length');
    f.element('#audioVolume').onpointerdown();f.change('audioVolume',.1);f.change('audioVolume',.2);f.element('#audioVolume').onpointerup();
    assert.equal(f.evaluate('history.length'),count+1);
    assert.equal(f.evaluate('state.volume'),.7);
    assert.equal(f.element('#audioVolumeOutput').textContent,'20%');
});

test('guarded audio gestures refuse stale, busy, modal, invalid and IME events before snapshot',async()=>{
    for(const mutation of ["panel='settings'","state=structuredClone(state)","sources.audioFile={}","sources.videoFile={}",
        'loadingMedia=true','exporting=true','transcribing=true','editorReady=false',
        "persistence.restorePhase='restoring'","persistence.restorePhase='failed';persistence.recoveryValid=false",
        "Object.defineProperty(audioRecording,'requesting',{value:true})","Object.defineProperty(audioRecording,'current',{value:{}})",
        "modalOpen('Other','Other')"]) {
        const f=await fixture();vm.runInContext(mutation,f.context);
        f.change('audioSourceVolume',.2);f.change('audioVolume',.2);
        assert.equal(f.evaluate('history.length'),0,mutation);
        assert.equal(f.evaluate('state.volume'),.8);assert.equal(f.evaluate('state.audioVolume'),.4);
    }
    const f=await fixture();
    for(const value of ['','NaN',-1,2]) f.change('audioSourceVolume',value);
    f.change('audioSourceVolume',.2,{isComposing:true});
    const old=f.element('#audioSourceVolume').oninput;
    vm.runInContext('renderPanel()',f.context);old();
    assert.equal(f.evaluate('history.length'),0);
});

test('failed-valid gains and undo remain memory-only with authored media metadata unchanged',async()=>{
    const f=await fixture(),writes=[];
    f.context.localStorage.setItem=(...args)=>writes.push(args);
    vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true",f.context);
    const before=f.evaluate('state');
    f.change('audioSourceVolume',.5);f.element('#audioSourceVolume').onblur();f.change('audioVolume',.6);
    assert.equal(f.evaluate('history.length'),2);
    const after=f.evaluate('state');after.volume=before.volume;after.audioVolume=before.audioVolume;
    assert.deepEqual(after,before);
    await vm.runInContext('saveProject(true);scheduleSave();undo();undo()',f.context);
    assert.deepEqual(f.evaluate('state'),before);assert.deepEqual(writes,[]);
});

test('gain updates preserve monitor mute and independent recording mix connections',async()=>{
    const f=await fixture(),gains=[],links=[];
    const node=name=>({name,gain:{value:1},connect(other){links.push([name,other.name]);}});
    f.context.AudioContext=class {
        constructor(){this.destination=node('monitor');}
        createMediaStreamDestination(){return {...node('recording'),stream:{}};}
        createMediaElementSource(element){return node(element===f.element('#sourceVideo')?'video':'audio');}
        createGain(){const gain=node('gain'+gains.length);gains.push(gain);return gain;}
        async resume(){}
    };
    vm.runInContext('muted=true',f.context);
    await vm.runInContext('ensureAudio()',f.context);
    f.change('audioSourceVolume',.25);f.change('audioVolume',.65);
    assert.deepEqual(gains.map(gain=>gain.gain.value),[.25,.65,0]);
    assert.ok(links.some(([from,to])=>from==='gain0'&&to==='recording'));
    assert.ok(links.some(([from,to])=>from==='gain1'&&to==='recording'));
    f.element('#muteButton').onclick();
    assert.deepEqual(gains.map(gain=>gain.gain.value),[.25,.65,1]);
});

test('Audio labels localize without changing either gain',async()=>{
    try {
        for(const [locale,label] of [['ko','원본 영상 볼륨'],['en','Original video volume'],['zh-CN','原始视频音量']]) {
            const f=await fixture();setLocale(locale,{persist:false});vm.runInContext('renderPanel()',f.context);
            assert.ok(f.element('#panelContent').innerHTML.includes(label));
            assert.equal(f.evaluate('state.volume'),.8);assert.equal(f.evaluate('state.audioVolume'),.4);
        }
    } finally {initLocale();}
});


test('owned blur during a modal ends the gesture; detached lifecycle callbacks cannot split a newer gesture',async()=>{
    const f=await fixture();
    f.change('audioSourceVolume',.6);
    vm.runInContext("modalOpen('Other','Other')",f.context);
    f.element('#audioSourceVolume').onblur();
    vm.runInContext('modal.close()',f.context);
    f.change('audioSourceVolume',.5);
    assert.equal(f.evaluate('history.length'),2);
    const oldBlur=f.element('#audioSourceVolume').onblur;
    vm.runInContext('renderPanel()',f.context);
    f.element('#audioSourceVolume').onpointerdown();
    f.change('audioSourceVolume',.4);
    oldBlur();
    f.change('audioSourceVolume',.3);
    assert.equal(f.evaluate('history.length'),3);
});


test('current refused input restores its model value without rendering or taking a snapshot',async()=>{
    const f=await fixture();
    vm.runInContext('loadingMedia=true',f.context);
    f.change('audioSourceVolume',.1);
    assert.equal(f.element('#audioSourceVolume').value,'0.8');
    vm.runInContext('loadingMedia=false',f.context);
    f.change('audioVolume',2);
    assert.equal(f.element('#audioVolume').value,'0.4');
    f.change('audioSourceVolume',.2,{keyCode:229});
    assert.equal(f.element('#audioSourceVolume').value,'0.8');
    assert.equal(f.evaluate('history.length'),0);
});
