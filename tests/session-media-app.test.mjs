import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale,setLocale} from '../dist/i18n.mjs';

function media(node = {}, duration = 12, pending = false) {
    const listeners=new Map();let src='',time=0;
    Object.assign(node,{duration,readyState:4,videoWidth:1920,videoHeight:1080,
        pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},
        addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name);},
        getAttribute(name){return name==='src' ? src || null : null;},removeAttribute(name){if(name==='src')src='';},load(){},
        finish(){listeners.get('loadeddata')?.();},
        finishSeek(){this.readyState=4;this.seeking=false;listeners.get('seeked')?.();},
    });
    Object.defineProperties(node,{src:{configurable:true,get:()=>src,set:value=>{src=value;if(!pending)queueMicrotask(()=>listeners.get('loadeddata')?.());}},
        currentTime:{configurable:true,get:()=>time,set:value=>{time=value;if(node.holdSeek){node.readyState=1;node.seeking=true;}else queueMicrotask(()=>listeners.get('seeked')?.());}}});
    return node;
}
async function fixture({demo=false,audio=false,pending=false}={}) {
    const probes=[],revoked=[],writes=[],downloads=[];
    let url=0;
    const f=await createAppFixture({sessionMediaDependencies:{
        createVideo:()=>{const p=media({},12,pending);probes.push(p);return p;},
        createAudio:()=>{const p=media({},5,pending);probes.push(p);return p;},
        createURL:()=>`blob:session-${++url}`,revokeURL:value=>revoked.push(value),
    }});
    media(f.element('#sourceVideo'));media(f.element('#sourceAudio'),5);
    f.context.localStorage.setItem=(...args)=>writes.push(['json',...args]);
    f.context.writes=writes;f.context.collect=(blob,name)=>downloads.push({blob,name});
    vm.runInContext(`state=initial();state.kind=${JSON.stringify(demo?'demo':'video')};state.fileName='original.mp4';state.audioName=${JSON.stringify(audio?'music.wav':'')};history=[];future=[];current=0;persistence.restorePhase='failed';persistence.recoveryValid=true;persistence.recoveryBaseline=JSON.stringify(state);persistence.restoreMessage='Storage still failed';projectStore.setMedia=(...args)=>writes.push(['idb',...args]);download=collect;`,f.context);
    const snapshot=()=>f.evaluate('({state,history,future,baseline:persistence.recoveryBaseline,notice:persistence.restoreMessage,phase:persistence.restorePhase})');
    const open=()=>{f.element('#projectFilesButton').onclick();f.element('#relinkSessionMedia').onclick();};
    const choose=()=>{for(const [kind,name,needed] of [['Video','original.mp4',!demo],['Audio','music.wav',audio]])if(needed){const input=f.element('#sessionMedia'+kind);const target={files:[{name,size:1}],value:'selected'};input.onchange({target});assert.equal(target.value,'');}};
    const connect=()=>{f.element('#sessionMediaConfirmed').checked=true;return f.element('#connectSessionMedia').onclick();};
    return {...f,probes,revoked,writes,downloads,snapshot,open,choose,connect};
}

test('explicit relink enables session preview, seek, loop and PNG without repairing or writing storage',async()=>{
    const f=await fixture({audio:true}),before=f.snapshot();f.open();f.choose();
    await f.element('#connectSessionMedia').onclick();assert.equal(f.evaluate('sessionMedia.mediaReady()'),false);
    await f.connect();assert.equal(f.evaluate('sessionMedia.mediaReady()'),true);assert.deepEqual(f.snapshot(),before);
    vm.runInContext('seekTo(2)',f.context);assert.equal(f.element('#sourceVideo').currentTime,2);assert.equal(f.element('#sourceAudio').currentTime,2);
    const node=()=>({gain:{value:1},connect(){}});
    f.context.AudioContext=class{constructor(){this.destination={};}async resume(){}createMediaStreamDestination(){return {stream:{getAudioTracks:()=>[]}};}createMediaElementSource(){return node();}createGain(){return node();}};
    await vm.runInContext('play()',f.context);assert.equal(f.evaluate('playing'),true);vm.runInContext('pause();switchPanel("settings")',f.context);
    f.element('#loopPreview').checked=true;f.element('#loopPreview').onchange();assert.equal(f.evaluate('playback.loopPreview'),true);
    const create=f.doc.createElement;f.doc.createElement=tag=>{const el=create(tag);if(tag==='canvas')el.toBlob=fn=>fn(new Blob(['png'],{type:'image/png'}));return el;};
    f.element('#savePreviewPng').onclick();assert.equal(f.downloads.length,1);
    assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.writes,[]);
});

