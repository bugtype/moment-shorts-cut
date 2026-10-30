import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';

async function fixture() {
  const f = await createAppFixture(), canvas = f.element('#preview');
  const events = f.elementEvents.get('#preview');
  assert.equal(events.get('contextrestored')?.size, 1, 'registered during initial app binding');
  assert.equal(events.has('contextlost'), false, 'native restoration is not cancelled');
  const restored = () => {
    for (const handler of events.get('contextrestored')) handler.call(canvas, {type:'contextrestored'});
  };
  const flush = now => {
    assert.equal(f.pendingFrames.size, 1);
    const [id, callback] = f.pendingFrames.entries().next().value;
    f.pendingFrames.delete(id);callback(now ?? performance.now());
  };
  return {...f, canvas, restored, flush};
}

test('restored paused preview schedules one current-state draw without remounting or editing', async () => {
  const f = await fixture(), paints = [];
  f.context.paints = paints;
  vm.runInContext(`history=[JSON.stringify(state)];future=[JSON.stringify(state)];
    globalThis.saves=0;scheduleSave=()=>saves++;
    app.composition.draw=(target,width,height,project,frame)=>paints.push({target,width,height,time:frame.time,brightness:project.effects.brightness});
    app.composition.clear=()=>{throw Error('unrelated cache clear')};`, f.context);
  const name = f.element('#projectName'), panel = f.element('#panelContent');
  name.value = 'unfinished title';name.focus();
  const html = panel.innerHTML;assert.ok(html.length > 0, 'actual visible panel markup');
  const before = f.evaluate('({state,history,future,current,selected,panel,playing,exporting})');
  f.restored();f.restored();
  assert.equal(f.pendingFrames.size, 1);assert.equal(paints.length, 0);
  vm.runInContext('current=2', f.context);
  f.flush();
  assert.equal(paints.length, 1);assert.equal(paints[0].target, f.context2d);
  assert.equal(paints[0].time, 2 / before.state.speed);
  assert.deepEqual([paints[0].width,paints[0].height], [f.canvas.width,f.canvas.height]);
  assert.equal(f.pendingFrames.size, 0, 'restoration does not add a perpetual loop');
  assert.deepEqual(f.evaluate('({state,history,future,current,selected,panel,playing,exporting})'), {...before,current:2});
  assert.equal(f.evaluate('saves'), 0);assert.equal(f.element('#projectName'), name);
  assert.equal(name.value, 'unfinished title');assert.equal(f.doc.activeElement, name);
  assert.equal(panel.innerHTML, html);
  vm.runInContext('requestDraw()', f.context);
  const handle = f.evaluate('paintHandle');f.restored();
  assert.equal(f.evaluate('paintHandle'), handle, 'an already pending draw is reused');f.flush();
});

test('restoration keeps existing playback cadence and export-surface routing', async () => {
  const f = await fixture(), paints = [], output = {}, surface = {width:720,height:1280}, options = {includeAudio:false};
  Object.assign(f.context, {paints,output,surface,options});
  vm.runInContext(`app.composition.draw=(target,width,height,project,frame,options)=>paints.push({target,width,height,options});
    globalThis.exportSurface=false;Object.defineProperties(videoExport, {
      context:{get:()=>exportSurface?output:null},canvas:{get:()=>surface},renderOptions:{get:()=>options}
    });stopExport=()=>{throw Error('unexpected recorder stop')};`, f.context);
  await vm.runInContext('play()', f.context);
  assert.equal(f.evaluate('playing'), true);
  const frame = f.evaluate('frameHandle');f.restored();
  assert.equal(f.evaluate('paintHandle'), 0);assert.equal(f.evaluate('frameHandle'), frame);
  assert.equal(paints.length, 0);f.flush(f.evaluate('lastTick') + 40);
  assert.equal(paints.length, 1);assert.equal(paints.at(-1).target, f.context2d);
  assert.equal(f.pendingFrames.size, 1, 'only the existing playback loop continues');
  vm.runInContext('pause();exporting=true', f.context);
  // Preparation without a surface still uses the main canvas; with a surface it
  // uses the unchanged export render path, not a new recorder/retry operation.
  f.restored();f.flush();assert.equal(paints.at(-1).target, f.context2d);
  vm.runInContext('exportSurface=true', f.context);
  f.restored();f.flush();assert.equal(paints.at(-1).target, output);
  assert.deepEqual([paints.at(-1).width,paints.at(-1).height], [720,1280]);
  assert.equal(paints.at(-1).options, options);
  vm.runInContext('playing=true', f.context);f.restored();assert.equal(f.pendingFrames.size, 0);
  vm.runInContext('playing=false;exporting=false;exportSurface=false', f.context);
  f.restored();f.flush();assert.equal(paints.at(-1).target, f.context2d);
  assert.equal(f.pendingFrames.size, 0);
});

test('restored repaint does not replace a pending Frame PNG snapshot or its download', async () => {
  const f = await fixture(), copies = [], downloads = [];
  Object.assign(f.context, {downloads});
  vm.runInContext('download=(blob,name)=>downloads.push({blob,name});panel="settings";renderPanel()', f.context);
  const originalCreate = f.doc.createElement;
  f.doc.createElement = tag => {
    assert.equal(tag, 'canvas');
    const copy = {getContext:()=>({drawImage:source=>{copy.source=source;}}),toBlob(callback){
      copy.callback=callback;copy.dimensions=[copy.width,copy.height];
    }};copies.push(copy);return copy;
  };
  const before = f.evaluate('({state,history,future,current})');
  f.element('#savePreviewPng').onclick();assert.equal(copies.length, 1);
  f.doc.createElement = originalCreate;
  f.restored();f.flush();
  const blob = new Blob(['owned snapshot'], {type:'image/png'});copies[0].callback(blob);
  assert.equal(downloads.length, 1);assert.equal(downloads[0].blob, blob);
  assert.equal(downloads[0].name, `${before.state.name}.preview-${f.canvas.width}x${f.canvas.height}.png`);
  assert.equal(copies[0].source, f.canvas);
  assert.deepEqual(copies[0].dimensions, [f.canvas.width,f.canvas.height]);
  assert.deepEqual([copies[0].width,copies[0].height], [0,0]);
  assert.deepEqual(f.evaluate('({state,history,future,current})'), before);
});
