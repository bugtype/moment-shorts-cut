import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {validateProject} from '../dist/core/project.mjs';
import {findCaption} from '../dist/captions.mjs';

// Actual transport/render owners with synthetic media clocks and recorder events.
// This verifies cut admission, not native decoding, encoded frames or A/V timing.
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
async function fixture({speed = .25, recording = false, clips = [{start:0,end:1},{start:5,end:6}], kind = 'video'} = {}) {
  const f = await createAppFixture(), recorders = [], draws = [], tracks = [];
  const track = () => { const value = {stops:0, clone:track, stop() {this.stops++;}}; tracks.push(value); return value; };
  const sourceTrack = track(), node = () => ({connect() {}, gain:{value:1}});
  f.context.AudioContext = class {
    constructor() {this.destination = {};}
    async resume() {}
    createMediaStreamDestination() {return {stream:{getAudioTracks:() => [sourceTrack]}};}
    createMediaElementSource() {return node();}
    createGain() {return node();}
  };
  const createElement = f.doc.createElement;
  f.doc.createElement = tag => {
    const element = createElement(tag);
    if (tag === 'canvas') element.captureStream = () => {
      const owned = [track()]; return {getTracks:() => owned, addTrack:value => owned.push(value)};
    };
    return element;
  };
  f.context.MediaRecorder = class {
    constructor(stream, options) {this.stream=stream;this.mimeType=options.mimeType;this.state='inactive';this.pauses=0;this.stops=0;recorders.push(this);}
    start() {this.state='recording';}
    pause() {this.pauses++;this.state='paused';}
    resume() {this.state='recording';}
    stop() {this.stops++;this.state='inactive';}
  };
  f.context.seedClips = clips;
  f.context.captureDraw = (context, width, height, project, media) => draws.push({
    source:media.sourceTime, timeline:media.timelineTime,
    caption:findCaption(project.captions, media.sourceTime, media.timelineTime)?.text ?? null,
  });
  vm.runInContext(`state.kind='${kind}';state.clips=seedClips;state.speed=${speed};
    state.captions=[{start:.985,end:1,text:'TAIL'},{start:5.985,end:6,text:'LAST TAIL'}];
    timelineCache=null;current=0;video.seeking=false;video.ended=false;
    video.play=async()=>{};seekVideo=async time=>{video.currentTime=time;};
    composition.draw=captureDraw;`, f.context);
  validateProject(f.evaluate('state'));
  if (recording) await vm.runInContext("startExport({mime:'video/webm',ext:'webm'},720)", f.context);
  else await vm.runInContext('play()', f.context);
  draws.length = 0;
  let now = 1000;
  return {...f, recorders, draws, tracks, sourceTrack,
    async tick(source, ended = false) {
      // Deliver one dequeued frame, as the browser does, with an observed media clock.
      const id = f.evaluate('frameHandle'), callback = f.pendingFrames.get(id);
      assert.equal(typeof callback, 'function'); f.pendingFrames.delete(id);
      vm.runInContext(`video.currentTime=${source};video.ended=${ended};`, f.context);
      callback(now); now += 100; await settle();
    },
    close() {vm.runInContext(recording ? 'stopExport(true)' : 'pause()', f.context);},
  };
}

for (const speed of [.25, 1, 4]) for (const recording of [false, true]) {
  test(`pre-end native observations retain the current clip and tail caption (speed ${speed}, recording ${recording})`, async () => {
    const f = await fixture({speed, recording}), before = f.evaluate('({state,history,future})');
    try {
      for (const source of [.986, .99, .9995]) {
        await f.tick(source);
        assert.equal(f.evaluate('current'), source);
        assert.equal(f.evaluate('locate(current).index'), 0);
        assert.equal(f.evaluate('video.currentTime'), source);
        assert.deepEqual(f.draws.at(-1), {source, timeline:source, caption:'TAIL'});
        assert.equal(f.evaluate('playing'), true);
        if (recording) {assert.equal(f.recorders[0].state,'recording');assert.equal(f.recorders[0].pauses,0);assert.equal(f.recorders[0].stops,0);}
      }
      await f.tick(1);
      assert.equal(f.evaluate('current'),1);assert.equal(f.evaluate('locate(current).index'),1);
      assert.equal(f.evaluate('video.currentTime'),5);
      if (recording) {assert.equal(f.recorders[0].pauses,1);assert.equal(f.recorders[0].state,'recording');}
      assert.deepEqual(f.evaluate('({state,history,future})'),before);
    } finally {f.close();}
  });
}

