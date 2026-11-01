import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

// Native canvas failures, media and recording are simulated; app/composition owners are real.
async function fixture() {
  const f = await createAppFixture(), recorders = [], tracks = [], downloads = [], blobs = [], revoked = [], timers = [];
  let nextURL = 0;
  const track = () => {
    const value = { stops: 0, clone: track, stop() { this.stops++; } };
    tracks.push(value);
    return value;
  };
  const sourceTrack = track(), node = () => ({ connect() {}, gain: { value: 1 } });
  f.context.AudioContext = class {
    constructor() { this.destination = {}; }
    async resume() {}
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [sourceTrack] } }; }
    createMediaElementSource() { return node(); }
    createGain() { return node(); }
  };
  f.context.URL = {
    createObjectURL(blob) {
      blobs.push(blob);
      return `blob:download-${++nextURL}`;
    },
    revokeObjectURL: url => revoked.push(url),
  };
  f.context.setTimeout = (callback, delay) => { timers.push({ callback, delay }); };
  const createElement = f.doc.createElement;
  f.doc.createElement = tag => {
    const element = createElement(tag);
    if (tag === 'canvas') element.captureStream = () => {
      const owned = [track()];
      return { addTrack: value => owned.push(value), getTracks: () => owned };
    };
    if (tag === 'a') {
      element.click = () => {
        downloads.push({ url: element.href, name: element.download });
      };
      element.remove = () => {
        element.parentNode = null;
      };
    }
    return element;
  };
  f.doc.body.append = element => { element.parentNode = f.doc.body; };
  f.doc.body.removeChild = element => { element.parentNode = null; };
  f.element('#preview').captureStream = () => {};
  f.context.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor(stream, options) {
      this.stream = stream; this.mimeType = options.mimeType; this.state = 'inactive'; this.stops = 0;
      recorders.push(this);
    }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.stops++; }
  };
  return { ...f, recorders, tracks, sourceTrack, downloads, blobs, revoked, timers };
}

const snapshot = f => f.evaluate('({state,history,future})');
async function start(f) {
  vm.runInContext('exportDialog()', f.context);
  f.element('#exportFormat').value='0';f.element('#exportQuality').value='720';f.element('#exportIncludeAudio').checked=true;
  await f.element('#startExport').onclick(); return f.recorders.at(-1);
}
function frame(f, now=performance.now()+100) {
  const [id,callback]=f.pendingFrames.entries().next().value;f.pendingFrames.delete(id);callback(now);
}
function arm(f, reenter) {
  f.context.paintReentry=reenter;
  vm.runInContext(`sampleRaster={};sample.complete=true;
    globalThis.savedFailureComposition=composition.draw;globalThis.failNextPaint=true;
    composition.draw=(target,...args)=>savedFailureComposition(new Proxy(target,{
      get(object,key){if(key==='drawImage')return (...values)=>{
        if(failNextPaint){failNextPaint=false;paintReentry?.();throw new Error('Synthetic drawImage failure')}
        return object.drawImage(...values)
      };return object[key]}
    }),...args);`,f.context);
}
function unchanged(f,before,media) {
  assert.deepEqual(snapshot(f),before);
  const after=vm.runInContext('({video:sources.videoFile,audio:sources.audioFile})',f.context);
  assert.equal(after.video,media.video);assert.equal(after.audio,media.audio);
}
const sources=f=>vm.runInContext('({video:sources.videoFile,audio:sources.audioFile})',f.context);
function errorShown(f) { assert.equal(f.element('#toast').textContent,vm.runInContext("t('shell.playError')",f.context)); }

test('preview paint failure stops its loop without edits and ordinary Play explicitly retries',async()=>{
  const f=await fixture(),before=snapshot(f),media=sources(f);await vm.runInContext('play()',f.context);arm(f);
  assert.doesNotThrow(()=>frame(f));
  assert.equal(f.evaluate('playing'),false);assert.equal(f.evaluate('frameHandle'),0);assert.equal(f.pendingFrames.size,0);
  errorShown(f);unchanged(f,before,media);
  await vm.runInContext('play()',f.context);assert.equal(f.evaluate('playing'),true);assert.equal(f.pendingFrames.size,1);
  assert.doesNotThrow(()=>frame(f));assert.equal(f.pendingFrames.size,1);vm.runInContext('pause()',f.context);
});

for(const ending of [false,true])test(`export paint failure ${ending?'at end':'midway'} cancels instead of publishing a partial recording`,async()=>{
  const f=await fixture(),before=snapshot(f),media=sources(f),recorder=await start(f);
  const late={data:recorder.ondataavailable,stop:recorder.onstop,error:recorder.onerror};
  if(ending)vm.runInContext('current=duration()-.0001',f.context);
  arm(f);assert.doesNotThrow(()=>frame(f));
  assert.equal(f.evaluate('playing'),false);assert.equal(f.evaluate('exporting'),false);assert.equal(f.pendingFrames.size,0);
  assert.equal(recorder.state,'inactive');assert.equal(recorder.stops,1);
  assert.ok(recorder.stream.getTracks().every(t=>t.stops===1));assert.equal(f.sourceTrack.stops,0);
  assert.equal(f.evaluate('videoExport.recorder'),null);assert.equal(f.downloads.length,0);errorShown(f);unchanged(f,before,media);
  const fresh=await start(f),state=snapshot(f);late.data({data:new Blob(['old partial frame'])});late.stop();late.error();
  assert.equal(fresh.state,'recording');assert.equal(fresh.stops,0);assert.equal(f.downloads.length,0);assert.deepEqual(snapshot(f),state);
  vm.runInContext('stopExport(true)',f.context);
});

