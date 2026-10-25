import { text, attrs, setText } from './i18n.mjs';
import { TEMPLATES, templateCategoryKey, templateSearchText } from './template-catalog.mjs';
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const searchTerms = {recipe:'요리 음식 쿠킹 레시피',interview:'인터뷰 팟캐스트 대화',explainer:'정보 지식 설명',ranking:'랭킹 순위 추천',product:'제품 리뷰 장단점',cinema:'시네마틱 여행 풍경',quiz:'퀴즈 질문 정답',clean:'브이로그 일상',reference:'리뷰 스토리 해설',punch:'임팩트 강조'};

const galleryOwners = new WeakMap();

export function mountTemplateGallery(root, api) {
  const owner = {};
  galleryOwners.set(root, owner);
  const ui = api.ui;
  root.innerHTML = `<div class="gallery-heading"><h1 class="panel-heading">${text('templates.heading')}</h1><button class="text-button" id="importMyTemplate">${text('templates.import')}</button><input id="templateFileInput" type="file" accept=".json,.moment-template.json,application/json" ${attrs('aria-label','templates.importLabel')} hidden><button class="text-button" id="saveMyTemplate">${text('templates.saveStyle')}</button></div>
    ${api.error?`<p class="notice" role="alert">${api.errorKey?text(api.errorKey):esc(api.error)}</p>`:''}
    <div class="template-search"><input id="templateSearch" ${attrs('placeholder','templates.searchPlaceholder')} ${attrs('aria-label','templates.searchLabel')} value="${esc(ui.query)}"></div>
    <div class="template-filter-groups">${[
      {name:'templates.categoryGroup',categories:['전체','초반 훅','리뷰','정보','라이프','대화','참여']},
      {name:'templates.personalGroup',categories:['즐겨찾기','내 템플릿']}
    ].map(group=>`<div class="template-filters" role="group" ${attrs('aria-label',group.name)}>${group.categories.map(category=>`<button data-category="${category}" class="${ui.category===category?'active':''}" aria-pressed="${ui.category===category}">${text(templateCategoryKey(category))}</button>`).join('')}</div>`).join('')}</div>
    <div class="gallery-summary panel-actions"><span id="templateCount"></span><button class="text-button" id="exportTemplateCollection" ${api.custom.length ? '' : 'disabled'}>${text('templates.exportCollection')}</button></div>
    <div class="template-grid" id="templateGrid"></div>`;
  const grid = root.querySelector('#templateGrid');
  const current = () => galleryOwners.get(root) === owner && root.querySelector('#templateGrid') === grid;
  function renderCards() {
    const all = [...TEMPLATES,...api.custom];
    const filtered = all.filter(item=>(ui.category==='전체'||(ui.category==='즐겨찾기'?api.favorites.includes(item.id):item.category===ui.category))&&`${templateSearchText(item)} ${searchTerms[item.id]||''}`.toLowerCase().includes(ui.query.trim().toLowerCase()));
    setText(root.querySelector('#templateCount'), 'templates.count', {count:filtered.length});
    root.querySelector('#templateGrid').innerHTML = filtered.map(item=>`<article class="template-card ${api.active===item.id?'is-applied':''}"><button class="template-preview-button" data-preview-template="${esc(item.id)}" ${item.custom?attrs('aria-label','templates.preview',{name:item.name}):attrs('aria-label','templates.builtin.'+item.id+'.preview')}><canvas width="216" height="384" data-template-canvas="${esc(item.id)}"></canvas><span class="preview-play">▶</span></button><div class="template-card-meta"><button class="template-name" data-preview-template="${esc(item.id)}">${item.custom?esc(item.name):text('templates.builtin.'+item.id+'.name')}</button><button class="template-star" data-favorite="${esc(item.id)}" ${item.custom?attrs('aria-label','templates.favorite',{name:item.name}):attrs('aria-label','templates.builtin.'+item.id+'.favorite')} aria-pressed="${api.favorites.includes(item.id)}">${api.favorites.includes(item.id)?'★':'☆'}</button></div><p>${item.custom&&item.category!=='내 템플릿'?esc(item.category):text(templateCategoryKey(item.category))} ${api.active===item.id?text('templates.applied'):''}</p>${item.custom?`<div class="panel-actions template-management" role="group" ${attrs('aria-label','templates.manage',{name:item.name})}><button class="text-button" data-update-template="${esc(item.id)}" ${attrs('aria-label','templates.updateLabel',{name:item.name})}>${text('templates.update')}</button><button class="text-button" data-duplicate-template="${esc(item.id)}" ${attrs('aria-label','templates.duplicateLabel',{name:item.name})}>${text('templates.duplicate')}</button><button class="text-button" data-rename-template="${esc(item.id)}" ${attrs('aria-label','templates.renameLabel',{name:item.name})}>${text('templates.rename')}</button><button class="text-button" data-export-template="${esc(item.id)}" ${attrs('aria-label','templates.exportLabel',{name:item.name})}>${text('templates.export')}</button><button class="text-button remove-template" data-remove-template="${esc(item.id)}" ${attrs('aria-label','templates.removeLabel',{name:item.name})}>${text('templates.delete')}</button></div>`:''}</article>`).join('')||`<div class="empty-text">${text('templates.empty')}</div>`;
    root.querySelectorAll('[data-template-canvas]').forEach(canvas=>api.thumbnail(canvas,all.find(item=>item.id===canvas.dataset.templateCanvas)));
    root.querySelectorAll('[data-preview-template]').forEach(button=>button.onclick=()=>api.preview(all.find(item=>item.id===button.dataset.previewTemplate)));
    root.querySelectorAll('[data-favorite]').forEach(button => button.onclick = () => {
      const previous = [...root.querySelectorAll('[data-favorite]')];
      const index = previous.indexOf(button);
      if (!current() || index < 0) return;
      const id = button.dataset.favorite;
      api.favorite(id);
      if (!current()) return;
      renderCards();
      if (!current()) return;
      const stars = [...root.querySelectorAll('[data-favorite]')];
      const same = stars.find(star => star.dataset.favorite === id);
      const nearest = stars[Math.min(index, stars.length - 1)];
      const favoritesFilter = [...root.querySelectorAll('[data-category]')]
        .find(filter => filter.dataset.category === '즐겨찾기' && filter.getAttribute('aria-pressed') === 'true');
      (same || nearest || favoritesFilter || root.querySelector('#templateSearch'))?.focus({preventScroll: true});
    });
    root.querySelectorAll('[data-update-template]').forEach(button=>button.onclick=()=>api.update(button.dataset.updateTemplate));
    root.querySelectorAll('[data-duplicate-template]').forEach(button=>button.onclick=()=>api.duplicate(button.dataset.duplicateTemplate));
    root.querySelectorAll('[data-rename-template]').forEach(button=>button.onclick=()=>api.rename(button.dataset.renameTemplate));
    root.querySelectorAll('[data-export-template]').forEach(button=>button.onclick=()=>api.export(button.dataset.exportTemplate));
    root.querySelectorAll('[data-remove-template]').forEach(button=>button.onclick=()=>api.remove(button.dataset.removeTemplate));
  }
  root.querySelector('#templateSearch').oninput=event=>{ui.query=event.target.value;renderCards();};
  root.querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>{ui.category=button.dataset.category;root.querySelectorAll('[data-category]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',b===button);});renderCards();});
  root.querySelector('#saveMyTemplate').onclick=api.save;
  const collectionButton = root.querySelector('#exportTemplateCollection');
  collectionButton.onclick = event => {
    if (current() && root.querySelector('#exportTemplateCollection') === collectionButton &&
        api.custom.length && !event?.isComposing && event?.keyCode !== 229) api.exportCollection();
  };
  const fileInput=root.querySelector('#templateFileInput');
  root.querySelector('#importMyTemplate').onclick=()=>fileInput.click();
  fileInput.onchange=()=>{const file=fileInput.files?.[0];fileInput.value='';if(file)return api.import(file);};
  renderCards();
  return {
    focusTemplate(id) {
      if (!current() || root.isConnected === false) return;
      const name = [...root.querySelectorAll('.template-name')].find(button => button.dataset.previewTemplate === id);
      (name || root.querySelector('#templateSearch'))?.focus();
    }
  };
}
