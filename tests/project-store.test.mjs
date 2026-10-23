import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectStore} from '../dist/project-store.mjs';
import {createMediaStorageFixture} from './fixtures/media-storage.mjs';

test('a queued audio update repairs a failed video write before resolving',async()=>{
  for(const failureAt of ['failures','openFailures']){
    const f=createMediaStorageFixture([['video',{name:'old.mp4'}]]),store=createProjectStore(f.factory);
    f[failureAt].push(new Error('synthetic quota/open failure'));
    const video={name:'new.mp4'},audio={name:'voice.wav'};
    const first=assert.rejects(store.setMedia(video,null),/synthetic/);
    const latest=store.setMedia(video,audio);
    await first;await latest;
    assert.deepEqual(Object.fromEntries(f.records),{video,audio});
    const reloaded=createProjectStore(f.factory);
    assert.deepEqual(await reloaded.get('video'),video);assert.deepEqual(await reloaded.get('audio'),audio);
  }
});

test('queued identical requests retry a failed commit and latest failure still rejects',async()=>{
  const f=createMediaStorageFixture(),store=createProjectStore(f.factory),video={name:'new.mp4'};
  f.failures.push(new Error('first failed'));
  const first=assert.rejects(store.setMedia(video,null),/first failed/),latest=store.setMedia(video,null);
  await first;await latest;assert.deepEqual(f.records.get('video'),video);
  f.failures.push(new Error('latest failed'));
  await assert.rejects(store.setMedia({name:'replacement.mp4'},null),/latest failed/);
  assert.deepEqual(f.records.get('video'),video);
});

test('newer replacement/deletion wins after failure without resurrecting stale media',async()=>{
  const f=createMediaStorageFixture([['video',{name:'old.mp4'}],['audio',{name:'old.wav'}]]),store=createProjectStore(f.factory);
  f.failures.push(new Error('abort'));
  const first=assert.rejects(store.setMedia(null,null),/abort/);
  const latestAudio={name:'latest.wav'};const latest=store.setMedia(null,latestAudio);
  await first;await latest;assert.deepEqual(Object.fromEntries(f.records),{audio:latestAudio});
  f.failures.push(new Error('abort'));
  const stale=assert.rejects(store.setMedia({name:'stale.mp4'},latestAudio),/abort/);
  const video={name:'latest.mp4'},replacement=store.setMedia(video,null);
  await stale;await replacement;assert.deepEqual(Object.fromEntries(f.records),{video});
});

test('committed values avoid redundant large-media writes while queue order is retained',async()=>{
  const f=createMediaStorageFixture(),store=createProjectStore(f.factory),video={name:'large.mp4'};
  await store.setMedia(video,null);f.attempts.length=0;
  const firstAudio={name:'one.wav'},lastAudio={name:'two.wav'};
  await Promise.all([store.setMedia(video,firstAudio),store.setMedia(video,lastAudio),store.setMedia(video,lastAudio)]);
  assert.deepEqual(f.attempts,[[['audio',firstAudio]],[['audio',lastAudio]]]);
  assert.deepEqual(Object.fromEntries(f.records),{video,audio:lastAudio});
});

test('second-request enqueue failures abort earlier replacements/deletions and preserve the original error',async()=>{
  for(const deleteVideo of [false,true])for(const deleteAudio of [false,true]){
    const f=createMediaStorageFixture(),store=createProjectStore(f.factory);
    const oldVideo={name:'old.mp4'},oldAudio={name:'old.wav'};
    await store.setMedia(oldVideo,oldAudio);f.attempts.length=0;f.events.length=0;
    const video=deleteVideo?null:{name:'new.mp4'},audio=deleteAudio?null:{name:'new.wav'};
    const error=new DOMException('synthetic second-request failure','DataCloneError');
    f.enqueueFailures.push({key:'audio',error});
    await assert.rejects(store.setMedia(video,audio),actual=>actual===error);
    assert.deepEqual(f.events,['abort']);
    assert.deepEqual(f.attempts,[[['video',video]]],'Only the first request was queued');
    assert.deepEqual(Object.fromEntries(f.records),{video:oldVideo,audio:oldAudio});
    await store.setMedia(oldVideo,oldAudio);
    assert.equal(f.attempts.length,1,'Failure must not change the committed-value cache');
    await store.setMedia(video,audio);
    assert.deepEqual(f.attempts[1],[['video',video],['audio',audio]],'Retry must include both uncommitted changes');
    const expected={};if(video)expected.video=video;if(audio)expected.audio=audio;
    assert.deepEqual(Object.fromEntries(f.records),expected);
  }
});

test('a synchronous structured-clone error cannot partially commit queued media',async()=>{
  const oldVideo={name:'old.mp4'},f=createMediaStorageFixture([['video',oldVideo]]),store=createProjectStore(f.factory);
  const video={name:'new.mp4'},badAudio={name:'synthetic.wav',uncloneable(){}};
  const failed=assert.rejects(store.setMedia(video,badAudio),{name:'DataCloneError'});
  const audio={name:'valid.wav'},retry=store.setMedia(video,audio);
  await failed;await retry;
  assert.deepEqual(f.events,['abort','complete']);
  assert.deepEqual(Object.fromEntries(f.records),{video,audio});
});
