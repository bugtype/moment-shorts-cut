import { bindPanelTabs } from './panel-tabs.mjs';
import { decimalTime } from './ui-format.mjs';
import { t, text, mark, attrs, setText, setValidity } from './i18n.mjs';

const renderOwners = new WeakMap();
const esc = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

export function mountEffectsPanel(root, api) {
  const owner = {};
  const pending = [];
  renderOwners.set(root, owner);
  const { state, total, tab } = api;
  const effects = state.effects;
  const select = (label, key, value, options) => (
    `<label class="panel-label" for="effect-${key}">${text(label)}</label>` +
    `<select id="effect-${key}" class="panel-select" data-effect="${key}">${options.map(([v, l]) => (
      `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''} ${mark(l)}>${esc(t(l))}</option>`
    )).join('')}</select>`
  );
  const range = (label, key, value, min, max, step = .01) => (
    `<label class="design-range"><span>${text(label)}<output data-effect-output="${key}">${value}</output></span>` +
    `<input type="range" data-effect="${key}" value="${value}" min="${min}" max="${max}" step="${step}"></label>`
  );

  root.innerHTML = (
    `<h1 class="panel-heading">${text('panels.effects')}</h1>` +
    `<div class="layer-tabs" role="tablist" ${attrs('aria-label', 'panels.effectTools')}>` +
    `<button data-effect-tab="cards" role="tab" aria-selected="${tab === 'cards'}"` +
    ` id="effect-tab-cards" aria-controls="effect-panel-cards" tabindex="${tab === 'cards' ? 0 : -1}"` +
    ` class="${tab === 'cards' ? 'active' : ''}">${text('panels.timedCards')}</button>` +
    `<button data-effect-tab="motion" role="tab" aria-selected="${tab === 'motion'}"` +
    ` id="effect-tab-motion" aria-controls="effect-panel-motion" tabindex="${tab === 'motion' ? 0 : -1}"` +
    ` class="${tab === 'motion' ? 'active' : ''}">${text('panels.motionColor')}</button></div>` +
    `${['cards', 'motion'].map(value => (
      `<div id="effect-panel-${value}" role="tabpanel" aria-labelledby="effect-tab-${value}"${tab === value ? '' : ' hidden'}>` +
      `${tab === value ? '<div id="effectControls"></div>' : ''}</div>`
    )).join('')}`
  );
  const target = root.querySelector('#effectControls');

  if (tab === 'motion') {
    target.innerHTML = (
      `${select('panels.cameraMotion', 'motion', effects.motion, [
        ['none', 'panels.fixed'],
        ['in', 'panels.zoomIn'],
        ['out', 'panels.zoomOut']
      ])}${range('panels.zoomStrength', 'strength', effects.strength, 0, .4)}` +
      `\n      ${select('panels.transition', 'transition', effects.transition, [
        ['none', 'panels.none'],
        ['fadeBlack', 'panels.fadeBlack'],
        ['flash', 'panels.flash']
      ])}${range('panels.transitionDuration', 'transitionDuration', effects.transitionDuration, .05, .7, .05)}` +
      `\n      <p class="tiny-note">${text('panels.transitionNotice')}</p><div class="design-divider"></div>` +
      `\n      ${range('panels.brightness', 'brightness', effects.brightness, .7, 1.3, .05)}` +
      `${range('panels.contrast', 'contrast', effects.contrast, .7, 1.5, .05)}` +
      `${range('panels.saturation', 'saturation', effects.saturation, 0, 1.6, .05)}` +
      `${range('panels.vignette', 'vignette', effects.vignette, 0, .6, .05)}` +
      `\n      <div class="design-divider"></div><label class="design-check">` +
      `<input type="checkbox" data-effect="progress" ${effects.progress ? 'checked' : ''}>${text('panels.progress')}</label>` +
      `\n      ${select('panels.progressPosition', 'progressPosition', effects.progressPosition, [
        ['top', 'panels.top'],
        ['bottom', 'panels.bottom']
      ])}<label class="design-color">${text('panels.barColor')}` +
      `<input type="color" data-effect="progressColor" value="${effects.progressColor}"></label>` +
      `\n      <button class="button full" id="resetEffects">${text('panels.resetEffects')}</button>`
    );

    target.querySelectorAll('[data-effect]').forEach(input => {
      const continuous = ['range', 'color'].includes(input.type);
      const update = () => {
        if (!continuous) api.snapshot();
        let value = input.type === 'checkbox' ? input.checked
          : input.type === 'range' ? Number(input.value) : input.value;
        api.update(p => p.effects[input.dataset.effect] = value);
        const output = target.querySelector(`[data-effect-output="${input.dataset.effect}"]`);
        if (output) output.textContent = input.value;
      };
      if (continuous) api.input(input, () => effects[input.dataset.effect], update);
      else input.onchange = update;
    });
    target.querySelector('#resetEffects').onclick = api.reset;
  } else {
    const card = state.overlays.find(item => item.id === api.selected) || state.overlays[0];
    const cardIndex = state.overlays.indexOf(card);
    target.innerHTML = (
      `<div class="section-label">${text('panels.cardsByTime')} <span class="muted">${state.overlays.length} / 12</span></div>` +
      `<button class="button dark full" id="addSceneCard" ${state.overlays.length >= 12 ? 'disabled' : ''}>` +
      `${text('panels.addCard')}</button>` +
      `<button class="text-button" id="toggleSceneLayers" style="margin-top:10px">${
        state.overlays.some(c => c.enabled !== false) ? text('panels.hideCards') : text('panels.showCards')
      }</button>` +
      `<p class="tiny-note">${text('panels.cardNotice')}</p>` +
      `<div class="scene-list">${state.overlays.map((item, index) => (
        `<button class="scene-list-item ${item.id === card?.id ? 'active' : ''}" data-scene-select="${esc(item.id)}">` +
        `<span>${String(index + 1).padStart(2, '0')}</span><div><strong>${
          text(item.label ? 'panels.cardSummary' : 'panels.unnamedCardSummary', {
            label: item.label,
            content: item.text
          })
        }</strong><small>${text('panels.secondsRange', {
          start: item.start.toFixed(1),
          end: item.end.toFixed(1)
        })}</small></div></button>`
      )).join('')}</div>${card ? (
        `\n      <div class="scene-editor"><div class="section-label">${text('panels.selectedCard')} ` +
        `<button class="text-button" id="removeSceneCard">${text('panels.delete')}</button></div>` +
        `\n      <div class="panel-actions scene-stacking-actions" role="group" ${attrs('aria-label', 'panels.stacking')}>` +
        `\n        <button class="button" id="sceneForward" ${cardIndex === state.overlays.length - 1 ? 'disabled' : ''}>` +
        `${text('panels.cardForward')}</button>` +
        `\n        <button class="button" id="sceneBackward" ${cardIndex === 0 ? 'disabled' : ''}>` +
        `${text('panels.cardBackward')}</button>` +
        `\n        <button class="button" id="sceneToFront" ${cardIndex === state.overlays.length - 1 ? 'disabled' : ''}>` +
        `${text('panels.front')}</button>` +
        `\n        <button class="button" id="sceneToBack" ${cardIndex === 0 ? 'disabled' : ''}>` +
        `${text('panels.back')}</button>` +
        `\n      </div>` +
        `\n      <label class="design-check"><input type="checkbox" data-card="enabled" ${card.enabled !== false ? 'checked' : ''}>` +
        `${text('panels.showCard')}</label>` +
        `\n      <label class="panel-label">${text('panels.cardRole')}<select class="panel-select" data-card="role">` +
        `<option value="headline" ${(card.role || 'headline') === 'headline' ? 'selected' : ''} ${mark('panels.roleHeadline')}>` +
        `${esc(t('panels.roleHeadline'))}</option>` +
        `<option value="free" ${card.role === 'free' ? 'selected' : ''} ${mark('panels.roleFree')}>` +
        `${esc(t('panels.roleFree'))}</option></select></label>` +
        `\n      <label class="panel-label">${text('panels.background')}<select class="panel-select" data-card="presentation">` +
        `<option value="plain" ${(card.presentation || 'plain') === 'plain' ? 'selected' : ''} ${mark('panels.backgroundPlain')}>` +
        `${esc(t('panels.backgroundPlain'))}</option>` +
        `<option value="panel" ${card.presentation === 'panel' ? 'selected' : ''} ${mark('panels.backgroundPanel')}>` +
        `${esc(t('panels.backgroundPanel'))}</option></select></label>` +
        `\n      <label class="panel-label" for="sceneLabel">${text('panels.smallLabel')}</label>` +
        `<input id="sceneLabel" class="panel-input" data-card="label" maxlength="32" value="${esc(card.label)}">` +
        `\n      <label class="panel-label" for="sceneText">${text('panels.cardText')}</label>` +
        `<textarea id="sceneText" class="panel-input" data-card="text" maxlength="90" rows="2">${esc(card.text)}</textarea>` +
        `\n      <label class="panel-label" for="sceneDetail">${text('panels.cardDetail')}</label>` +
        `<textarea id="sceneDetail" class="panel-input" data-card="detail" maxlength="130">${esc(card.detail)}</textarea>` +
        `\n      <div class="time-fields"><label>${text('panels.startSeconds')}` +
        `<input type="number" data-card="start" min="0" max="${total}" step="any" value="${decimalTime(card.start)}"></label>` +
        `<label>${text('panels.endSeconds')}` +
        `<input type="number" data-card="end" min="0" max="${total}" step="any" value="${decimalTime(card.end)}"></label></div>` +
        `\n      <button class="button" id="moveSceneTime">${text('panels.moveCardTime')}</button>` +
        `\n      <p class="tiny-note">${text('panels.cardTimingNotice')}</p>` +
        `\n      <label class="panel-label">${text('panels.cardKind')}<select class="panel-select" data-card="kind">` +
        `<option value="card" ${card.kind === 'card' ? 'selected' : ''} ${mark('panels.normalCard')}>` +
        `${esc(t('panels.normalCard'))}</option>` +
        `<option value="countdown" ${card.kind === 'countdown' ? 'selected' : ''} ${mark('panels.countdown')}>` +
        `${esc(t('panels.countdown'))}</option></select></label>` +
        `\n      <label class="panel-label">${text('panels.animation')}<select class="panel-select" data-card="animation">${[
          ['none', 'panels.none'],
          ['fade', 'panels.fade'],
          ['slide', 'panels.slide'],
          ['pop', 'panels.pop']
        ].map(([v, l]) => (
          `<option value="${v}" ${card.animation === v ? 'selected' : ''} ${mark(l)}>${esc(t(l))}</option>`
        )).join('')}</select></label>` +
        `\n      <div class="design-colors">${[
          ['color', 'panels.text'],
          ['accent', 'panels.accent'],
          ['background', 'panels.background']
        ].map(([key, label]) => (
          `<label class="design-color">${text(label)}<input type="color" data-card="${key}" value="${card[key]}"></label>`
        )).join('')}</div>` +
        `\n      ${[
          ['x', 'panels.horizontal', .1, .9, .01],
          ['y', 'panels.vertical', .08, .8, .01],
          ['width', 'panels.cardWidth', .4, .82, .01],
          ['size', 'panels.textSize', 20, 48, 1],
          ['stroke', 'panels.blackStroke', 0, 6, .5],
          ['backgroundOpacity', 'panels.backgroundOpacity', 0, 1, .05]
        ].map(([key, label, min, max, step]) => (
          `<label class="design-range"><span>${text(label)}<output data-card-output="${key}">${card[key]}</output></span>` +
          `<input type="range" data-card="${key}" value="${card[key]}" min="${min}" max="${max}" step="${step}"></label>`
        )).join('')}` +
        `\n      <button class="button" id="openCardPosition">${text('panels.position')}</button>` +
        `\n      <div class="panel-actions scene-appearance-actions" role="group" ${attrs('aria-label', 'panels.cardStyle')}>` +
        `<button class="button" id="copySceneAppearance">${text('panels.copyStyle')}</button>` +
        `<button class="button" id="pasteSceneAppearance" ${api.hasCopiedAppearance ? '' : 'disabled'}>` +
        `${text('panels.pasteStyle')}</button></div>` +
        `<div class="panel-actions"><button class="button" id="duplicateSceneCard">${text('panels.duplicateCard')}</button>` +
        `<button class="button" id="previewSceneCard">${text('panels.previewCard')}</button></div></div>`
      ) : `<p class="empty-text">${text('panels.cardEmpty')}</p>`}`
    );

    target.querySelector('#addSceneCard').onclick = api.add;
    target.querySelector('#toggleSceneLayers').onclick = api.toggleAll;
    target.querySelectorAll('[data-scene-select]').forEach(button => {
      button.onclick = () => api.select(button.dataset.sceneSelect);
    });
    if (card) {
      let composing = false;
      target.oncompositionstart = () => { composing = true; };
      target.oncompositionend = () => { composing = false; };
      const position = target.querySelector('#openCardPosition');
      position.onclick = event => {
        if (
          composing || event?.isComposing || event?.keyCode === 229 ||
          renderOwners.get(root) !== owner || root.querySelector('#effectControls') !== target ||
          api.current?.() === false
        ) return;
        api.position?.(card.id);
      };
      const moveTime = target.querySelector('#moveSceneTime');
      moveTime.onclick = event => {
        if (
          composing || event?.isComposing || event?.keyCode === 229 ||
          renderOwners.get(root) !== owner || root.querySelector('#effectControls') !== target ||
          api.current?.() === false
        ) return;
        api.moveTime(card.id);
      };
      for (const [id, action] of [
        ['copySceneAppearance', 'copyAppearance'],
        ['pasteSceneAppearance', 'pasteAppearance']
      ]) {
        target.querySelector('#' + id).onclick = () => {
          if (
            renderOwners.get(root) !== owner || root.querySelector('#effectControls') !== target ||
            api.current?.() === false
          ) return;
          if (!api[action](card.id)) return;
          const button = root.querySelector('#effectControls')?.querySelector('#' + id);
          if (button && !button.disabled) button.focus();
        };
      }

      const stackActions = [
        ['sceneForward', cardIndex + 1, 'sceneBackward'],
        ['sceneBackward', cardIndex - 1, 'sceneForward'],
        ['sceneToFront', state.overlays.length - 1, 'sceneToBack'],
        ['sceneToBack', 0, 'sceneToFront']
      ];
      for (const [id, toIndex, opposite] of stackActions) {
        const button = target.querySelector('#' + id);
        button.onclick = event => {
          if (
            composing || event?.isComposing || event?.keyCode === 229 ||
            renderOwners.get(root) !== owner || root.querySelector('#effectControls') !== target ||
            target.querySelector('#' + id) !== button || api.current?.() === false || api.canMoveCard?.(card.id) === false ||
            toIndex < 0 || toIndex >= state.overlays.length || state.overlays[toIndex] === card
          ) return;
          if (!api.move(card.id, toIndex)) return;
          const controls = root.querySelector('#effectControls');
          const preferred = controls?.querySelector('#' + id);
          const other = controls?.querySelector('#' + opposite);
          const focusTarget = preferred && !preferred.disabled ? preferred
            : other && !other.disabled ? other
            : [...(controls?.querySelectorAll('[data-scene-select]') || [])]
              .find(item => item.dataset.sceneSelect === card.id);
          focusTarget?.focus({ preventScroll: true });
        };
      }
      target.querySelector('#removeSceneCard').onclick = () => api.remove(card.id);
      const duplicate = target.querySelector('#duplicateSceneCard');
      duplicate.onclick = event => {
        if (
          composing || event?.isComposing || event?.keyCode === 229 || duplicate.disabled ||
          duplicate.isConnected === false || renderOwners.get(root) !== owner ||
          root.querySelector('#effectControls') !== target || target.querySelector('#duplicateSceneCard') !== duplicate ||
          api.current?.() === false || api.tabCurrent?.() === false
        ) return;
        if (!api.duplicate(card.id) || api.current?.() === false || api.tabCurrent?.() === false) return;
        const button = root.querySelector('#effectControls')?.querySelector('#duplicateSceneCard');
        if (button && !button.disabled && button.isConnected !== false) button.focus({ preventScroll: true });
      };
      target.querySelector('#previewSceneCard').onclick = () => api.play(card.start);
      target.querySelectorAll('[data-card]').forEach(input => {
        const continuous = ['text', 'range', 'color', 'textarea'].includes(input.type);
        const current = () => renderOwners.get(root) === owner && root.querySelector('#effectControls') === target &&
          api.current?.() !== false && api.inputCurrent?.() !== false &&
          state.overlays.find(item => item.id === card.id) === card && input.isConnected !== false &&
          [...target.querySelectorAll('[data-card]')].includes(input);
        const update = () => {
          if (!current()) return;
          const key = input.dataset.card;
          const value = input.type === 'checkbox' ? input.checked
            : ['range', 'number'].includes(input.type) ? Number(input.value) : input.value;
          if (key === 'start' || key === 'end') {
            const start = key === 'start' ? value : card.start;
            const end = key === 'end' ? value : card.end;
            if (!input.value.trim() || !Number.isFinite(value) || start < 0 || end <= start || end > total) {
              setValidity(input, 'panels.cardTimingInvalid');
              input.reportValidity();
              return;
            }
          }
          setValidity(input, '');
          if (!continuous) api.snapshot();
          api.update(p => p.overlays.find(item => item.id === card.id)[key] = value);
          const item = [...target.querySelectorAll('[data-scene-select]')]
            .find(button => button.dataset.sceneSelect === card.id);
          if (item) {
            setText(
              item.querySelector('strong'),
              card.label ? 'panels.cardSummary' : 'panels.unnamedCardSummary',
              { label: card.label, content: card.text }
            );
            setText(
              item.querySelector('small'),
              'panels.secondsRange',
              { start: card.start.toFixed(1), end: card.end.toFixed(1) }
            );
          }
          const output = target.querySelector(`[data-card-output="${key}"]`);
          if (output) output.textContent = input.value;
        };
        let composing;
        if (continuous) composing = api.input(input, () => card[input.dataset.card], update, current);
        else {
          input.onchange = update;
          if (input.type === 'number') {
            let active = false;
            input.oncompositionstart = () => { if (current()) active = true; };
            input.oncompositionend = () => { if (current()) active = false; };
            composing = () => active;
          }
        }
        if (['text', 'textarea', 'number'].includes(input.type)) {
          const key = input.dataset.card, initial = card[key], displayed = input.value;
          pending.push(() => {
            if (!current()) return false;
            const value = card[key], numeric = input.type === 'number';
            if (composing?.() || (numeric && (input.validity?.badInput || input.value === ''))) return true;
            if (value === initial && input.value === displayed) return false;
            if (numeric) return !Number.isFinite(input.valueAsNumber) || input.valueAsNumber !== value;
            return input.value !== value;
          });
        }
      });
    }
  }
  bindPanelTabs(root, {
    selector: '[data-effect-tab]',
    key: 'effectTab',
    active: tab,
    select: api.changeTab,
    current: () => renderOwners.get(root) === owner && api.current?.() !== false && api.tabCurrent?.() !== false,
    contextCurrent: () => api.current?.() !== false && api.tabCurrent?.() !== false
  });
  return () => pending.some(check => check());
}