for (const recording of [false, true]) {
  test(`last clip retains its final fractional millisecond until the native endpoint (recording ${recording})`, async () => {
    const f = await fixture({recording, clips:[{start:0,end:1}]});
    try {
      await f.tick(.9995);
      assert.equal(f.evaluate('current'),.9995);assert.equal(f.evaluate('playing'),true);
      assert.equal(f.draws.at(-1).caption,'TAIL');
      if (recording) assert.equal(f.recorders[0].stops,0);
      await f.tick(1);
      assert.equal(f.evaluate('current'),1);assert.equal(f.evaluate('playing'),false);
      if (recording) assert.equal(f.recorders[0].stops,1);
      assert.equal(f.evaluate('frameHandle'),0);
    } finally {f.close();}
  });
  for (const observation of [{time:.99,ended:true},{time:1.04,ended:false}]) {
    test(`native end/overshoot still advances a cut (recording ${recording}, ${JSON.stringify(observation)})`, async () => {
      const f=await fixture({recording});
      try {
        await f.tick(observation.time, observation.ended);
        assert.equal(f.evaluate('current'),1);assert.equal(f.evaluate('video.currentTime'),5);
        assert.equal(f.evaluate('playing'),true);
        if(recording) assert.equal(f.recorders[0].state,'recording');
      } finally {f.close();}
    });
  }
}

test('demo completion waits for its clamped exact end instead of dropping the last fraction',async()=>{
  const f=await fixture({kind:'demo',clips:[{start:0,end:1}]});
  try {
    vm.runInContext('current=.9995;lastTick=100;tick(100)',f.context);
    assert.equal(f.evaluate('current'),.9995);assert.equal(f.evaluate('playing'),true);
    vm.runInContext('tick(200)',f.context);
    assert.equal(f.evaluate('current'),1);assert.equal(f.evaluate('playing'),false);
  } finally {f.close();}
});

for (const kind of ['demo', 'video']) test(`loop waits for the exact end before restarting ${kind}`, async () => {
  const f = await fixture({kind, clips:[{start:0,end:1}]});
  try {
    vm.runInContext('playback.setLoopPreview(true);current=.9995;lastTick=100;',f.context);
    if (kind === 'video') await f.tick(.9995);
    else vm.runInContext('tick(100)', f.context);
    assert.equal(f.evaluate('current'),.9995);assert.equal(f.evaluate('playing'),true);
    if (kind === 'video') await f.tick(1);
    else {vm.runInContext('tick(200)',f.context);await settle();}
    assert.equal(f.evaluate('current'),0);assert.equal(f.evaluate('playing'),true);
  } finally {f.close();}
});

for (const recording of [false, true]) test(`reordered fractional clips retain tails and complete (recording ${recording})`, async () => {
  const clips=[{start:5.1,end:5.2},{start:.1,end:.3},{start:2.1,end:2.5}];
  const f=await fixture({recording,clips});
  try {
    for (const [index, clip] of clips.entries()) {
      await f.tick(clip.end-.0005);
      assert.equal(f.evaluate('locate(current).index'),index);
      assert.equal(f.evaluate('playing'),true);
      if(recording) assert.equal(f.recorders[0].pauses,index);
      await f.tick(clip.end);
      if(index<clips.length-1) {
        assert.equal(f.evaluate('locate(current).index'),index+1);
        assert.equal(f.evaluate('video.currentTime'),clips[index+1].start);
      }
    }
    assert.equal(f.evaluate('current'),f.evaluate('duration()'));
    assert.equal(f.evaluate('playing'),false);
    if(recording) {assert.equal(f.recorders[0].pauses,2);assert.equal(f.recorders[0].stops,1);}
  } finally {f.close();}
});
