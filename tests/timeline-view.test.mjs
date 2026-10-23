import test from 'node:test';
import assert from 'node:assert/strict';
import { captionOccurrences } from '../dist/captions.mjs';
import { renderCaptionTrack, renderCaptionTrackError, updateTimelineMarkup } from '../dist/timeline-view.mjs';
import { createTrack } from './fixtures/timeline-dom.mjs';

test('caption edits preserve every occurrence button and refresh text, timing and accessible names',()=>{
  const track=createTrack(),clips=[{start:2,end:6},{start:2,end:6}];
  const captions=[{start:1,end:4,text:'same'},{start:4,end:6,text:'same'},
    {start:1,end:2,text:'narration',basis:'timeline'}];
  const render=()=>renderCaptionTrack(track,captionOccurrences(captions,clips),8,2);
  render();
  const original=new Map(track.children.map(node=>[node.dataset.captionKey,node]));
  captions[0].text='<b>literal & "quoted"</b>';
  captions[0].end=5;
  captions[1].start=4.5;
  render();
  for(const node of track.children)assert.equal(node,original.get(node.dataset.captionKey));
  const repeated=track.children.filter(node=>node.dataset.captionIndex==='0');
  assert.equal(repeated.length,2);
  assert.equal(repeated[1].dataset.captionTime,'4');
  assert.equal(repeated[1].style.width,'37.5%');
  assert.equal(repeated[1].textContent,'<b>literal & "quoted"</b>');
  assert.equal(repeated[1].attributes['aria-label'],'자막 1, 2.0초: <b>literal & "quoted"</b>');
  assert.equal(track.children.filter(node=>node.dataset.captionKey==='2:audio').length,1);
});

test('reordered and removed occurrences leave no stale buttons or row references',()=>{
  const track=createTrack();
  const first={captionIndex:0,clipIndex:0,start:0,end:1,text:'A'};
  const second={captionIndex:1,clipIndex:0,start:1,end:2,text:'B'};
  renderCaptionTrack(track,[first,second],3,1);
  const [a,b]=track.children;
  renderCaptionTrack(track,[{...second,start:0,end:1},{...first,start:2,end:3}],3,1);
  assert.deepEqual(track.children,[b,a]);
  assert.equal(a.dataset.captionTime,'2');
  renderCaptionTrack(track,[{...second,captionIndex:0}],3,1);
  assert.equal(track.children.length,1);
  assert.equal(track.children[0].dataset.captionIndex,'0');
  assert.equal(track.children[0].textContent,'B');
  renderCaptionTrack(track,[],3,1);
  assert.equal(track.children.length,0);
});

test('unchanged video/title markup does not remove its current interaction target',()=>{
  const track=createTrack();
  updateTimelineMarkup(track,'<button>A &amp; B</button>');
  updateTimelineMarkup(track,'<button>A &amp; B</button>');
  assert.equal(track.writes,1);
  updateTimelineMarkup(track,'<button>Changed</button>');
  assert.equal(track.writes,2);
});

test('limit error removes every stale target, preserves outside focus, and recovers the complete lane',()=>{
 const track=createTrack(),occurrences=captionOccurrences([{start:0,end:1,text:'A'}],[{start:0,end:1},{start:0,end:1}]);
 renderCaptionTrack(track,occurrences,2,1);
 const outside={};track.ownerDocument.activeElement=outside;
 renderCaptionTrackError(track,'limit');
 assert.equal(track.children.length,1);assert.equal(track.children[0].attributes.role,'status');
 assert.equal(track.children[0].dataset.captionIndex,undefined);
 assert.equal(track.ownerDocument.activeElement,outside);
 renderCaptionTrack(track,occurrences,2,1);
 assert.equal(track.children.length,2);assert.ok(track.children.every(node=>node.dataset.captionIndex==='0'));
 track.ownerDocument.activeElement=track.children[1];
 renderCaptionTrackError(track,'limit');
 assert.equal(track.ownerDocument.activeElement,track);assert.equal(track.attributes.tabindex,'-1');
 renderCaptionTrackError(track,'limit again');assert.equal(track.children.length,1);
 renderCaptionTrack(track,[],2,1);assert.equal(track.children.length,0);
});
