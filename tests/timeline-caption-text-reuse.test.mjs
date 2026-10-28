import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {installClipTrackDom} from './fixtures/timeline-clip-dom.mjs';
import {validateProject} from '../dist/core/project.mjs';
import {initLocale,t} from '../dist/i18n.mjs';

// Actual app/API handlers with synthetic Text-child replacement, not browser timing.
test('edits, Undo/Redo and refreshes only replace changed caption text children',async()=>{
  try {
    for(const locale of ['ko','en','zh-CN']) {
      const f=await createAppFixture(),track=f.element('#captionTrack'),events=new Map();
      initLocale({languages:[locale]});
      const videoTrack=installClipTrackDom(f.element('#videoTrack'),f.doc,f.focusEvents);
      f.context.window.addEventListener=(name,handler)=>events.set(name,handler);
      f.context.rows=Array.from({length:30},(_,i)=>({start:i*3,end:i*3+2,text:`자막 ${i} 👩‍👩‍👧‍👦 中文`}));
      f.element('#sourceVideo').duration=90;
      vm.runInContext('state=initial();state.duration=90;state.clips=[{start:0,end:45},{start:45,end:90}];state.captions=rows;history=[];future=[];current=0;selected=0;timelineCache=null;bind();renderTimeline();renderInspector();',f.context);
      validateProject(f.evaluate('state'));assert.equal(track.children.length,30);
      const buttons=[...track.children],children=buttons.map(button=>button.firstChild);
      const same=()=>buttons.forEach((button,index)=>{
        assert.equal(track.children[index],button);assert.equal(button.firstChild,children[index]);
      });
      f.doc.activeElement=buttons[0];
      const changed=await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}});
      assert.equal(changed.ok,true);assert.equal(f.evaluate('state.effects.brightness'),1.1);
      assert.equal(f.evaluate('history.length'),1);same();assert.equal(f.doc.activeElement,buttons[0]);
      f.element('#undoButton').onclick();assert.equal(f.evaluate('state.effects.brightness'),1);
      assert.equal(f.evaluate('future.length'),1);same();
      f.element('#redoButton').onclick();assert.equal(f.evaluate('state.effects.brightness'),1.1);
      assert.equal(f.evaluate('future.length'),0);same();
      videoTrack.onclick({target:videoTrack.children[1],detail:0});
      assert.equal(f.evaluate('selected'),1);assert.equal(f.evaluate('current'),45);
      assert.equal(f.evaluate('history.length'),1);same();
      const edited=await f.context.window.moment.execute('captions.update',{captionIndex:29,patch:{text:'수정된 자막 🙂'}});
      assert.equal(edited.ok,true);assert.equal(f.evaluate('history.length'),2);
      assert.notEqual(buttons[29].firstChild,children[29]);children[29]=buttons[29].firstChild;same();
      assert.equal(buttons[29].textContent,'수정된 자막 🙂');
      assert.equal(buttons[29].attributes['aria-label'],t('shell.captionA11y',{index:30,seconds:'87.0',caption:'수정된 자막 🙂'}));
      f.element('#undoButton').onclick();assert.equal(buttons[29].textContent,'자막 29 👩‍👩‍👧‍👦 中文');
      assert.notEqual(buttons[29].firstChild,children[29]);children[29]=buttons[29].firstChild;same();
      f.element('#redoButton').onclick();assert.equal(buttons[29].textContent,'수정된 자막 🙂');
      assert.notEqual(buttons[29].firstChild,children[29]);children[29]=buttons[29].firstChild;same();
      const name=f.element('#projectName');name.value='작성 중';name.focus();name.setSelectionRange(1,3);
      const before=f.evaluate('({state,history,future,selected})');
      vm.runInContext('renderTimeline()',f.context);f.element('#timelineZoom').onclick();
      assert.equal(f.evaluate('timelineView.getZoom()'),2);same();
      const refusal=await f.context.window.moment.execute('effects.update',{patch:{brightness:1.2}});
      assert.equal(refusal.ok,false);assert.equal(refusal.error.code,'CONFLICT');same();
      f.element('#seek').oninput({target:{value:'3'}});assert.equal(f.evaluate('current'),3);same();
      f.element('#tracksArea').clientWidth=300;events.get('resize')();same();
      assert.deepEqual(f.evaluate('({state,history,future,selected})'),before);
      assert.equal(f.doc.activeElement,name);assert.equal(name.value,'작성 중');
      assert.equal(name.selectionStart,1);assert.equal(name.selectionEnd,3);
      initLocale({languages:[locale],document:{querySelectorAll:()=>track.children}});
      vm.runInContext('renderTimeline()',f.context);same();
      assert.equal(buttons[0].attributes['aria-label'],t('shell.captionA11y',{index:1,seconds:'0.0',caption:'자막 0 👩‍👩‍👧‍👦 中文'}));
    }
  } finally {initLocale();}
});
