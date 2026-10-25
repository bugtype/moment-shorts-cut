import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoProject, projectSubtitles, createProjectDocument, readProjectDocument} from '../dist/core/project.mjs';
import {projectGraphicsText} from '../dist/core/graphics-text.mjs';
import {newCard} from '../dist/effects.mjs';
import {setLocale, translateFor} from '../dist/i18n.mjs';
import {createAppFixture} from './fixtures/app.mjs';

const formats = [{format:'srt'}, {format:'vtt'}, {format:'txt'}, {format:'txt',review:true}];
const invalid = error => error.code === 'INVALID_ARGUMENT' && error.messageKey === 'errors.textUnicode';
function project(text) {
  const p = createDemoProject();
  p.captions = [{start:0,end:1,text}];
  return p;
}

test('all emitted subtitle formats reject isolated surrogates, not valid Unicode; backups remain lossless', () => {
  for (const text of ['\ud800', '\udfff', 'before\ud800after', '\udc00\ud800']) {
    const p = project(text), before = structuredClone(p);
    assert.deepEqual(readProjectDocument(JSON.parse(JSON.stringify(createProjectDocument(p)))), p);
    for (const options of formats) assert.throws(() => projectSubtitles(p, options), invalid);
    assert.deepEqual(p, before);
  }
  const text = '한글 中文 😀 𐀀 e\u0301 \ufffd';
  for (const options of formats) {
    const output = projectSubtitles(project(text), options);
    assert.ok(output.includes(text));
    assert.equal(new TextDecoder().decode(new TextEncoder().encode(output)), output);
  }
});

test('only emitted cues and used review speaker labels block export; NUL remains the first text diagnostic', () => {
  const p = project('valid');
  p.captions.push({start:3,end:4,text:'\ud800'});
  p.clips = [{start:0,end:2}];
  p.speakerLabels = ['\ud800', 'unused\udfff'];
  p.design.title.lines[0] = '\ud800';
  for (const options of formats) assert.doesNotThrow(() => projectSubtitles(p, options));
  p.clips = [{start:0,end:12}];
  for (const options of formats) assert.doesNotThrow(() => projectSubtitles(p, {...options,captionIndex:0,count:1}));
  p.captions[0].speaker = '0';
  assert.throws(() => projectSubtitles(p, {format:'txt',review:true,captionIndex:0,count:1}), invalid);
  for (const format of ['srt','vtt','txt']) assert.doesNotThrow(() => projectSubtitles(p, {format,captionIndex:0,count:1}));
  for (const options of formats) {
    const bad = project('\ud800\0');
    assert.throws(() => projectSubtitles(bad, options), e => e.messageKey ===
      (options.review ? 'review.nul' : `errors.${options.format}Nul`));
  }
  const label = project('\ud800'); label.captions[0].speaker = '0'; label.speakerLabels[0] = '\0';
  assert.throws(() => projectSubtitles(label, {format:'txt',review:true}), e => e.messageKey === 'review.nul');
});

test('graphics rejects every emitted authored field without inspecting unrelated caption/media text', () => {
  const p = project('\ud800');p.fileName = '\udfff';p.name = '\ud800';
  p.overlays = [{...newCard(12),id:'card'}];
  assert.doesNotThrow(() => projectGraphicsText(p));
  const fields = [p => p.design.title.lines[0]='\ud800', p => p.design.title.lines[1]='\udfff',
    p => p.design.credit.text='\ud800', ...['label','text','detail'].map(key => p => p.overlays[0][key]='\ud800')];
  for (const change of fields) {
    const bad = structuredClone(p);change(bad);
    const before = structuredClone(bad);
    assert.throws(() => projectGraphicsText(bad), invalid);
    assert.deepEqual(bad,before);
  }
  p.design.title.lines[0]='\ud800\0';
  assert.throws(() => projectGraphicsText(p), e => e.messageKey==='errors.graphicsNul');
});

test('browser downloads reject before encoding with localized visible errors and no state/history changes', async () => {
  const f = await createAppFixture();f.context.downloads = [];
  f.evaluate("persistence.restorePhase='ready'; download=(blob,name)=>downloads.push({blob,name}); state.captions=[{start:0,end:1,text:'\\ud800'}]; true");
  const before=f.evaluate('JSON.stringify({state,history,future,current})');
  try {
    for (const locale of ['ko','en','zh-CN']) {
      setLocale(locale,{persist:false});
      for (const format of ['srt','vtt','txt','review-txt']) {
        f.context.format=format;f.evaluate('downloadSubtitles(format); true');
        assert.equal(f.element('#toast').getAttribute('data-i18n'),'errors.textUnicode');
        assert.equal(f.element('#toast').textContent,translateFor(locale,'errors.textUnicode'));
        assert.equal(f.context.downloads.length,0);
        assert.equal(f.evaluate('JSON.stringify({state,history,future,current})'),before);
      }
    }
    f.evaluate("state.captions[0].text='valid'; state.captions[0].speaker='0'; state.speakerLabels[0]='\\ud800'; downloadSubtitles('review-txt'); true");
    assert.equal(f.context.downloads.length,0);
    assert.equal(f.element('#toast').getAttribute('data-i18n'),'errors.textUnicode');
    f.evaluate("state.speakerLabels[0]='valid'; true");
    f.evaluate("state.captions[0].text='valid 😀 �'; downloadSubtitles('srt'); true");
    assert.equal(f.context.downloads.length,1);
    assert.ok((await f.context.downloads[0].blob.text()).includes('valid 😀 �'));
    f.evaluate("state.design.title.lines[0]='\\ud800'; downloadGraphicsText(); true");
    assert.equal(f.context.downloads.length,1);
    assert.equal(f.element('#toast').getAttribute('data-i18n'),'errors.textUnicode');
    f.evaluate('downloadProjectSettings(); true');
    assert.equal(f.context.downloads.length,2);
    const backup=JSON.parse(await f.context.downloads[1].blob.text());
    assert.equal(backup.project.design.title.lines[0],'\ud800');
  } finally {setLocale('ko',{persist:false});}
});
