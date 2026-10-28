import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompositionRenderer} from '../dist/composition-renderer.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function setup({absent=false}={}){
  let epoch=0,count=0,notices=0,trigger;
  let fonts={ready:Promise.resolve(),status:'loaded'};
  const surfaces=[],uses=[],output=new Proxy({drawImage(surface){uses.push(surface.epoch);}}, {get:(target,key)=>target[key]||(()=>{})});
  const renderer=createCompositionRenderer(()=>{
    const surface={epoch:epoch,count:++count};surfaces.push(surface);
    surface.getContext=()=>new Proxy({}, {get(target,key){
      if(key in target)return target[key];
      if(key==='measureText')return text=>{if(trigger){const fn=trigger;trigger=null;fn();}return {width:String(text).length*10};};
      return ()=>{};
    }});return surface;
  },{getFonts:absent?undefined:()=>fonts,onFontsReady(){notices++;}});
  const project=createDemoProject();project.design.title.enabled=false;project.design.credit.enabled=false;
  project.captions=[{start:0,end:2,text:'나중에 읽는 글꼴'}];
  const media={ready:false,time:1,sourceTime:1,total:12,elapsed:1,remaining:11,progress:.1};
  const draw=()=>{uses.length=0;renderer.draw(output,540,960,project,media);assert.equal(uses.length,1);return uses[0];};
  const start=()=>{fonts.status='loading';let resolve,reject;const ready=new Promise((yes,no)=>{resolve=yes;reject=no;});fonts.ready=ready;return {ready,resolve,reject};};
  const finish=cycle=>{epoch++;fonts.status='loaded';cycle.resolve();};
  return {get fonts(){return fonts;},replaceFonts:value=>{fonts=value;},draw,start,finish,renderer,project,output,media,setTrigger:fn=>trigger=fn,epoch:()=>epoch,counts:()=>({surfaces:count,notices})};
}
// Synthetic font epochs and canvas commands; no native-font or pixel claim.

test('steady cache and one pending cycle', async () => {
  const f=setup();assert.equal(f.draw(),0);await settle();assert.equal(f.counts().notices,0);
  for(let i=0;i<100;i++)f.draw();assert.deepEqual(f.counts(),{surfaces:1,notices:0});
  const cycle=f.start();assert.equal(f.draw(),0);f.finish(cycle);await settle();assert.equal(f.counts().notices,1);assert.equal(f.draw(),1);
  for(let i=0;i<100;i++)f.draw();assert.deepEqual(f.counts(),{surfaces:3,notices:1});

});

test('export await registered before observer', async () => {
  const f=setup();f.draw();const cycle=f.start();let exportEpoch;
  const exported=(async()=>{await cycle.ready;exportEpoch=f.draw();})();
  f.draw();f.finish(cycle);await exported;await settle();assert.equal(exportEpoch,1);assert.equal(f.counts().notices,1);

});

test('load started by measurement observed after draw', async () => {
  const f=setup();f.draw();let cycle;
  f.project.captions[0].text+=' 새 글자';f.setTrigger(()=>{cycle=f.start();});f.draw();assert.ok(cycle);
  f.finish(cycle);await settle();assert.equal(f.counts().notices,1);assert.equal(f.draw(),1);

});

test('superseded old promise and rapid next cycle', async () => {
  const f=setup();f.draw();const a=f.start();f.draw();const b=f.start();f.draw();
  a.resolve();await settle();assert.equal(f.counts().notices,0);f.finish(b);await settle();assert.equal(f.counts().notices,1);assert.equal(f.draw(),1);
  const c=f.start();f.draw();f.finish(c);await settle();assert.equal(f.counts().notices,2);assert.equal(f.draw(),2);

});

test('no font api and idempotent clear', async () => {
  const f=setup({absent:true});f.draw();f.draw();await settle();assert.deepEqual(f.counts(),{surfaces:1,notices:0});
  f.renderer.clear();f.renderer.clear();f.draw();assert.equal(f.counts().surfaces,2);
});

