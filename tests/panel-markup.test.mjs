import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProject } from '../dist/core/project.mjs';
import { captionsPanelMarkup, mediaPanelMarkup, audioPanelMarkup, settingsPanelMarkup } from '../dist/panel-markup.mjs';
import { icon, esc, fmt } from '../dist/ui-format.mjs';

function frozenProject() {
  const state = createDemoProject();
  state.captions = [
    { start: 1.25, end: 3.5, text: ' <tag>\n& "한글👨‍👩‍👧" ', keywords: '"&', speaker: 0 },
    { start: 0, end: 2, text: 'é', basis: 'timeline', timing: 'estimated' },
  ];
  state.speakerLabels = ['<화자>'];
  state.fileName = '<video>&.mp4';
  state.audioName = '<voice>&.wav';
  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  return freeze(state);
}

test('caption markup preserves text whitespace, escaping, indices and accessible controls', () => {
  const state = frozenProject();
  const html = captionsPanelMarkup(state, { toolsOpen: true, transcribing: false, hasAudio: false, transcriptionStatus: '<status>' });
  assert.ok(html.includes(`<textarea data-caption-text="0" aria-label="자막 1 내용">${esc(state.captions[0].text)}</textarea>`));
  assert.match(html, /value="1.3" data-caption-start="0"/);
  assert.match(html, /data-caption-end="1" aria-label="자막 2 끝 초"/);
  assert.match(html, /value="0" selected>&lt;화자&gt;/);
  assert.match(html, /value="audio" disabled/);
  assert.match(html, /id="captionTools" open/);
  assert.match(html, /class="estimated-timing"/);
  assert.match(html, /role="status" aria-live="polite" hidden>&lt;status&gt;/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('caption disclosure reflects empty, working and idle state without retaining old input', () => {
  const state = frozenProject();
  const render = (captions, transcribing) => captionsPanelMarkup({ ...state, captions }, {
    toolsOpen: false, transcribing, hasAudio: true, transcriptionStatus: '인식 중',
  });
  assert.match(render([], false), /id="captionCreate" open/);
  assert.match(render(state.captions, true), /id="captionCreate" open/);
  assert.match(render(state.captions, true), /인식 중 · 취소/);
  assert.match(render(state.captions, false), /id="captionCreate" >/);
  assert.match(render(state.captions, false), /value="audio" >/);
  assert.doesNotMatch(render([], false), /data-caption-text=/);
});

test('media, audio and settings markup retain current values and do not mutate frozen input', () => {
  const state = frozenProject();
  assert.match(mediaPanelMarkup(state, ''), /src="\.\/sample.svg"/);
  assert.match(mediaPanelMarkup(state, ''), /&lt;video&gt;&amp;\.mp4/);
  assert.match(mediaPanelMarkup({ ...state, kind: 'video' }, 'blob:fixture'), /src="blob:fixture" alt="업로드한 영상 썸네일"/);
  assert.doesNotMatch(audioPanelMarkup(state, false, 20), /id="audioOffset"/);
  const audio = audioPanelMarkup({ ...state, speed: 2, audioOffset: 3, audioVolume: 0.41 }, true, 20);
  assert.match(audio, /&lt;voice&gt;&amp;\.wav/);
  assert.match(audio, /max="10" step="0.1" value="1.5"/);
  assert.match(audio, /id="audioVolumeOutput">41%/);
  const settings = settingsPanelMarkup({ ...state, ratio: '1:1', fit: 'contain', zoom: 1.5 }, { start: 2.25, end: 7.75 });
  assert.match(settings, /class="ratio-option active" data-ratio="1:1"/);
  assert.match(settings, /data-fit="contain" class="active"/);
  assert.match(settings, /id="mobileZoom"[^>]*value="1.5"/);
  assert.match(settings, /id="panelTrimStart"[^>]*value="2.25"/);
  assert.match(settings, /id="panelTrimEnd"[^>]*value="7.75"/);
});

test('shared display helpers preserve escaping, clock formatting and decorative icon fallback', () => {
  assert.equal(esc('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(esc(null), 'null');
  assert.equal(fmt(61.9), '01:01');
  assert.equal(fmt(-5), '00:00');
  assert.equal(fmt('invalid'), '00:00');
  assert.equal(icon('unknown'), icon('plus'));
  assert.match(icon('trash'), /aria-hidden="true"/);
});
