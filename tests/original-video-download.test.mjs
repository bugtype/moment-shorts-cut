import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {setLocale,initLocale} from '../dist/i18n.mjs';

async function fixture(name='original.mp4',type='video/mp4') {
    const f=await createAppFixture(),downloads=[],writes=[];
    const file=new File([new Uint8Array([0,1,255,4])],name,{type});
    f.context.file=file;
    f.context.collect=(...args)=>downloads.push(args);
    f.context.localStorage.setItem=(...args)=>writes.push(args);
    vm.runInContext("state.kind='video';state.fileName=file.name;sources.videoFile=file;sources.sourceURL='blob:source';download=collect;switchPanel('media')",f.context);
    return {...f,file,downloads,writes,click:event=>f.element('#downloadOriginalVideo').onclick(event)};
}

test('video download passes exact connected File and filename without reading or editing',async()=>{
    for(const [name,type] of [['original.mp4','video/mp4'],['camera.webm','video/webm']]) {
        const f=await fixture(name,type),before=f.evaluate('({state,current,playing,history,future,url:sources.sourceURL})');
        f.file.arrayBuffer=()=>{throw Error('must not read')};
        vm.runInContext("pause=seekTo=draw=()=>{throw Error('must not touch playback')};persistMedia=()=>{throw Error('must not write media')}",f.context);
        f.click({});
        assert.equal(f.downloads[0][0],f.file);assert.equal(f.downloads[0][1],name);
        assert.equal(f.downloads[0][0].type,type);
        assert.deepEqual([...new Uint8Array(await Blob.prototype.arrayBuffer.call(f.downloads[0][0]))],[0,1,255,4]);
        assert.deepEqual(f.evaluate('({state,current,playing,history,future,url:sources.sourceURL})'),before);
        assert.deepEqual(f.writes,[]);
    }
});

test('demo or missing source omits action; replaced/disconnected/stale/busy controls cannot download',async()=>{
    for(const mutation of ["state.kind='demo'","sources.videoFile=null"]) {
        const f=await fixture();vm.runInContext(mutation+';renderPanel()',f.context);
        assert.doesNotMatch(f.element('#panelContent').innerHTML,/id="downloadOriginalVideo"/);
    }
    for(const mutation of ["state.kind='demo'","sources.videoFile=null","sources.videoFile={}","sources.sourceURL='blob:new'",
        "state=structuredClone(state)","switchPanel('audio')",'renderPanel()',"modal.open=true",'loadingMedia=true','exporting=true',
        'transcribing=true','editorReady=false',"persistence.restorePhase='failed';persistence.recoveryValid=true",
        "Object.defineProperty(audioRecording,'current',{value:{}})","Object.defineProperty(audioRecording,'requesting',{value:true})"]) {
        const f=await fixture(),old=f.element('#downloadOriginalVideo').onclick;
        vm.runInContext(mutation,f.context);old({});assert.equal(f.downloads.length,0,mutation);
    }
    const f=await fixture();f.click({isComposing:true});f.click({keyCode:229});
    f.element('#panelContent').oncompositionstart();f.click({});assert.equal(f.downloads.length,0);
    f.element('#panelContent').oncompositionend();f.click({});assert.equal(f.downloads.length,1);
});

test('download errors localize and allow retry without replacing source ownership',async()=>{
    try {
        for(const [locale,label,error] of [['ko','원본 영상 다운로드','다시 시도'],['en','Download original video','Try again'],['zh-CN','下载原始视频','请重试']]) {
            const f=await fixture();setLocale(locale,{persist:false});
            vm.runInContext("renderPanel();download=()=>{throw Error('blocked')}",f.context);
            assert.ok(f.element('#panelContent').innerHTML.includes(label));f.click({});
            assert.ok(f.element('#toast').textContent.includes(error));
            vm.runInContext('download=collect',f.context);f.click({});
            assert.equal(f.downloads[0][0],f.file);assert.deepEqual(f.writes,[]);
        }
    }finally{initLocale();}
});

function media(node={}) {
    const listeners=new Map();let src='';
    Object.assign(node,{duration:12,readyState:4,videoWidth:1920,videoHeight:1080,paused:true,
        addEventListener(type,callback){listeners.set(type,callback);},removeEventListener(type){listeners.delete(type);},
        getAttribute(name){return name==='src'?src:null;},removeAttribute(name){if(name==='src')src='';},load(){},pause(){this.paused=true;}});
    Object.defineProperties(node,{
        src:{configurable:true,get:()=>src,set:value=>{src=value;queueMicrotask(()=>listeners.get('loadeddata')?.());}},
        currentSrc:{configurable:true,get:()=>src},
    });
    return node;
}

test('verified session-relinked video can be downloaded while failed storage protections remain',async()=>{
    let url=0;const writes=[],downloads=[];
    const f=await createAppFixture({sessionMediaDependencies:{createVideo:()=>media(),createAudio:()=>media(),createURL:()=>`blob:relinked-${++url}`,revokeURL(){}}});
    media(f.element('#sourceVideo'));media(f.element('#sourceAudio'));
    const file=new File(['current connected source'],'original.mp4',{type:'video/mp4'});
    f.context.file=file;f.context.collect=(...args)=>downloads.push(args);
    f.context.localStorage.setItem=(...args)=>writes.push(args);
    f.context.writes=writes;
    vm.runInContext("state.kind='video';state.fileName='original.mp4';state.audioName='';persistence.restorePhase='failed';persistence.recoveryValid=true;projectStore.setMedia=(...args)=>writes.push(args);download=collect",f.context);
    assert.equal((await vm.runInContext('sessionMedia.connect({video:file},{confirmed:true})',f.context)).ok,true);
    const before=f.evaluate('({state,history,phase:persistence.restorePhase})');
    vm.runInContext("switchPanel('media')",f.context);f.element('#downloadOriginalVideo').onclick({});
    assert.equal(downloads[0][0],file);assert.equal(downloads[0][1],'original.mp4');
    await vm.runInContext('saveProject(true);scheduleSave()',f.context);
    assert.deepEqual(f.evaluate('({state,history,phase:persistence.restorePhase})'),before);
    assert.deepEqual(writes,[]);
});
