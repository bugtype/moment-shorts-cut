import { createDemoProject } from './core/project.mjs';
import { applyTemplate, REFERENCE_SOURCES } from './template-catalog.mjs';
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
        modalOpen(esc(template.name), previewBody(template, reference), '<div class="modal-foot">' +
            '<button class="button" id="applyTemplateStructure">예시 구성까지 적용</button>' +
            '<button class="button primary" id="applyTemplateStyle">스타일만 적용</button>' +
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
                $('#toggleTemplateDemo').textContent = '▶ 예시 재생';
            }
            else {
                running = true;
                started = clock();
                $('#toggleTemplateDemo').textContent = 'Ⅱ 일시정지';
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
        `<button class="button" id="toggleTemplateDemo">▶ 예시 재생</button>` +
        `<small>샘플 그래픽 · 12초 미리보기</small>` +
        `</div>` +
        `<div class="template-details">` +
        `<span class="template-category">${esc(template.category)}</span>` +
        `<p class="modal-copy">${esc(template.description)}</p>` +
        `<div class="template-flow">${template.flow.map((line, i) => (
            `<div>` +
            `<b>${i + 1}</b>` +
            `<span>${esc(line)}</span>` +
            `</div>`
        )).join('')}</div>` +
        `<div class="notice">` +
        `<strong>스타일만 적용</strong>` +
        `<br>기존 타이틀 문구·자막·카드를 유지합니다.<br>` +
        `<br>` +
        `<strong>예시 구성까지 적용</strong>` +
        `<br>예시 타이틀·크레딧·구간별 문구로 교체합니다. 대사 자막과 영상은 유지됩니다. 실행 취소할 수 있습니다.</div>${reference ? (
            `<a class="reference-link" href="${reference.url}" target="_blank" rel="noopener noreferrer">참고한 공식 자료 ↗</a>`
        ) : ''}</div>` +
        `</div>`
    );
}
