import { activeSceneLayers } from './effects.mjs';
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function mountDesignPanel(root, api) {
  const { state, layer, total } = api;
  const d = state.design;
  const timed=activeSceneLayers(state,api.time||0).find(card=>(card.role||'headline')==='headline');
  const check = (label, path, value) => `<label class="design-check"><input type="checkbox" data-design="${path}" ${value ? 'checked' : ''}>${label}</label>`;
  const range = (label, path, value, min, max, step = 1, unit = '') => `<label class="design-range"><span>${label}<output data-output="${path}">${value}${unit}</output></span><input type="range" data-design="${path}" value="${value}" min="${min}" max="${max}" step="${step}" aria-label="${label}" data-unit="${unit}"></label>`;
  const color = (label, path, value) => `<label class="design-color"><span>${label}</span><input type="color" data-design="${path}" value="${value}" aria-label="${label}"></label>`;
  const timing = target => `<div class="design-divider"></div><span class="field-label">표시 구간 · 출력 영상 기준 초</span><div class="time-fields"><label>시작<input type="number" data-design="design.${target}.start" min="0" max="${total}" step=".1" value="${d[target].start}"></label><label>끝<input type="number" data-design="design.${target}.end" min="0" max="${total}" step=".1" value="${d[target].end ?? ''}" placeholder="영상 끝까지"></label></div><p class="tiny-note">끝을 비워두면 영상 끝까지 표시합니다. 편집 길이·배속 변경 시 구간도 비례 조절됩니다.</p>`;
  let controls = '';
  if (layer === 'title') controls = `
    ${timed?'<div class="notice">지금은 구간별 타이틀이 표시됩니다. 기본 제목은 해당 구간 밖에서 표시됩니다.<button class="text-button" id="editTimedTitle">현재 타이틀 수정 →</button></div>':''}
    ${check('상단 타이틀 표시', 'design.title.enabled', d.title.enabled)}
    <label class="panel-label" for="titleFirst">타이틀 첫 줄</label><input class="panel-input" id="titleFirst" data-design="design.title.lines.0" value="${escape(d.title.lines[0])}" maxlength="60" placeholder="시선을 붙잡는 한 문장">
    <label class="panel-label" for="titleSecond">강조할 두 번째 줄</label><input class="panel-input" id="titleSecond" data-design="design.title.lines.1" value="${escape(d.title.lines[1])}" maxlength="60" placeholder="궁금해지는 다음 이야기">
    <div class="design-colors">${color('첫 줄', 'design.title.colors.0', d.title.colors[0])}${color('강조 줄', 'design.title.colors.1', d.title.colors[1])}</div>
    ${range('글자 크기', 'design.title.size', d.title.size, 20, 64)}
    ${range('검은 테두리', 'design.title.stroke', d.title.stroke, 0, 10)}
    ${check('굵은 기울임', 'design.title.italic', d.title.italic)}
    ${range('가로 위치', 'design.title.x', Math.round(d.title.x * 100), 10, 90, 1, '%')}
    ${range('세로 위치', 'design.title.y', Math.round(d.title.y * 100), 6, 90, 1, '%')}
    ${timing('title')}`;
  if (layer === 'caption') controls = `
    <p class="layer-explanation">대사에 맞춰 바뀌는 자막입니다.<br>내용과 시간은 ‘자막’ 탭에서 편집하세요.</p>
    <div class="design-style-grid">${[['impact','굵은 대사'],['accent','형광 강조'],['highlight','배경 박스'],['minimal','미니멀']].map(([value,label]) => `<button data-caption-preset="${value}" class="design-style ${state.style === value ? 'active' : ''}"><span class="style-${value}">오늘의 순간</span><small>${label}</small></button>`).join('')}</div>
    <div class="design-colors">${color('기본 색', 'captionColor', state.captionColor)}${color('강조 색', 'captionAccent', state.captionAccent)}</div>
    ${range('글자 크기', 'captionSize', state.captionSize, 18, 60)}
    ${range('검은 테두리', 'captionStroke', state.captionStroke, 0, 10)}
    ${check('굵은 기울임', 'captionItalic', state.captionItalic)}
    ${range('가로 위치', 'captionX', Math.round(state.captionX * 100), 10, 90, 1, '%')}
    ${range('세로 위치', 'captionY', Math.round(state.captionY * 100), 10, 90, 1, '%')}
    <label class="panel-label" for="captionAnimation">등장 효과</label><select class="panel-select" id="captionAnimation" data-design="captionAnimation"><option value="none" ${state.captionAnimation === 'none' ? 'selected' : ''}>없음</option><option value="pop" ${state.captionAnimation === 'pop' ? 'selected' : ''}>짧게 팝업</option><option value="fade" ${state.captionAnimation === 'fade' ? 'selected' : ''}>서서히 등장</option><option value="slide" ${state.captionAnimation === 'slide' ? 'selected' : ''}>아래에서 등장</option></select>
    <div class="design-divider"></div><label class="panel-label" for="globalKeywords">모든 자막에서 강조할 단어</label><input class="panel-input" id="globalKeywords" data-design="globalKeywords" maxlength="150" value="${escape(state.globalKeywords)}" placeholder="핵심, 이유, 정답"><p class="tiny-note">쉼표로 구분합니다. 자막별 강조어는 ‘자막’에서 지정하세요. 배경 박스 스타일은 문장 전체를 강조합니다.</p>${state.speakerLabels.map((name,i)=>`<label class="panel-label" for="speakerLabel${i}">화자 ${i+1} 이름</label><input class="panel-input" id="speakerLabel${i}" data-design="speakerLabels.${i}" maxlength="24" value="${escape(name)}">${color(`화자 ${i+1} 색`, `speakerColors.${i}`, state.speakerColors[i])}`).join('')}<p class="tiny-note">각 자막에 화자를 직접 지정하면 이름표와 글자 색상이 함께 바뀝니다.</p>
    <button class="button full subtle" id="openCaptionEditor">대사 내용 편집하기</button>`;
  if (layer === 'credit') controls = `
    ${check('하단 크레딧 표시', 'design.credit.enabled', d.credit.enabled)}
    <label class="panel-label" for="creditText">채널명 · 내레이션 · 출처</label><input id="creditText" class="panel-input" data-design="design.credit.text" value="${escape(d.credit.text)}" maxlength="100" placeholder="narration voice · 나의 채널">
    ${color('글자 색', 'design.credit.color', d.credit.color)}
    ${range('글자 크기', 'design.credit.size', d.credit.size, 10, 36)}
    ${check('기울임', 'design.credit.italic', d.credit.italic)}
    ${range('가로 위치', 'design.credit.x', Math.round(d.credit.x * 100), 10, 90, 1, '%')}
    ${range('세로 위치', 'design.credit.y', Math.round(d.credit.y * 100), 10, 93, 1, '%')}
    ${timing('credit')}`;
  if (layer === 'frame') controls = `
    <label class="panel-label" for="frameLayout">영상 배치</label><select class="panel-select" id="frameLayout" data-design="design.layout"><option value="framed" ${d.layout === 'framed' ? 'selected' : ''}>상하 여백 + 중앙 영상</option><option value="full" ${d.layout === 'full' ? 'selected' : ''}>영상 전체 채우기</option></select>
    ${color('여백 색상', 'design.background', d.background)}
    ${range('영상 시작 위치', 'design.top', Math.round(d.top * 100), 15, 40, 1, '%')}
    ${range('영상 끝 위치', 'design.bottom', Math.round(d.bottom * 100), 65, 91, 1, '%')}
    <div class="notice">상하 여백을 사용하면 타이틀이 영상의 중요한 장면을 가리지 않습니다. 화면 비율과 확대는 ‘화면’ 탭에서 조절하세요.</div>
    <button class="button full subtle" id="openScreenEditor">영상 크기 · 비율 조절</button>`;
  root.innerHTML = `<div class="design-heading"><span class="eyebrow">SHORTS TYPOGRAPHY</span><h1 class="panel-heading">한 화면으로 완성하는 이야기</h1><p class="panel-intro">타이틀부터 대사, 크레딧까지.<br>각각의 역할에 맞게 디자인하세요.</p></div>
    <div class="section-label">빠른 구성 <button class="text-button" id="openTemplateGallery">전체 템플릿 →</button></div>
    <div class="layout-presets"><button data-layout-preset="reference" title="참고 이미지처럼 검은 여백, 흰색·형광 타이틀"><span class="preset-art reference"><b>하루의 한 장면</b><b>기억에 남는 순간</b><i></i><em>오늘의 이야기</em><small>my moment</small></span><strong>리뷰형</strong></button><button data-layout-preset="punch" title="전체 영상과 굵은 노란색 타이틀"><span class="preset-art punch"><b>지금 이 순간</b><b>놓치면 아쉬운</b><i></i><em>오늘의 이야기</em></span><strong>임팩트</strong></button><button data-layout-preset="clean" title="담백한 타이틀과 하단 자막"><span class="preset-art clean"><b>나의 작은 기록</b><i></i><em>오늘의 이야기</em></span><strong>브이로그</strong></button></div>
    <div class="layer-tabs" role="tablist" aria-label="텍스트 레이어">${[['title','타이틀'],['caption','대사'],['credit','크레딧'],['frame','여백']].map(([value,label]) => `<button role="tab" aria-selected="${layer === value}" data-text-layer="${value}" class="${layer === value ? 'active' : ''}">${label}</button>`).join('')}</div>
    <div class="layer-controls">${controls}</div>
    <p class="tiny-note design-footnote">글자 크기는 세로 미리보기 기준입니다. 출력 시 해상도에 맞춰 확대됩니다.</p>`;
  root.querySelectorAll('[data-layout-preset]').forEach(button => button.onclick = () => api.preset(button.dataset.layoutPreset));
  root.querySelectorAll('[data-text-layer]').forEach(button => button.onclick = () => api.select(button.dataset.textLayer));
  root.querySelectorAll('[data-caption-preset]').forEach(button => button.onclick = () => api.captionStyle(button.dataset.captionPreset));
  root.querySelectorAll('[data-design]').forEach(input => {
    const path = input.dataset.design;
    const continuous = ['text', 'range', 'color'].includes(input.type);
    if (continuous) input.onfocus = api.snapshot;
    const update = () => {
      let value = input.type === 'checkbox' ? input.checked : ['number','range'].includes(input.type) ? (input.value === '' ? null : Number(input.value)) : input.value;
      if (input.dataset.unit === '%') value /= 100;
      if (path.endsWith('.start') || path.endsWith('.end')) {
        const target = path.includes('.title.') ? d.title : d.credit;
        const start = path.endsWith('.start') ? value : target.start;
        const end = path.endsWith('.end') ? value : target.end;
        if (start == null || !Number.isFinite(start) || (end != null && !Number.isFinite(end)) || start < 0 || start > total || (end != null && (end <= start || end > total))) {
          input.setCustomValidity('시작과 끝은 출력 영상 길이 안에 있어야 합니다.'); input.reportValidity(); return;
        }
      }
      input.setCustomValidity('');
      if (!continuous) api.snapshot();
      api.update(project => {
        const keys = path.split('.'); let item = project;
        for (const key of keys.slice(0, -1)) item = item[key];
        item[keys.at(-1)] = value;
      });
      const output = root.querySelector(`[data-output="${path}"]`);
      if (output) output.textContent = input.value + (input.dataset.unit || '');
    };
    input[continuous ? 'oninput' : 'onchange'] = update;
  });
  const timedButton=root.querySelector('#editTimedTitle');
  if(timed&&timedButton)timedButton.onclick=()=>api.timedTitle(timed.id);
  const gallery = root.querySelector('#openTemplateGallery');
  if (gallery) gallery.onclick = () => api.navigate('templates');
  const captions = root.querySelector('#openCaptionEditor');
  const screen = root.querySelector('#openScreenEditor');
  if (captions) captions.onclick = () => api.navigate('captions');
  if (screen) screen.onclick = () => api.navigate('settings');
}
