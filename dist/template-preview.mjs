import { text, setText, message, attrs, mark, t } from './i18n.mjs';
import { createDemoProject } from './core/project.mjs';
import { applyTemplate, REFERENCE_SOURCES, templateCategoryKey } from './template-catalog.mjs';
import { esc } from './ui-format.mjs';

export function createTemplatePreview({ composition, getMedia, modal, openModal: modalOpen, query: $, onApply, scene = () => null }, {
    requestFrame = callback => requestAnimationFrame(callback),
    cancelFrame = frame => cancelAnimationFrame(frame),
    clock = () => performance.now(),
} = {}) {
    const demos = new WeakMap();
    let generation = 0, disposePrevious = () => {};
    function templateProject(template) {
        if (demos.has(template))
            return demos.get(template);
        const p = createDemoProject();
        applyTemplate(p, template, true);
        p.globalKeywords = p.globalKeywords || '순간, 속도';
        if (template.id === 'interview')
            p.captions.forEach((cap, i) => cap.speaker = String(i % 2));
        demos.set(template, p);
        return p;
    }

    function draw(target, template, fraction = template.hook ? 0 : .4) {
        const { source, ready } = getMedia();
        const p = templateProject(template), t = Math.max(0, Math.min(.999, fraction)) * 12;
        composition.draw(target.getContext('2d'), target.width, target.height, p, {
            source,
            sw: 540,
            sh: 960,
            ready,
            sourceTime: t,
            time: t,
            total: 12,
            elapsed: t,
            remaining: 12 - t,
            progress: t / 12
        });
    }

    function open(template) {
        disposePrevious();
        const owner = ++generation, templateSignature = JSON.stringify(template), context = scene();
        let snapshot = null, styled = null, mode = 'sample', frame = 0, disposed = false;
        const reference = REFERENCE_SOURCES[template.source];
        modalOpen(template.custom ? template.name : message('templates.builtin.'+template.id+'.name'), previewBody(template, reference), '<div class="modal-foot">' +
            `<button class="button" id="applyTemplateStructure">${text('templates.applyContent')}</button>` +
            `<button class="button primary" id="applyTemplateStyle">${text('templates.applyStyle')}</button>` +
            '</div>');
        modal.classList.add('template-modal');
        const canvas = $('#templateDemo'), modeInput = $('#templatePreviewMode');
        const current = () => !disposed && owner === generation && modal.open && $('#templateDemo') === canvas;
        const valid = () => current() && JSON.stringify(template) === templateSignature && (!context || context.valid());
        modeInput.value = 'sample';
        modeInput.options && (modeInput.options[1].disabled = !context?.canCapture());
        const showSample = () => { canvas.width = 432; canvas.height = 768; canvas.style.aspectRatio = '9 / 16'; draw(canvas, template); };
        showSample();
        let started = 0, running = false, lastPreview = -Infinity;
        const stop = () => {
            running = false;
            if (frame)
                cancelFrame(frame);
            frame = 0;
        };
        const animate = now => {
            const validScene = valid();
            if (!validScene || !running) {
                stop();
                if (!validScene && current()) {
                    setText($('#toggleTemplateDemo'), 'templates.play');
                    setText($('#templateSceneStatus'), 'templates.sceneStale');
                }
                return;
            }
            if (now - lastPreview >= 1000 / 30) {
                draw($('#templateDemo'), template, ((now - started) % 12000) / 12000);
                lastPreview = now;
            }
            frame = requestFrame(animate);
        };
        const composing = event => event?.isComposing || event?.keyCode === 229;
        $('#toggleTemplateDemo').onclick = event => {
            if (!current() || composing(event) || mode !== 'sample') return;
            if (running) {
                stop();
                setText($('#toggleTemplateDemo'), 'templates.play');
            }
            else {
                const validScene = valid();
                if (!current()) return;
                const status = $('#templateSceneStatus');
                if (!validScene) {
                    setText(status, 'templates.sceneStale');
                    return;
                }
                if (status.getAttribute('data-i18n') === 'templates.sceneStale') {
                    status.textContent = '';
                    status.removeAttribute('data-i18n');
                }
                running = true;
                started = clock();
                setText($('#toggleTemplateDemo'), 'templates.pause');
                frame = requestFrame(animate);
            }
        };
        const dispose = () => { disposed = true; stop(); snapshot?.release(); snapshot = styled = null; };
        disposePrevious = dispose;
        modal.onreplace = dispose;
        modal.onclose = () => { if (!modal.open) dispose(); };
        const compare = selected => {
            if (!current()) return;
            if (!valid()) { setText($('#templateSceneStatus'), 'templates.sceneStale'); return; }
            if (!context?.canCapture()) { setText($('#templateSceneStatus'), 'templates.sceneUnavailable'); return; }
            try {
                if (!snapshot) {
                    snapshot = context.capture();
                    if (!snapshot) throw new Error('Unavailable frame');
                    styled = structuredClone(snapshot.project);
                    applyTemplate(styled, template, false);
                }
                if (snapshot.valid?.() === false) throw new Error('Unavailable frame');
                $('#templateSceneStatus').textContent = '';
                $('#templateSceneStatus').removeAttribute('data-i18n');
                const project = selected ? styled : snapshot.project, [w, h] = project.ratio.split(':').map(Number);
                canvas.width = Math.round(432 * w / Math.max(w, h)); canvas.height = Math.round(432 * h / Math.max(w, h));
                canvas.style.aspectRatio = `${w} / ${h}`;
                composition.draw(canvas.getContext('2d'), canvas.width, canvas.height, project, snapshot.media);
                $('#templateCurrentStyle').setAttribute('aria-pressed', String(!selected));
                $('#templateSelectedStyle').setAttribute('aria-pressed', String(selected));
            } catch { snapshot?.release(); snapshot = styled = null; setText($('#templateSceneStatus'), 'templates.sceneUnavailable'); }
        };
        modeInput.onchange = event => {
            if (!current() || composing(event)) return;
            stop(); mode = modeInput.value;
            $('#toggleTemplateDemo').hidden = mode !== 'sample';
            $('#templateSceneCompare').hidden = mode === 'sample';
            $('#templateSampleLabel').hidden = mode !== 'sample';
            setText($('#toggleTemplateDemo'), 'templates.play');
            if (mode === 'sample') showSample(); else compare(true);
        };
        $('#templateCurrentStyle').onclick = event => { if (!composing(event) && mode !== 'sample') compare(false); };
        $('#templateSelectedStyle').onclick = event => { if (!composing(event) && mode !== 'sample') compare(true); };
        const apply = (withContent, event) => {
            if (composing(event) || !current()) return;
            if (!valid()) { setText($('#templateSceneStatus'), 'templates.sceneStale'); return; }
            if (context && !context.canApply()) return;
            stop();
            onApply(template, withContent);
        };
        $('#applyTemplateStyle').onclick = event => apply(false, event);
        $('#applyTemplateStructure').onclick = event => apply(true, event);
    }
    return { draw, open };
}

