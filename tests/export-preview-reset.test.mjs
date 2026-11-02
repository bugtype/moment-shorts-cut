import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';

// Real app/composition/export owners; Canvas bitmap content is a routing marker,
// not native pixels, and recording/PNG bytes are synthetic.
async function fixture() {
  const f=await createAppFixture({beforeInit({element}) {
    const preview=element('#preview'),original=preview.getContext();
    preview.getContext=()=>preview.context ||= new Proxy({}, {get:(target,key)=>key in target?target[key]:original[key]});
  }}), recorders=[],tracks=[],downloads=[],writes=[],paints=[];
  const preview=f.element('#preview'), originalCreate=f.doc.createElement;
  const track=()=>{const t={stops:0,clone:track,stop(){this.stops++}};tracks.push(t);return t;};
  const sourceTrack=track(),node=()=>({connect(){},gain:{value:1}});
  f.context.AudioContext=class {
    constructor(){this.destination={};}
    async resume(){}
    createMediaStreamDestination(){return {stream:{getAudioTracks:()=>[sourceTrack]}};}
    createMediaElementSource(){return node();}
    createGain(){return node();}
  };
  f.doc.createElement=tag=>{
    const e=originalCreate(tag);
    if(tag==='canvas')e.captureStream=()=>{const owned=[track()];return {addTrack:t=>owned.push(t),getTracks:()=>owned};};
    return e;
  };
  f.context.MediaRecorder=class {
    static isTypeSupported(){return true;}
    constructor(stream,options){this.stream=stream;this.mimeType=options.mimeType;this.state='inactive';this.stops=0;recorders.push(this);}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.stops++;}
  };
  preview.captureStream=()=>{};
  Object.assign(f.context,{paints,publish:(blob,name)=>downloads.push({blob,name}),recordWrite:(...args)=>writes.push(args)});
  f.context.localStorage.setItem=f.context.recordWrite;
  vm.runInContext(`
    state.design.title.enabled=false;state.design.credit.enabled=false;state.overlays=[];
    state.captions=[{start:0,end:12,text:'VISIBLE CAPTION'}];current=0;
    download=publish;projectStore.setMedia=recordWrite;
    const originalComposition=composition.draw;
    composition.draw=(target,w,h,p,media,options)=>{
      originalComposition(target,w,h,p,media,options);
      const marker={includeCaptions:options?.includeCaptions!==false,hasAuthoredCaptions:p.captions.length>0};
      if(target===ctx)canvas.marker=marker;
      else if(target===videoExport.context)videoExport.canvas.marker=marker;
      paints.push({preview:target===ctx,...marker});
    };
    const originalCopy=ctx.drawImage;
    ctx.drawImage=(source,...args)=>{
      originalCopy.call(ctx,source,...args);
      if(source===videoExport.canvas)canvas.marker=source.marker;
    };
    draw();
  `,f.context);
  for(const [id,callback] of [...f.pendingFrames]){f.pendingFrames.delete(id);callback(0);}
  return {...f,preview,recorders,tracks,sourceTrack,downloads,writes,paints};
}
const snapshot=f=>f.evaluate('({state,history,future,current,selected,panel})');
async function start(f,includeCaptions=false) {
  vm.runInContext('exportDialog()',f.context);
  f.element('#exportFormat').value='0';f.element('#exportQuality').value='720';
  f.element('#exportIncludeCaptions').checked=includeCaptions;
  await f.element('#startExport').onclick();
  const recorder=f.recorders.at(-1);
  assert.equal(recorder.state,'recording');
  assert.equal(f.preview.marker.includeCaptions,includeCaptions);
  return {recorder,data:recorder.ondataavailable,stop:recorder.onstop,error:recorder.onerror,cancel:f.element('#cancelRunningExport').onclick};
}
function finish(f,active,outcome) {
  if(outcome==='cancel')active.cancel();
  else if(outcome==='error')active.error();
  else {
    if(outcome!=='empty')active.data({data:new Blob(['synthetic video'])});
    vm.runInContext('stopExport(false)',f.context);active.stop();
  }
}
function released(f,active) {
  assert.equal(f.evaluate('exporting'),false);assert.equal(f.evaluate('playing'),false);
  assert.equal(f.evaluate('videoExport.canvas'),null);assert.equal(f.evaluate('videoExport.recorder'),null);
  assert.equal(active.recorder.stops,1);assert.ok(active.recorder.stream.getTracks().every(t=>t.stops===1));
  assert.equal(f.sourceTrack.stops,0);assert.equal(f.pendingFrames.size,0);assert.equal(f.writes.length,0);
}
for(const outcome of ['cancel','complete','error','empty']) test(`${outcome} restores ordinary preview immediately after captionless capture`,async()=>{
  const f=await fixture(),before=snapshot(f),active=await start(f),count=f.paints.length;
  finish(f,active,outcome);released(f,active);
  assert.equal(f.paints.length,count+1);assert.equal(f.paints.at(-1).preview,true);
  assert.equal(f.preview.marker.includeCaptions,true);assert.deepEqual(snapshot(f),before);
  assert.equal(f.downloads.length,outcome==='complete'?1:0);
  if(outcome==='complete')f.element('#exportDone').onclick();
  assert.equal(f.evaluate('modal.open'),false);
});

