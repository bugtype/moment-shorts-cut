import { bindPanelTabs } from './panel-tabs.mjs';
import { decimalTime, esc as escape } from './ui-format.mjs';
import { t, text, mark, attrs, setValidity } from './i18n.mjs';
import { activeSceneLayers } from './effects.mjs';
import { createPendingInputCheck } from './pending-input.mjs';

const renderOwners = new WeakMap();

export function mountDesignPanel(root, api) {
  const owner = {};
  const pending = [];
  renderOwners.set(root, owner);
  const { state, layer, total } = api;
  const d = state.design;
  const designLayer = d[layer];
  const timed = activeSceneLayers(state, api.time || 0)
    .find(card => (card.role || 'headline') === 'headline');
  const check = (label, path, value) => (
    `<label class="design-check"><input type="checkbox" data-design="${path}" ${value ? 'checked' : ''}>` +
    `${text(label)}</label>`
  );
  const range = (label, path, value, min, max, step = 1, unit = '') => (
    `<label class="design-range"><span>${text(label)}<output data-output="${path}">${value}${unit}</output></span>` +
    `<input type="range" data-design="${path}" value="${value}" min="${min}" max="${max}" step="${step}"` +
    ` ${attrs('aria-label', label)} data-unit="${unit}"></label>`
  );
  const color = (label, path, value, params = {}) => (
    `<label class="design-color">${text(label, params)}<input type="color" data-design="${path}" value="${value}"` +
    ` ${attrs('aria-label', label, params)}></label>`
  );
  const timing = target => (
    `<div class="design-divider"></div><span class="field-label">${text('panels.titleTiming')}</span>` +
    `<div class="time-fields"><label>${text('panels.start')}` +
    `<input type="number" data-design="design.${target}.start" min="0" max="${total}" step="any"` +
    ` value="${decimalTime(d[target].start)}"></label><label>${text('panels.end')}` +
    `<input type="number" data-design="design.${target}.end" min="0" max="${total}" step="any"` +
    ` value="${d[target].end == null ? '' : decimalTime(d[target].end)}" ${attrs('placeholder', 'panels.untilEnd')}>` +
    `</label></div><p class="tiny-note">${text('panels.timingNotice')}</p>`
  );

  let controls = '';
  if (layer === 'title') controls = (
    `\n    ${timed ? (
      `<div class="notice">${text('panels.timedTitleNotice')}` +
      `<button class="text-button" id="editTimedTitle">${text('panels.editTimedTitle')}</button></div>`
    ) : ''}` +
    `\n    ${check('panels.showTitle', 'design.title.enabled', d.title.enabled)}` +
    `\n    <label class="panel-label" for="titleFirst">${text('panels.titleFirst')}</label>` +
    `<input class="panel-input" id="titleFirst" data-design="design.title.lines.0" value="${escape(d.title.lines[0])}"` +
    ` maxlength="60" ${attrs('placeholder', 'panels.titleFirstPlaceholder')}>` +
    `\n    <label class="panel-label" for="titleSecond">${text('panels.titleSecond')}</label>` +
    `<input class="panel-input" id="titleSecond" data-design="design.title.lines.1" value="${escape(d.title.lines[1])}"` +
    ` maxlength="60" ${attrs('placeholder', 'panels.titleSecondPlaceholder')}>` +
    `\n    <div class="design-colors">${color('panels.firstLine', 'design.title.colors.0', d.title.colors[0])}` +
    `${color('panels.accentLine', 'design.title.colors.1', d.title.colors[1])}</div>` +
    `\n    ${range('panels.textSize', 'design.title.size', d.title.size, 20, 64)}` +
    `\n    ${range('panels.blackStroke', 'design.title.stroke', d.title.stroke, 0, 10)}` +
    `\n    ${check('panels.boldItalic', 'design.title.italic', d.title.italic)}` +
    `\n    ${range('panels.horizontal', 'design.title.x', Math.round(d.title.x * 100), 10, 90, 1, '%')}` +
    `\n    ${range('panels.vertical', 'design.title.y', Math.round(d.title.y * 100), 6, 90, 1, '%')}` +
    `\n    <button class="button" id="openPosition">${text('panels.position')}</button>` +
    `\n    ${timing('title')}`
  );
  if (layer === 'caption') controls = (
    `\n    <p class="layer-explanation">${text('panels.captionExplanation')}</p>` +
    `\n    <div class="design-style-grid">${[
      ['impact', 'panels.styleImpact'],
      ['accent', 'panels.styleAccent'],
      ['highlight', 'panels.styleHighlight'],
      ['minimal', 'panels.styleMinimal']
    ].map(([value, label]) => (
      `<button data-caption-preset="${value}" class="design-style ${state.style === value ? 'active' : ''}">` +
      `<span class="style-${value}">${text('shell.styleExample')}</span><small>${text(label)}</small></button>`
    )).join('')}</div>` +
    `\n    <div class="design-colors">${color('panels.baseColor', 'captionColor', state.captionColor)}` +
    `${color('panels.accentColor', 'captionAccent', state.captionAccent)}</div>` +
    `\n    ${range('panels.textSize', 'captionSize', state.captionSize, 18, 60)}` +
    `\n    ${range('panels.blackStroke', 'captionStroke', state.captionStroke, 0, 10)}` +
    `\n    ${check('panels.boldItalic', 'captionItalic', state.captionItalic)}` +
    `\n    ${range('panels.horizontal', 'captionX', Math.round(state.captionX * 100), 10, 90, 1, '%')}` +
    `\n    ${range('panels.vertical', 'captionY', Math.round(state.captionY * 100), 10, 90, 1, '%')}` +
    `\n    <button class="button" id="openPosition">${text('panels.position')}</button>` +
    `\n    <label class="panel-label" for="captionAnimation">${text('panels.animation')}</label>` +
    `<select class="panel-select" id="captionAnimation" data-design="captionAnimation">` +
    `<option value="none" ${state.captionAnimation === 'none' ? 'selected' : ''} ${mark('panels.none')}>` +
    `${escape(t('panels.none'))}</option>` +
    `<option value="pop" ${state.captionAnimation === 'pop' ? 'selected' : ''} ${mark('panels.shortPop')}>` +
    `${escape(t('panels.shortPop'))}</option>` +
    `<option value="fade" ${state.captionAnimation === 'fade' ? 'selected' : ''} ${mark('panels.fade')}>` +
    `${escape(t('panels.fade'))}</option>` +
    `<option value="slide" ${state.captionAnimation === 'slide' ? 'selected' : ''} ${mark('panels.slide')}>` +
    `${escape(t('panels.slide'))}</option></select>` +
    `\n    <div class="design-divider"></div><label class="panel-label" for="globalKeywords">` +
    `${text('panels.globalKeywords')}</label>` +
    `<input class="panel-input" id="globalKeywords" data-design="globalKeywords" maxlength="150"` +
    ` value="${escape(state.globalKeywords)}" ${attrs('placeholder', 'panels.globalKeywordsPlaceholder')}>` +
    `<p class="tiny-note">${text('panels.globalKeywordsNotice')}</p>` +
    `<button class="button" id="clearKeywordEmphasis">${text('keywords.clear')}</button>${
      state.speakerLabels.map((name, i) => (
        `<label class="panel-label" for="speakerLabel${i}">${text('panels.speakerName', { index: i + 1 })}</label>` +
        `<input class="panel-input" id="speakerLabel${i}" data-design="speakerLabels.${i}" maxlength="24" value="${escape(name)}">` +
        `${color('panels.speakerColor', `speakerColors.${i}`, state.speakerColors[i], { index: i + 1 })}`
      )).join('')
    }<p class="tiny-note">${text('panels.speakerNotice')}</p>` +
    `\n    <button class="button full subtle" id="openCaptionEditor">${text('panels.editCaptionText')}</button>`
  );
  if (layer === 'credit') controls = (
    `\n    ${check('panels.showCredit', 'design.credit.enabled', d.credit.enabled)}` +
    `\n    <label class="panel-label" for="creditText">${text('panels.creditLabel')}</label>` +
    `<input id="creditText" class="panel-input" data-design="design.credit.text" value="${escape(d.credit.text)}"` +
    ` maxlength="100" ${attrs('placeholder', 'panels.creditPlaceholder')}>` +
    `\n    ${color('panels.textColor', 'design.credit.color', d.credit.color)}` +
    `\n    ${range('panels.textSize', 'design.credit.size', d.credit.size, 10, 36)}` +
    `\n    ${check('panels.italic', 'design.credit.italic', d.credit.italic)}` +
    `\n    ${range('panels.horizontal', 'design.credit.x', Math.round(d.credit.x * 100), 10, 90, 1, '%')}` +
    `\n    ${range('panels.vertical', 'design.credit.y', Math.round(d.credit.y * 100), 10, 93, 1, '%')}` +
    `\n    <button class="button" id="openPosition">${text('panels.position')}</button>` +
    `\n    ${timing('credit')}`
  );
  if (layer === 'frame') controls = (
    `\n    <label class="panel-label" for="frameLayout">${text('panels.videoLayout')}</label>` +
    `<select class="panel-select" id="frameLayout" data-design="design.layout">` +
    `<option value="framed" ${d.layout === 'framed' ? 'selected' : ''} ${mark('panels.layoutFramed')}>` +
    `${escape(t('panels.layoutFramed'))}</option>` +
    `<option value="full" ${d.layout === 'full' ? 'selected' : ''} ${mark('panels.layoutFull')}>` +
    `${escape(t('panels.layoutFull'))}</option></select>` +
    `\n    ${color('panels.marginColor', 'design.background', d.background)}` +
    `\n    ${range('panels.videoTop', 'design.top', Math.round(d.top * 100), 15, 40, 1, '%')}` +
    `\n    ${range('panels.videoBottom', 'design.bottom', Math.round(d.bottom * 100), 65, 91, 1, '%')}` +
    `\n    <div class="notice">${text('panels.marginNotice')}</div>` +
    `\n    <button class="button full subtle" id="openScreenEditor">${text('panels.adjustFrame')}</button>`
  );

  root.innerHTML = (
    `<h1 class="panel-heading">${text('panels.designHeading')}</h1>` +
    `\n    <div class="layer-tabs" role="tablist" ${attrs('aria-label', 'panels.textLayers')}>${[
      ['title', 'panels.title'],
      ['caption', 'panels.dialogue'],
      ['credit', 'panels.credit'],
      ['frame', 'panels.margin']
    ].map(([value, label]) => (
      `<button role="tab" aria-selected="${layer === value}" data-text-layer="${value}" id="text-tab-${value}"` +
      ` aria-controls="text-panel-${value}" tabindex="${layer === value ? 0 : -1}"` +
      ` class="${layer === value ? 'active' : ''}">${text(label)}</button>`
    )).join('')}</div>` +
    `\n    ${['title', 'caption', 'credit', 'frame'].map(value => (
      `<div id="text-panel-${value}" role="tabpanel" aria-labelledby="text-tab-${value}"${layer === value ? '' : ' hidden'}>` +
      `${layer === value ? `<div class="layer-controls">${controls}</div>` : ''}</div>`
    )).join('')}` +
    `\n    <p class="tiny-note design-footnote">${text('panels.sizeNotice')}</p>` +
    `\n    <div class="design-presets"><div class="section-label">${text('panels.quickLayout')} ` +
    `<button class="text-button" id="openTemplateGallery">${text('panels.allTemplates')}</button></div>` +
    `<div class="layout-presets"><button data-layout-preset="reference" ${attrs('title', 'panels.referenceTitle')}>` +
    `<span class="preset-art reference"><b>${text('panels.exampleDay')}</b><b>${text('panels.exampleMemory')}</b>` +
    `<i></i><em>${text('panels.exampleStory')}</em><small>${text('panels.exampleSignature')}</small></span>` +
    `<strong>${text('panels.reviewPreset')}</strong></button>` +
    `<button data-layout-preset="punch" ${attrs('title', 'panels.punchTitle')}>` +
    `<span class="preset-art punch"><b>${text('panels.exampleNow')}</b><b>${text('panels.exampleDontMiss')}</b>` +
    `<i></i><em>${text('panels.exampleStory')}</em></span><strong>${text('panels.impactPreset')}</strong></button>` +
    `<button data-layout-preset="clean" ${attrs('title', 'panels.cleanTitle')}>` +
    `<span class="preset-art clean"><b>${text('panels.exampleRecord')}</b><i></i><em>${text('panels.exampleStory')}</em></span>` +
    `<strong>${text('panels.vlogPreset')}</strong></button></div></div>`
  );

  if (['title', 'credit', 'caption'].includes(layer)) {
    const button = root.querySelector('#openPosition');
    let composing = false;
    root.oncompositionstart = () => { composing = true; };
    root.oncompositionend = () => { composing = false; };
    button.onclick = event => {
      if (
        !composing && !event?.isComposing && event?.keyCode !== 229 &&
        renderOwners.get(root) === owner && root.querySelector('#openPosition') === button
      ) api.position?.();
    };
    if (layer === 'caption') {
      const clear = root.querySelector('#clearKeywordEmphasis');
      clear.onclick = event => {
        if (
          !composing && !event?.isComposing && event?.keyCode !== 229 && renderOwners.get(root) === owner &&
          root.querySelector('#clearKeywordEmphasis') === clear && api.current?.() !== false
        ) api.clearKeywords?.();
      };
    }
  }
  root.querySelectorAll('[data-layout-preset]').forEach(button => (
    button.onclick = () => api.preset(button.dataset.layoutPreset)
  ));
  bindPanelTabs(root, {
    selector: '[data-text-layer]',
    key: 'textLayer',
    active: layer,
    select: api.select,
    current: () => renderOwners.get(root) === owner && api.current?.() !== false && api.tabCurrent?.() !== false,
    contextCurrent: () => api.current?.() !== false && api.tabCurrent?.() !== false
  });
  root.querySelectorAll('[data-caption-preset]').forEach(button => (
    button.onclick = () => api.captionStyle(button.dataset.captionPreset)
  ));
  root.querySelectorAll('[data-design]').forEach(input => {
    const path = input.dataset.design;
    const read = () => path.split('.').reduce((item, key) => item[key], state);
    const continuous = ['text', 'range', 'color'].includes(input.type);
    const current = () => renderOwners.get(root) === owner && api.current?.() !== false &&
      api.inputCurrent?.() !== false && state.design === d && d[layer] === designLayer &&
      input.isConnected !== false && [...root.querySelectorAll('[data-design]')].includes(input);
    const update = () => {
      if (!current()) return;
      let value = input.type === 'checkbox' ? input.checked
        : ['number', 'range'].includes(input.type) ? (input.value === '' ? null : Number(input.value))
        : input.value;
      if (input.dataset.unit === '%') value /= 100;
      if (path.endsWith('.start') || path.endsWith('.end')) {
        const target = path.includes('.title.') ? d.title : d.credit;
        const start = path.endsWith('.start') ? value : target.start;
        const end = path.endsWith('.end') ? value : target.end;
        if (
          start == null || !Number.isFinite(start) || (end != null && !Number.isFinite(end)) ||
          start < 0 || start > total || (end != null && (end <= start || end > total))
        ) {
          setValidity(input, 'panels.timingInvalid');
          input.reportValidity();
          return;
        }
      }
      setValidity(input, '');
      if (!continuous) api.snapshot();
      api.update(project => {
        const keys = path.split('.');
        let item = project;
        for (const key of keys.slice(0, -1)) item = item[key];
        item[keys.at(-1)] = value;
      });
      const output = root.querySelector(`[data-output="${path}"]`);
      if (output) output.textContent = input.value + (input.dataset.unit || '');
    };
    let composing;
    if (continuous) composing = api.input(input, () => {
      const value = read();
      return input.dataset.unit === '%' ? Math.round(value * 100) : value;
    }, update, current);
    else {
      input.onchange = update;
      if (input.type === 'number') {
        let active = false;
        input.oncompositionstart = () => { if (current()) active = true; };
        input.oncompositionend = () => { if (current()) active = false; };
        composing = () => active;
      }
    }
    if (['text', 'number'].includes(input.type)) {
      const check = createPendingInputCheck(input, {
        read, current, composing, nullable: value => path.endsWith('.end') && value == null
      });
      pending.push(check);
    }
  });

  const timedButton = root.querySelector('#editTimedTitle');
  if (timed && timedButton) timedButton.onclick = () => api.timedTitle(timed.id);
  const gallery = root.querySelector('#openTemplateGallery');
  if (gallery) gallery.onclick = () => api.navigate('templates');
  const captions = root.querySelector('#openCaptionEditor');
  const screen = root.querySelector('#openScreenEditor');
  if (captions) captions.onclick = () => api.navigate('captions');
  if (screen) screen.onclick = () => api.navigate('settings');
  return () => pending.some(check => check());
}
