const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountEffectsPanel(root, api) {
  const { state, total, tab } = api, effects = state.effects;
  const select=(label,key,value,options)=>`<label class="panel-label" for="effect-${key}">${label}</label><select id="effect-${key}" class="panel-select" data-effect="${key}">${options.map(([v,l])=>`<option value="${v}" ${String(v)===String(value)?'selected':''}>${l}</option>`).join('')}</select>`;
  const range=(label,key,value,min,max,step=.01)=>`<label class="design-range"><span>${label}<output data-effect-output="${key}">${value}</output></span><input type="range" data-effect="${key}" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
  root.innerHTML=`<span class="eyebrow">STORY & MOTION</span><h1 class="panel-heading" style="margin-top:9px">장면에 리듬을 더하세요</h1><p class="panel-intro">시간별 타이틀과 움직임을<br>완성 영상에 함께 담습니다.</p><div class="layer-tabs" role="tablist"><button data-effect-tab="cards" role="tab" aria-selected="${tab==='cards'}" class="${tab==='cards'?'active':''}">구간별 문구</button><button data-effect-tab="motion" role="tab" aria-selected="${tab==='motion'}" class="${tab==='motion'?'active':''}">움직임·색감</button></div><div id="effectControls"></div>`;
  const target=root.querySelector('#effectControls');
  if(tab==='motion'){
    target.innerHTML=`${select('클립 안 카메라 움직임','motion',effects.motion,[['none','고정'],['in','천천히 확대'],['out','천천히 축소']])}${range('줌 변화량','strength',effects.strength,0,.4)}
      ${select('클립 시작·끝 효과','transition',effects.transition,[['none','없음'],['fadeBlack','검정 페이드'],['flash','짧은 흰색 플래시']])}${range('전환 길이 (초)','transitionDuration',effects.transitionDuration,.05,.7,.05)}
      <p class="tiny-note">전환은 각 클립의 시작과 끝에 적용됩니다.</p><div class="design-divider"></div>
      ${range('밝기','brightness',effects.brightness,.7,1.3,.05)}${range('대비','contrast',effects.contrast,.7,1.5,.05)}${range('채도','saturation',effects.saturation,0,1.6,.05)}${range('가장자리 어둡게','vignette',effects.vignette,0,.6,.05)}
      <div class="design-divider"></div><label class="design-check"><input type="checkbox" data-effect="progress" ${effects.progress?'checked':''}>영상 진행 막대</label>
      ${select('진행 막대 위치','progressPosition',effects.progressPosition,[['top','상단'],['bottom','하단']])}<label class="design-color">막대 색<input type="color" data-effect="progressColor" value="${effects.progressColor}"></label>
      <button class="button full" id="resetEffects">움직임·색감 초기화</button>`;
    target.querySelectorAll('[data-effect]').forEach(input=>{
      const continuous=['range','color'].includes(input.type);if(continuous)input.onfocus=api.snapshot;
      input[continuous?'oninput':'onchange']=()=>{if(!continuous)api.snapshot();let value=input.type==='checkbox'?input.checked:input.type==='range'?Number(input.value):input.value;api.update(p=>p.effects[input.dataset.effect]=value);const output=target.querySelector(`[data-effect-output="${input.dataset.effect}"]`);if(output)output.textContent=input.value;};
    });
    target.querySelector('#resetEffects').onclick=api.reset;
  } else {
    const card=state.overlays.find(item=>item.id===api.selected)||state.overlays[0];
    target.innerHTML=`<div class="section-label">시간별 문구 <span class="muted">${state.overlays.length} / 12</span></div><button class="button dark full" id="addSceneCard" ${state.overlays.length>=12?'disabled':''}>+ 현재 위치에 문구 추가</button><button class="text-button" id="toggleSceneLayers" style="margin-top:10px">${state.overlays.some(c=>c.enabled!==false)?'모든 구간 문구 숨기기':'모든 구간 문구 표시'}</button><p class="tiny-note">상단 타이틀 문구는 기본 제목과 같은 자리에서 교체됩니다. 영상 중앙은 비워둡니다.</p><div class="scene-list">${state.overlays.map((item,index)=>`<button class="scene-list-item ${item.id===card?.id?'active':''}" data-scene-select="${esc(item.id)}"><span>${String(index+1).padStart(2,'0')}</span><div><strong>${esc(item.label||'카드')} · ${esc(item.text)}</strong><small>${item.start.toFixed(1)}–${item.end.toFixed(1)}초</small></div></button>`).join('')}</div>${card?`
      <div class="scene-editor"><div class="section-label">선택한 문구 <button class="text-button" id="removeSceneCard">삭제</button></div>
      <label class="design-check"><input type="checkbox" data-card="enabled" ${card.enabled!==false?'checked':''}>이 문구 표시</label>
      <label class="panel-label">문구 역할<select class="panel-select" data-card="role"><option value="headline" ${(card.role||'headline')==='headline'?'selected':''}>상단 타이틀 · 기본 제목 대체</option><option value="free" ${card.role==='free'?'selected':''}>자유 배치 · 추가 문구</option></select></label>
      <label class="panel-label">배경<select class="panel-select" data-card="presentation"><option value="plain" ${(card.presentation||'plain')==='plain'?'selected':''}>없음 · 글자와 테두리만</option><option value="panel" ${card.presentation==='panel'?'selected':''}>반투명 배경 패널</option></select></label>
      <label class="panel-label" for="sceneLabel">작은 라벨</label><input id="sceneLabel" class="panel-input" data-card="label" maxlength="32" value="${esc(card.label)}">
      <label class="panel-label" for="sceneText">핵심 문장 · 줄바꿈 가능</label><textarea id="sceneText" class="panel-input" data-card="text" maxlength="90" rows="2">${esc(card.text)}</textarea>
      <label class="panel-label" for="sceneDetail">보충 설명 · 선택지</label><textarea id="sceneDetail" class="panel-input" data-card="detail" maxlength="130">${esc(card.detail)}</textarea>
      <div class="time-fields"><label>시작 (초)<input type="number" data-card="start" min="0" max="${total}" step=".1" value="${card.start.toFixed(2)}"></label><label>끝 (초)<input type="number" data-card="end" min="0" max="${total}" step=".1" value="${card.end.toFixed(2)}"></label></div>
      <p class="tiny-note">출력 영상 기준입니다. 편집 길이·배속을 바꾸면 표시 구간도 비례 조절됩니다. 목록의 문구를 누르면 시작 위치로 이동합니다.</p>
      <label class="panel-label">표시 방식<select class="panel-select" data-card="kind"><option value="card" ${card.kind==='card'?'selected':''}>일반 문구</option><option value="countdown" ${card.kind==='countdown'?'selected':''}>남은 시간 카운트다운</option></select></label>
      <label class="panel-label">등장 효과<select class="panel-select" data-card="animation">${[['none','없음'],['fade','서서히 등장'],['slide','아래에서 등장'],['pop','팝업']].map(([v,l])=>`<option value="${v}" ${card.animation===v?'selected':''}>${l}</option>`).join('')}</select></label>
      <div class="design-colors">${[['color','글자'],['accent','강조'],['background','배경']].map(([key,label])=>`<label class="design-color">${label}<input type="color" data-card="${key}" value="${card[key]}"></label>`).join('')}</div>
      ${[['x','가로 위치',.1,.9,.01],['y','세로 위치',.08,.8,.01],['width','문구 폭',.4,.82,.01],['size','글자 크기',20,48,1],['stroke','검은 테두리',0,6,.5],['backgroundOpacity','배경 불투명도',0,1,.05]].map(([key,label,min,max,step])=>`<label class="design-range"><span>${label}<output data-card-output="${key}">${card[key]}</output></span><input type="range" data-card="${key}" value="${card[key]}" min="${min}" max="${max}" step="${step}"></label>`).join('')}
      <div class="panel-actions"><button class="button" id="duplicateSceneCard">문구 복제</button><button class="button" id="previewSceneCard">구간 재생</button></div></div>`:'<p class="empty-text">템플릿의 예시 구성을 적용하거나<br>첫 문구를 직접 추가하세요.</p>'}`;
    target.querySelector('#addSceneCard').onclick=api.add;
    target.querySelector('#toggleSceneLayers').onclick=api.toggleAll;
    target.querySelectorAll('[data-scene-select]').forEach(button=>button.onclick=()=>api.select(button.dataset.sceneSelect));
    if(card){
      target.querySelector('#removeSceneCard').onclick=()=>api.remove(card.id);target.querySelector('#duplicateSceneCard').onclick=()=>api.duplicate(card.id);target.querySelector('#previewSceneCard').onclick=()=>api.play(card.start);
      target.querySelectorAll('[data-card]').forEach(input=>{
        const continuous=['text','range','color','textarea'].includes(input.type);if(continuous)input.onfocus=api.snapshot;
        input[continuous?'oninput':'onchange']=()=>{
          const key=input.dataset.card,value=input.type==='checkbox'?input.checked:['range','number'].includes(input.type)?Number(input.value):input.value;
          if(key==='start'||key==='end'){
            const start=key==='start'?value:card.start,end=key==='end'?value:card.end;
            if(!Number.isFinite(value)||start<0||end<=start||end>total){input.setCustomValidity('0초부터 영상 끝 사이에 시작·끝을 지정하세요.');input.reportValidity();return;}
          }
          input.setCustomValidity('');if(!continuous)api.snapshot();api.update(p=>p.overlays.find(item=>item.id===card.id)[key]=value);
          const item = [...target.querySelectorAll('[data-scene-select]')].find(button=>button.dataset.sceneSelect===card.id);
          if (item) { item.querySelector('strong').textContent=`${card.label||'카드'} · ${card.text}`; item.querySelector('small').textContent=`${card.start.toFixed(1)}–${card.end.toFixed(1)}초`; }
          const output=target.querySelector(`[data-card-output="${key}"]`);if(output)output.textContent=input.value;
        };
      });
    }
  }
  root.querySelectorAll('[data-effect-tab]').forEach(button=>button.onclick=()=>api.changeTab(button.dataset.effectTab));
}