test('Frame PNG immediately after cancel copies the restored ordinary preview without extra drawing',async()=>{
  const f=await fixture();vm.runInContext('panel="settings";renderPanel()',f.context);
  const active=await start(f);finish(f,active,'cancel');
  const count=f.paints.length,before=snapshot(f),copies=[];
  f.doc.createElement=tag=>{
    assert.equal(tag,'canvas');const copy={getContext:()=>({drawImage:source=>{copy.marker={...source.marker}}}),toBlob(callback){
      copy.encoded={...copy.marker};callback(new Blob(['synthetic PNG'],{type:'image/png'}));
    }};copies.push(copy);return copy;
  };
  f.element('#savePreviewPng').onclick();
  assert.equal(copies.length,1);assert.equal(copies[0].encoded.includeCaptions,true);
  assert.equal(f.paints.length,count);assert.equal(f.downloads.length,1);assert.match(f.downloads[0].name,/\.preview-.*\.png$/);
  assert.deepEqual(snapshot(f),before);assert.equal(f.writes.length,0);
});

test('empty caption projects stay empty and included exports need no reset paint',async()=>{
  for(const includeCaptions of [true,false]){
    const f=await fixture();vm.runInContext('state.captions=[];draw()',f.context);
    const before=snapshot(f),active=await start(f,includeCaptions),count=f.paints.length;
    finish(f,active,'cancel');released(f,active);
    assert.equal(f.paints.length,count+(includeCaptions?0:1));
    assert.equal(f.preview.marker.hasAuthoredCaptions,false);assert.deepEqual(snapshot(f),before);
  }
});

test('retained old callbacks and cleanup cannot repaint or stop a replacement export',async()=>{
  const f=await fixture(),old=await start(f),token=f.evaluate('videoExport.request');
  finish(f,old,'cancel');const fresh=await start(f),count=f.paints.length,before=snapshot(f);
  old.cancel();old.error();old.stop();old.data({data:new Blob(['obsolete'])});
  vm.runInContext(`exportFlow.cleanupExport(${token})`,f.context);
  assert.equal(f.paints.length,count);assert.equal(f.preview.marker.includeCaptions,false);
  assert.equal(f.evaluate('exporting'),true);assert.equal(fresh.recorder.stops,0);
  assert.equal(f.downloads.length,0);assert.deepEqual(snapshot(f),before);
  finish(f,fresh,'cancel');released(f,fresh);
});

for(const outcome of ['cancel','complete','error']) test(`preview repaint failure does not mask ${outcome} or leak resources`,async()=>{
  const f=await fixture(),active=await start(f),before=snapshot(f);
  vm.runInContext('draw=()=>{throw new Error("preview canvas unavailable")}',f.context);
  assert.doesNotThrow(()=>finish(f,active,outcome));released(f,active);
  assert.equal(f.downloads.length,outcome==='complete'?1:0);assert.deepEqual(snapshot(f),before);
  if(outcome==='complete')assert.match(f.element('#modal').innerHTML,/shell.exportDone/);
  else assert.equal(f.element('#toast').textContent,vm.runInContext(`t('shell.${outcome==='cancel'?'exportCancelled':'exportError'}')`,f.context));
});


test('natural video endpoint and final recorder events restore preview before returning to the editor',async()=>{
  const f=await fixture();
  vm.runInContext("state.kind='video';sources.videoFile={name:'video.mp4'};state.captions[0].end=13",f.context);
  const active=await start(f);
  vm.runInContext('video.currentTime=12',f.context);
  for(const [id,callback] of [...f.pendingFrames]){f.pendingFrames.delete(id);callback(f.evaluate('lastTick')+40);}
  assert.equal(f.evaluate('current'),12);assert.equal(f.evaluate('playing'),false);assert.equal(active.recorder.stops,1);
  const before=snapshot(f),count=f.paints.length;
  active.data({data:new Blob(['synthetic completed video'])});active.stop();
  released(f,active);assert.equal(f.paints.length,count+1);assert.equal(f.preview.marker.includeCaptions,true);
  assert.equal(f.downloads.length,1);f.element('#exportDone').onclick();
  assert.equal(f.evaluate('modal.open'),false);assert.deepEqual(snapshot(f),before);
});
