import { text, setText, message } from './i18n.mjs';
import { createDemoProject } from './core/project.mjs';
import { applyTemplate, REFERENCE_SOURCES, templateCategoryKey } from './template-catalog.mjs';
import { esc } from './ui-format.mjs';

export function createTemplatePreview({ composition, getMedia, modal, openModal: modalOpen, query: $, onApply }, {
    requestFrame = callback => requestAnimationFrame(callback),
    cancelFrame = frame => cancelAnimationFrame(frame),
    clock = () => performance.now(),
} = {}) {
    const demos = new WeakMap();
    let frame = 0;
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

    function draw(target, template, fraction = .4) {
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
        const reference = REFERENCE_SOURCES[template.source];
        modalOpen(template.custom ? template.name : message('templates.builtin.'+template.id+'.name'), previewBody(template, reference), '<div class="modal-foot">' +
            `<button class="button" id="applyTemplateStructure">${text('templates.applyContent')}</button>` +
            `<button class="button primary" id="applyTemplateStyle">${text('templates.applyStyle')}</button>` +
            '</div>');
        modal.classList.add('template-modal');
        draw($('#templateDemo'), template, .4);
        let started = 0, running = false, lastPreview = -Infinity;
        const stop = () => {
            running = false;
            if (frame)
                cancelFrame(frame);
            frame = 0;
        };
        const animate = now => {
            if (!modal.open || !running) {
                stop();
                return;
            }
            if (now - lastPreview >= 1000 / 30) {
                draw($('#templateDemo'), template, ((now - started) % 12000) / 12000);
                lastPreview = now;
            }
            frame = requestFrame(animate);
        };
        $('#toggleTemplateDemo').onclick = () => {
            if (running) {
                stop();
                setText($('#toggleTemplateDemo'), 'templates.play');
            }
            else {
                running = true;
                started = clock();
                setText($('#toggleTemplateDemo'), 'templates.pause');
                frame = requestFrame(animate);
            }
        };
        modal.onclose = stop;
        const apply = withContent => {
            stop();
            onApply(template, withContent);
        };
        $('#applyTemplateStyle').onclick = () => apply(false);
        $('#applyTemplateStructure').onclick = () => apply(true);
    }
    return { draw, open };
}

function previewBody(template, reference) {
    return (
        `<div class="template-preview-layout">` +
        `<div class="template-demo-stage">` +
        `<canvas id="templateDemo" width="432" height="768">` +
        `</canvas>` +
        `<button class="button" id="toggleTemplateDemo">${text('templates.play')}</button>` +
        `<small>${text('templates.sample')}</small>` +
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