test('session readiness never authorizes load, reset, record, transcription, Save or autosave',async()=>{
    const f=await fixture(),before=f.snapshot();f.open();f.choose();await f.connect();
    await vm.runInContext("loadVideo({name:'new.mp4'});loadAudio({name:'new.wav'});toggleRecording();generateCaptions();confirmReset();saveProject(true);scheduleSave();persistMedia();",f.context);
    assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.writes,[]);assert.equal(f.evaluate('sessionMedia.mediaReady()'),true);
    const result=await f.context.window.moment.execute('project.update',{patch:{zoom:1.5}});assert.equal(result.ok,true);assert.equal(f.evaluate('sessionMedia.mediaReady()'),true);
    vm.runInContext('undo()',f.context);assert.equal(f.evaluate('sessionMedia.mediaReady()'),true);assert.deepEqual(f.writes,[]);
});

test('changed media contract or element invalidates readiness, while clips and styles do not',async()=>{
    for(const mutation of ["state.fileName='different.mp4'","state.duration=11","state.audioName='new.wav'","sources.videoFile={}","video.src='blob:other'"]){
        const f=await fixture();f.open();f.choose();await f.connect();vm.runInContext(mutation,f.context);assert.equal(f.evaluate('sessionMedia.mediaReady()'),false);
        await vm.runInContext('play()',f.context);assert.equal(f.evaluate('playing'),false);
    }
});

test('demo without required files still requires confirmation and retains storage warning',async()=>{
    const f=await fixture({demo:true}),before=f.snapshot();f.element('#helpButton').onclick();assert.doesNotMatch(f.element('#modal').innerHTML,/relinkSessionMedia/);f.open();
    assert.doesNotMatch(f.element('#modal').innerHTML,/id="sessionMediaVideo"/);await f.connect();
    assert.equal(f.evaluate('sessionMedia.mediaReady()'),true);assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.writes,[]);
});

test('pending relink cancelled by replacement or close/reopen cannot attach or close a new dialog',async()=>{
    for(const replace of [true,false]){
        const f=await fixture({pending:true});f.open();f.choose();const pending=f.connect();
        if(replace)vm.runInContext("modalOpen('Other','Other')",f.context);
        else {f.element('#modal').close();f.element('#modal').onclose();f.open();f.element('#modal').onclose();}
        await pending;assert.equal(f.evaluate('sessionMedia.mediaReady()'),false);assert.equal(f.element('#modal').open,true);
        assert.deepEqual(f.writes,[]);
        if(!replace){f.choose();const retry=f.connect();assert.equal(f.element('#connectSessionMedia').disabled,true);f.probes.at(-1).finish();await retry;assert.equal(f.evaluate('sessionMedia.mediaReady()'),true);}
    }
});

test('stale dialog cannot connect a replacement project; all localized warnings retain selected files',async()=>{
    const f=await fixture();f.open();f.choose();vm.runInContext('state=structuredClone(state)',f.context);await f.connect();assert.equal(f.evaluate('sessionMedia.mediaReady()'),false);
    for(const [locale,label] of [['ko','원본 파일 다시 연결'],['en','Relink original files'],['zh-CN','重新链接原始文件']]){
        setLocale(locale,{persist:false});f.open();assert.ok(f.element('#modal').innerHTML.includes(label));f.choose();await f.connect();assert.equal(f.evaluate('sessionMedia.mediaReady()'),true);
    }
    initLocale();
});

test('confirmed session video exports through existing recorder flow without storage writes',async()=>{
    const f=await fixture();f.open();f.choose();await f.connect();const before=f.snapshot();
    const node=()=>({gain:{value:1},connect(){}}),track=()=>({clone:track,stop(){}});
    f.context.AudioContext=class{constructor(){this.destination={};}async resume(){}createMediaStreamDestination(){return {stream:{getAudioTracks:()=>[track()]}};}createMediaElementSource(){return node();}createGain(){return node();}};
    const create=f.doc.createElement;f.doc.createElement=tag=>{const el=create(tag);if(tag==='canvas')el.captureStream=()=>{const tracks=[track()];return {addTrack:t=>tracks.push(t),getTracks:()=>tracks};};return el;};
    let starts=0;
    f.context.MediaRecorder=class{static isTypeSupported(){return true;}constructor(){this.state='inactive';}start(){starts++;this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['mock encoded video'])});this.onstop?.();}};
    await vm.runInContext("startExport({mime:'video/webm',ext:'webm'},720)",f.context);
    assert.equal(starts,1);assert.equal(f.evaluate('exporting'),true);
    vm.runInContext('stopExport(false)',f.context);
    assert.equal(f.downloads.length,1);assert.match(f.downloads[0].name,/\.webm$/);
    assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.writes,[]);
});

