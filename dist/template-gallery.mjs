import { TEMPLATES } from './template-catalog.mjs';
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const searchTerms = {recipe:'요리 음식 쿠킹 레시피',interview:'인터뷰 팟캐스트 대화',explainer:'정보 지식 설명',ranking:'랭킹 순위 추천',product:'제품 리뷰 장단점',cinema:'시네마틱 여행 풍경',quiz:'퀴즈 질문 정답',clean:'브이로그 일상',reference:'리뷰 스토리 해설',punch:'임팩트 강조'};

export function mountTemplateGallery(root, api) {
  const ui = api.ui;
  root.innerHTML = `<div class="gallery-heading"><span class="eyebrow">TEMPLATE STUDIO</span><h1 class="panel-heading">이야기에 맞는 시작점</h1><p class="panel-intro">구성, 자막, 움직임까지.<br>내 영상에 맞춰 골라보세요.</p></div>
    ${api.error?`<p class="notice" role="alert">${esc(api.error)}</p>`:''}
    <div class="template-search"><input id="templateSearch" placeholder="요리, 인터뷰, 퀴즈…" aria-label="템플릿 검색" value="${esc(ui.query)}"></div>
    <div class="template-filters" role="group" aria-label="템플릿 분류">${['전체','리뷰','정보','라이프','대화','참여','즐겨찾기','내 템플릿'].map(category=>`<button data-category="${category}" class="${ui.category===category?'active':''}" aria-pressed="${ui.category===category}">${category}</button>`).join('')}</div>
    <div class="gallery-summary"><span id="templateCount"></span><button class="text-button" id="saveMyTemplate">+ 내 스타일 저장</button></div>
    <div class="template-grid" id="templateGrid"></div>
    <p class="tiny-note gallery-disclosure">각 카드에서 예시를 재생해 볼 수 있어요.<br>스타일 적용은 기존 문구와 자막을 유지합니다.</p>`;
  function renderCards() {
    const all = [...TEMPLATES,...api.custom];
    const filtered = all.filter(item=>(ui.category==='전체'||(ui.category==='즐겨찾기'?api.favorites.includes(item.id):item.category===ui.category))&&`${item.name} ${item.tag} ${item.category} ${item.description} ${searchTerms[item.id]||''}`.toLowerCase().includes(ui.query.trim().toLowerCase()));
    root.querySelector('#templateCount').textContent = `${filtered.length}개의 구성`;
    root.querySelector('#templateGrid').innerHTML = filtered.map(item=>`<article class="template-card ${api.active===item.id?'is-applied':''}"><button class="template-preview-button" data-preview-template="${esc(item.id)}" aria-label="${esc(item.name)} 미리보기"><canvas width="216" height="384" data-template-canvas="${esc(item.id)}"></canvas><span class="template-tag">${esc(item.tag)}</span><span class="preview-play">▶</span></button><div class="template-card-meta"><button class="template-name" data-preview-template="${esc(item.id)}">${esc(item.name)}</button><button class="template-star" data-favorite="${esc(item.id)}" aria-label="${esc(item.name)} 즐겨찾기" aria-pressed="${api.favorites.includes(item.id)}">${api.favorites.includes(item.id)?'★':'☆'}</button></div><p>${esc(item.category)} ${api.active===item.id?'· 적용됨':''}</p>${item.custom?`<button class="text-button remove-template" data-remove-template="${esc(item.id)}">삭제</button>`:''}</article>`).join('')||'<div class="empty-text">조건에 맞는 템플릿이 없습니다.</div>';
    root.querySelectorAll('[data-template-canvas]').forEach(canvas=>api.thumbnail(canvas,all.find(item=>item.id===canvas.dataset.templateCanvas)));
    root.querySelectorAll('[data-preview-template]').forEach(button=>button.onclick=()=>api.preview(all.find(item=>item.id===button.dataset.previewTemplate)));
    root.querySelectorAll('[data-favorite]').forEach(button=>button.onclick=()=>{api.favorite(button.dataset.favorite);renderCards();});
    root.querySelectorAll('[data-remove-template]').forEach(button=>button.onclick=()=>api.remove(button.dataset.removeTemplate));
  }
  root.querySelector('#templateSearch').oninput=event=>{ui.query=event.target.value;renderCards();};
  root.querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>{ui.category=button.dataset.category;root.querySelectorAll('[data-category]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',b===button);});renderCards();});
  root.querySelector('#saveMyTemplate').onclick=api.save;
  renderCards();
}
