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

test('unchanged caption text retains its sole Text child while geometry and localized names refresh', async () => {
  const {initLocale,t}=await import('../dist/i18n.mjs');
  const track=createTrack();
  const captions=['한국어 👩‍👩‍👧‍👦 e\u0301 中文', '<b>literal & "quoted"</b>', '첫 줄\r\n다음 줄'];
  const occurrences=captions.map((text,captionIndex)=>({captionIndex,clipIndex:0,start:captionIndex,end:captionIndex+1,text}));
  try {
    renderCaptionTrack(track,occurrences,6,1);
    const buttons=[...track.children], children=buttons.map(button=>button.firstChild);
    assert.ok(children.every(child=>child.nodeType===3));
    track.ownerDocument.activeElement=buttons[1];
    for(const locale of ['ko','en','zh-CN']) {
      initLocale({languages:[locale]});
      const shifted=occurrences.map(caption=>({...caption,start:caption.start+1,end:caption.end+2}));
      renderCaptionTrack(track,shifted,8,2);
      buttons.forEach((button,index)=>{
        assert.equal(track.children[index],button);assert.equal(button.firstChild,children[index]);
        assert.equal(button.childNodes.length,1);assert.equal(button.textContent,captions[index]);
        assert.equal(button.dataset.captionTime,String(index+1));
        assert.equal(button.style.left,`${(index+1)/8*100}%`);assert.equal(button.style.width,'25%');
        assert.equal(button.attributes['aria-label'],t('shell.captionA11y',{index:index+1,seconds:((index+1)/2).toFixed(1),caption:captions[index]}));
        assert.equal(button.attributes['data-i18n-aria-label'],'shell.captionA11y');
      });
      assert.equal(track.ownerDocument.activeElement,buttons[1]);
    }
    occurrences[1].text='새로운 본문 🙂';renderCaptionTrack(track,occurrences,6,1);
    assert.equal(buttons[0].firstChild,children[0]);assert.notEqual(buttons[1].firstChild,children[1]);
    assert.equal(buttons[1].textContent,'새로운 본문 🙂');assert.equal(buttons[2].firstChild,children[2]);
  } finally {initLocale();}
});

test('caption text still repairs empty, multiple and non-Text children rather than retaining matching aggregate text',()=>{
  const track=createTrack(),caption={captionIndex:0,clipIndex:0,start:0,end:1,text:'AB'};
  renderCaptionTrack(track,[caption],1,1);const button=track.children[0];
  for(const children of [[],[{nodeType:3,data:''}],[{nodeType:3,data:'A'},{nodeType:3,data:'B'}],
    [{nodeType:1,textContent:'AB'}],[{nodeType:8,data:'comment'},{nodeType:3,data:'AB'}],
    [{nodeType:3,data:'AB'},{nodeType:8,data:'comment'}],[{nodeType:8,data:'AB'}],
    [{nodeType:3,data:'different'}]]) {
    button.childNodes=children;renderCaptionTrack(track,[caption],1,1);
    assert.equal(track.children[0],button);assert.equal(button.childNodes.length,1);
    assert.equal(button.firstChild.nodeType,3);assert.equal(button.firstChild.data,'AB');
    assert.ok(!children.includes(button.firstChild));
  }
  button.childNodes=[{nodeType:3,data:''}];
  renderCaptionTrack(track,[{...caption,text:''}],1,1);
  assert.equal(button.firstChild,null);assert.deepEqual(button.childNodes,[]);assert.equal(button.textContent,'');
  renderCaptionTrack(track,[caption],1,1);assert.equal(button.firstChild.data,'AB');
});