test('rejection new cycle retry getterfailure and primary draw error', async () => {
  const f=setup();f.draw();const cycle=f.start();f.draw();cycle.reject(Error('synthetic failure'));await settle();assert.equal(f.counts().notices,0);
  const retry=f.start();f.draw();f.finish(retry);await settle();assert.equal(f.draw(),1);
  Object.defineProperty(f.fonts,'ready',{get(){throw Error('unavailable');}});f.draw();
  const original=new Error('primary canvas error');f.output.drawImage=()=>{throw original;};assert.throws(()=>f.draw(),error=>error===original);

});

test('initial pending one subscription manual clear and unseen completed cycle', async () => {
  const f=setup();const cycle=f.start();let subscriptions=0;const then=cycle.ready.then.bind(cycle.ready);
  cycle.ready.then=(...args)=>{subscriptions++;return then(...args);};
  f.draw();for(let i=0;i<100;i++)f.draw();assert.equal(subscriptions,1);
  f.renderer.clear();f.renderer.clear();f.draw();assert.equal(subscriptions,1);
  f.finish(cycle);await settle();assert.equal(f.draw(),1);assert.equal(f.counts().notices,1);
  const unseen=f.start();f.finish(unseen);await settle();assert.equal(f.draw(),2);await settle();assert.equal(f.counts().notices,2);

});

test('post draw observation also preserves throwing paint and retry', async () => {
  const f=setup();f.draw();let cycle;f.project.captions[0].text+=' 오류';f.setTrigger(()=>{cycle=f.start();});
  const primary=Error('draw failed after font loading started'),drawImage=f.output.drawImage;
  f.output.drawImage=()=>{throw primary;};assert.throws(()=>f.draw(),error=>error===primary);assert.ok(cycle);
  f.finish(cycle);await settle();f.output.drawImage=drawImage;assert.equal(f.draw(),1);assert.equal(f.counts().notices,1);

});

test('replacement fontset notifies main once and retains steady reuse', async () => {
  const f=setup();f.draw();f.replaceFonts({ready:Promise.resolve(),status:'loaded'});f.draw();await settle();
  assert.deepEqual(f.counts(),{surfaces:2,notices:1});for(let i=0;i<100;i++)f.draw();assert.deepEqual(f.counts(),{surfaces:2,notices:1});

});

for (const callbackMode of ['throw','reenter']) test(`font completion callback ${callbackMode} stays bounded`, async () => {
  let notices=0, allocations=0, release;
  const fonts={status:'loaded',ready:Promise.resolve()};
  const context=new Proxy({}, {get:(t,k)=>k in t?t[k]:()=>{}});
  const project=createDemoProject();
  project.design.title.enabled=project.design.credit.enabled=false;
  project.captions=[{start:0,end:2,text:'나중에'}];
  const media={ready:false,time:1,sourceTime:1,total:12,elapsed:1,remaining:11,progress:.1};
  const renderer=createCompositionRenderer(()=>{
    allocations++;
    return {getContext:()=>new Proxy({}, {get:(t,k)=>k in t?t[k]:k==='measureText'?text=>({width:text.length*10}):()=>{}})};
  },{getFonts:()=>fonts,onFontsReady(){
    notices++;
    if(callbackMode==='throw') throw Error('secondary repaint failure');
    renderer.draw(context,540,960,project,media);
  }});
  const draw=()=>renderer.draw(context,540,960,project,media);
  draw();
  fonts.status='loading';fonts.ready=new Promise(resolve=>{release=resolve;});draw();
  fonts.status='loaded';release();
  for(let i=0;i<5;i++)await Promise.resolve();
  draw();
  assert.equal(notices,1);assert.equal(allocations,3);
  for(let i=0;i<5;i++)draw();
  assert.equal(notices,1);assert.equal(allocations,3);
});
