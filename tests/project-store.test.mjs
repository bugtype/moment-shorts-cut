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
