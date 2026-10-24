import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {setLocale,initLocale} from '../dist/i18n.mjs';

async function fixture(type='audio/webm',name='내 목소리.webm') {
    const f=await createAppFixture(), file=new File(['original\0bytes'],name,{type}),downloads=[],writes=[];
    f.context.originalAudio=file;f.context.collect=(...args)=>downloads.push(args);
    f.context.localStorage.setItem=(...args)=>writes.push(args);
    vm.runInContext("state=initial();sources.audioFile=originalAudio;state.audioName=originalAudio.name;sources.audioURL='blob:original';download=collect;switchPanel('audio');",f.context);
    return {...f,file,downloads,writes,click:event=>f.element('#downloadOriginalAudio').onclick(event)};
}

test('original audio downloads same File/name/bytes without reading, encoding or changing project/playback',async()=>{
    for(const [type,name] of [['audio/webm','내 목소리.webm'],['audio/mp4','내 목소리.m4a'],['audio/wav','voice.wav']]){
        const f=await fixture(type,name),before=f.evaluate('({state,history,future,current,playing,muted,url:sources.audioURL})');
        const bytes=await f.file.text();f.file.arrayBuffer=()=>{throw new Error('must not read');};
        f.file.stream=()=>{throw new Error('must not stream');};
        f.click({});assert.equal(f.downloads.length,1);assert.equal(f.downloads[0][0],f.file);assert.equal(f.downloads[0][1],name);
        assert.equal(f.downloads[0][0].type,type);assert.equal(await f.downloads[0][0].text(),bytes);
        assert.deepEqual(f.evaluate('({state,history,future,current,playing,muted,url:sources.audioURL})'),before);assert.deepEqual(f.writes,[]);
    }
});

test('detached, replaced, disconnected, busy, modal and composing audio actions are inert',async()=>{
    for(const change of ["sources.audioFile=null","sources.audioFile={name:'replacement.wav'}","sources.audioURL='blob:new'","state=initial()","switchPanel('media')","renderPanel()","modal.open=true","loadingMedia=true","exporting=true","transcribing=true","Object.defineProperty(audioRecording,'current',{get:()=>({})})","Object.defineProperty(audioRecording,'requesting',{get:()=>true})","persistence.restorePhase='failed';persistence.recoveryValid=false"]){
        const f=await fixture(),old=f.element('#downloadOriginalAudio').onclick;
        vm.runInContext(change,f.context);old({});assert.equal(f.downloads.length,0,change);
    }
    const f=await fixture();f.click({isComposing:true});f.click({keyCode:229});
    f.element('#panelContent').oncompositionstart();f.click({});assert.equal(f.downloads.length,0);
    f.element('#panelContent').oncompositionend();f.click({});assert.equal(f.downloads.length,1);
});

test('download failures localize and retry without altering the File',async()=>{
    try {for(const [locale,label,error] of [['ko','원본 오디오 다운로드','다시 시도'],['en','Download original audio','Try again'],['zh-CN','下载原始音频','请重试']]){
        const f=await fixture();setLocale(locale,{persist:false});vm.runInContext('renderPanel();download=()=>{throw new Error("blocked")};',f.context);
        assert.ok(f.element('#panelContent').innerHTML.includes(label));f.click({});assert.ok(f.element('#toast').textContent.includes(error));
        assert.deepEqual(f.writes,[]);vm.runInContext('download=collect;',f.context);f.click({});assert.equal(f.downloads[0][0],f.file);
    }}finally{initLocale();}
});