test('session capability enables cut and caption occurrence navigation while init invalidates it',async()=>{
    const f=await fixture();vm.runInContext('state.clips=[{start:0,end:4},{start:4,end:12}];persistence.recoveryBaseline=JSON.stringify(state)',f.context);
    f.open();f.choose();await f.connect();f.element('#nextCutButton').onclick();assert.equal(f.evaluate('current'),4);
    const originalQueryAll=f.doc.querySelectorAll;
    f.doc.querySelectorAll=selector=>selector==='[data-view-caption]' ? [0,1,2].map(index=>{
        const node=f.element(`[data-view-caption="${index}"]`);node.dataset.viewCaption=String(index);return node;
    }) : originalQueryAll(selector);
    vm.runInContext("switchPanel('captions')",f.context);
    f.element('[data-view-caption="2"]').onclick();assert.equal(f.evaluate('current'),8);
    await vm.runInContext('init()',f.context);
    assert.equal(f.evaluate('sessionMedia.mediaReady()'),true); // Normal empty-demo restore is independently ready, not a retained capability.
    vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true",f.context);
    assert.equal(f.evaluate('sessionMedia.mediaReady()'),false);
    assert.deepEqual(f.writes,[]);
});


test('recovered preview loop keeps ownership through transient readyState1 seeking',async()=>{
    const f=await fixture();f.open();f.choose();await f.connect();
    vm.runInContext('ensureAudio=async()=>{};playback.setLoopPreview(true)',f.context);
    await vm.runInContext('play()',f.context);assert.equal(f.evaluate('playing'),true);
    const video=f.element('#sourceVideo');video.currentTime=12;video.holdSeek=true;
    vm.runInContext('playback.tick(performance.now()+20)',f.context);
    for(let i=0;i<8;i++)await Promise.resolve();
    assert.equal(video.readyState,1);assert.equal(f.evaluate('sessionMedia.mediaReady()'),true);
    assert.equal(f.evaluate('playing'),false);
    video.finishSeek();for(let i=0;i<8;i++)await Promise.resolve();
    assert.equal(f.evaluate('playing'),true);assert.equal(f.evaluate('current'),0);
    vm.runInContext('pause()',f.context);assert.deepEqual(f.writes,[]);
});


test('manual native play readiness loss pauses only its own request, never a newer play owner',async()=>{
    for(const superseded of [false,true]){
        const f=await fixture();f.open();f.choose();await f.connect();
        vm.runInContext('ensureAudio=async()=>{}',f.context);
        const video=f.element('#sourceVideo'),pending=[];
        video.play=()=>{video.paused=false;return new Promise(resolve=>pending.push(resolve));};
        const old=vm.runInContext('play()',f.context);for(let i=0;i<5;i++)await Promise.resolve();
        assert.equal(pending.length,1);
        if(!superseded){
            vm.runInContext('sources.videoFile={}',f.context);pending[0]();await old;
            assert.equal(video.paused,true);assert.equal(f.evaluate('playing'),false);
        }else{
            vm.runInContext('pause()',f.context);const next=vm.runInContext('play()',f.context);
            for(let i=0;i<5;i++)await Promise.resolve();assert.equal(pending.length,2);
            pending[0]();await old;assert.equal(video.paused,false);
            pending[1]();await next;assert.equal(f.evaluate('playing'),true);
            vm.runInContext('pause()',f.context);
        }
    }
});


test('detached Project files relink button cannot replace a newer dialog',async()=>{
    const f=await fixture();f.element('#projectFilesButton').onclick();const old=f.element('#relinkSessionMedia').onclick;
    vm.runInContext("modalOpen('Other','Unrelated dialog')",f.context);const html=f.element('#modal').innerHTML;old();assert.equal(f.element('#modal').innerHTML,html);
    f.element('#projectFilesButton').onclick();const files=f.element('#modal').innerHTML;old();assert.equal(f.element('#modal').innerHTML,files);
    f.element('#relinkSessionMedia').onclick();assert.match(f.element('#modal').innerHTML,/sessionMediaConfirmed/);
});

test('relinked current-scene template comparison remains read-only while storage stays failed',async()=>{
    const f=await fixture();f.open();f.choose();await f.connect();const before=f.snapshot();
    f.context.templateDraws=[];
    vm.runInContext('pause();composition.draw=(...args)=>templateDraws.push(args);templatePreview.open(TEMPLATES[1]);',f.context);
    f.element('#templatePreviewMode').value='current';f.element('#templatePreviewMode').onchange({});
    assert.equal(f.context.templateDraws.length,2);
    f.element('#templateCurrentStyle').onclick({});assert.equal(f.context.templateDraws.length,3);
    assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.writes,[]);
    assert.equal(f.evaluate('persistence.restorePhase'),'failed');assert.equal(f.evaluate('sessionMedia.mediaReady()'),true);
    f.element('#applyTemplateStyle').onclick({});
    assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('state.templateId'),'punch');
    await vm.runInContext('saveProject(true);scheduleSave();',f.context);
    assert.deepEqual(f.writes,[]);assert.equal(f.evaluate('persistence.restorePhase'),'failed');
});