function previewBody(template, reference) {
    return (
        `<div class="template-preview-layout">` +
        `<div class="template-demo-stage">` +
        `<select id="templatePreviewMode" ${attrs('aria-label','templates.previewMode')}><option value="sample" ${mark('templates.sampleMode')}>${t('templates.sampleMode')}</option><option value="current" ${mark('templates.currentScene')}>${t('templates.currentScene')}</option></select>` +
        `<div id="templateSceneCompare" class="template-scene-compare" hidden><button class="button" id="templateCurrentStyle" aria-pressed="false">${text('templates.currentStyle')}</button><button class="button" id="templateSelectedStyle" aria-pressed="true">${text('templates.selectedStyle')}</button></div>` +
        `<p id="templateSceneStatus" role="status"></p>` +
        `<canvas id="templateDemo" width="432" height="768">` +
        `</canvas>` +
        `<button class="button" id="toggleTemplateDemo">${text('templates.play')}</button>` +
        `<small id="templateSampleLabel">${text('templates.sample')}</small>` +
        `</div>` +
        `<div class="template-details">` +
        `<span class="template-category">${template.custom&&template.category!=='내 템플릿'?esc(template.category):text(templateCategoryKey(template.category))}</span>` +
        `<p class="modal-copy">${template.custom?esc(template.description):text('templates.builtin.'+template.id+'.description')}</p>` +
        `<div class="template-flow">${template.flow.map((line, i) => (
            `<div>` +
            `<b>${i + 1}</b>` +
            `<span>${template.custom?esc(line):text('templates.builtin.'+template.id+'.flow'+i)}</span>` +
            `</div>`
        )).join('')}</div>` +
        (template.hook ? `<p class="notice">${text('templates.hookTiming')}<br>${text('templates.hookCover')}</p>` : '') +
        `<div class="notice">` +
        `<strong>${text('templates.applyStyle')}</strong>` +
        `<br>${text('templates.keepContent')}<br>` +
        `<br>` +
        `<strong>${text('templates.applyContent')}</strong>` +
        `<br>${text('templates.replaceContent')}</div>${reference ? (
            `<a class="reference-link" href="${reference.url}" target="_blank" rel="noopener noreferrer">${text('templates.reference')}</a>`
        ) : ''}</div>` +
        `</div>`
    );
}