test('a replaced playback owner is not stopped or deprived of its new frame by an old paint failure',async()=>{
  for(const changeProject of [false,true]) {
    const f=await fixture();await vm.runInContext('play()',f.context);
    const before=snapshot(f);let newHandle;
    arm(f,()=>{
      // Synchronous injected reentry is an ownership stress test, not a native Canvas claim.
      vm.runInContext(`pause();${changeProject?'state=structuredClone(state);':''}playing=true;++playRequest;frameHandle=requestAnimationFrame(()=>{});`,f.context);
      newHandle=f.evaluate('frameHandle');
    });
    assert.doesNotThrow(()=>frame(f));
    assert.equal(f.evaluate('playing'),true);assert.equal(f.evaluate('frameHandle'),newHandle);
    assert.equal(f.pendingFrames.has(newHandle),true);assert.deepEqual(snapshot(f),before);
    assert.notEqual(f.element('#toast').textContent,vm.runInContext("t('shell.playError')",f.context));
    vm.runInContext('pause()',f.context);
  }
});

test('a new export generation survives a stale paint exception and keeps its resources',async()=>{
  const f=await fixture(),old=await start(f);let fresh,newHandle;
  arm(f,()=>{
    vm.runInContext(`stopExport(true);globalThis.replacementToken=videoExport.begin();exporting=true;videoExport.createSurface(state.ratio,720);
      globalThis.replacementRecorder=videoExport.capture(replacementToken,{mime:'video/webm'},720,playback.destination.stream,{onError(){},onStop(){}});
      replacementRecorder.start();playing=true;++playRequest;frameHandle=requestAnimationFrame(()=>{});`,f.context);
    fresh=f.recorders.at(-1);newHandle=f.evaluate('frameHandle');
  });
  assert.doesNotThrow(()=>frame(f));
  assert.equal(old.stops,1);assert.equal(fresh.state,'recording');assert.equal(fresh.stops,0);
  assert.equal(f.evaluate('exporting'),true);assert.equal(f.evaluate('playing'),true);
  assert.equal(f.evaluate('frameHandle'),newHandle);assert.equal(f.pendingFrames.has(newHandle),true);
  assert.ok(fresh.stream.getTracks().every(t=>t.stops===0));assert.equal(f.downloads.length,0);
  vm.runInContext('stopExport(true)',f.context);
});


for (const lease of ['generation', 'recorder']) test(`stale render ignores an isolated export ${lease} change with the same playback request`, async () => {
  const f = await fixture(), old = await start(f), before = snapshot(f);
  const request = f.evaluate('playRequest'), generation = f.evaluate('videoExport.request');
  let active, newHandle;
  arm(f, () => {
    // Controller-port stress only: native rendering is not claimed to replace leases synchronously.
    if (lease === 'generation') {
      vm.runInContext('videoExport.begin()', f.context);
      active = old;
    } else {
      // Retire the old synthetic capture before replacing only the recorder identity.
      old.ondataavailable = old.onstop = old.onerror = null;
      old.stop(); old.stream.getTracks().forEach(track => track.stop());
      vm.runInContext(`globalThis.isolatedRecorder=videoExport.capture(videoExport.request,{mime:'video/webm'},720,playback.destination.stream,{onError(){},onStop(){}});isolatedRecorder.start()`, f.context);
      active = f.recorders.at(-1);
    }
    vm.runInContext('frameHandle=requestAnimationFrame(()=>{})', f.context);
    newHandle = f.evaluate('frameHandle');
  });
  assert.doesNotThrow(() => frame(f));
  assert.equal(f.evaluate('playRequest'), request, 'playback guard alone cannot protect this owner');
  assert.equal(f.evaluate('videoExport.request') === generation, lease === 'recorder');
  assert.equal(active === old, lease === 'generation');
  assert.equal(active.state, 'recording'); assert.equal(active.stops, 0);
  assert.equal(f.evaluate('exporting'), true); assert.equal(f.evaluate('playing'), true);
  assert.equal(f.evaluate('frameHandle'), newHandle); assert.equal(f.pendingFrames.has(newHandle), true);
  assert.ok(active.stream.getTracks().every(track => track.stops === 0)); assert.equal(f.downloads.length, 0);
  assert.deepEqual(snapshot(f), before);
  assert.notEqual(f.element('#toast').textContent, vm.runInContext("t('shell.playError')", f.context));
  vm.runInContext('stopExport(true)', f.context);
  assert.equal(active.state, 'inactive'); assert.ok(active.stream.getTracks().every(track => track.stops === 1));
});
