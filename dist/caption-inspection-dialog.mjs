import {prepareCommand} from './core/commands.mjs';

// Own report presentation and navigation, never project edits or persistent settings.
export function createCaptionInspectionDialog({getProject, query: $, modal, openModal, blocked, pause, seek, focusCaption, toast}) {
    let generation = 0;
    function open() {
        const owner = ++generation;
        let reportGeneration = 0;
        openModal('자막 읽기 속도 검사',
            '<label class="panel-label" for="captionInspectionThreshold">검사 기준 · 공백 제외 결합 문자/초</label><div class="panel-actions"><input class="panel-input" id="captionInspectionThreshold" type="number" min="0" step="any" required><button class="button primary" id="runCaptionInspection">검사</button></div><p class="modal-copy">직접 정한 기준으로 검토합니다. 언어별 납품 기준이나 음성 일치 여부를 판정하지 않습니다.</p><div id="captionInspectionResults" aria-live="polite"></div>');
        const input = $('#captionInspectionThreshold'), run = $('#runCaptionInspection'), results = $('#captionInspectionResults');
        const owns = () => generation === owner && modal.open && $('#runCaptionInspection') === run;
        modal.onclose = () => { if (generation === owner && !modal.open) generation++; };
        input.oninput = () => { if (owns()) { reportGeneration++; results.innerHTML = ''; } };
        run.onclick = () => {
            if (!owns()) return;
            const reportOwner = ++reportGeneration;
            results.innerHTML = '';
            try {
                const threshold = input.value.trim() === '' ? NaN : Number(input.value);
                const project = getProject(), contents = JSON.stringify(project);
                const report = prepareCommand(project, 'captions.inspect', {maxGraphemesPerSecond: threshold, limit: 20}).data;
                results.innerHTML = `<p role="status">출력 자막 ${report.totalOccurrences}개 · 기준 초과 ${report.flaggedOccurrences}개 · 생략 ${report.omittedOccurrences}개</p>` +
                    (report.issues.length ? '<div class="caption-inspection-table"><table><thead><tr><th scope="col">출력 초</th><th scope="col">문자/초</th><th scope="col">확인</th></tr></thead><tbody>' + report.issues.map((issue, index) =>
                        `<tr><td>${issue.start.toFixed(2)}–${issue.end.toFixed(2)}</td><td title="${issue.graphemesPerSecond}">${issue.graphemesPerSecond.toFixed(2)}</td><td><div class="panel-actions"><button class="button" id="inspectCaption${index}" aria-label="자막 ${issue.captionIndex + 1} 편집">자막</button><button class="button" id="inspectOccurrence${index}" aria-label="출력 자막 ${issue.occurrenceIndex + 1} 구간 보기">구간 보기</button></div></td></tr>`
                    ).join('') + '</tbody></table></div>' : '');
                report.issues.forEach((issue, index) => {
                    for (const [prefix, move] of [['inspectCaption', false], ['inspectOccurrence', true]]) {
                        const selector = `#${prefix}${index}`, button = $(selector);
                        button.onclick = () => {
                            if (!owns() || reportOwner !== reportGeneration || $(selector) !== button) return;
                            if (getProject() !== project || JSON.stringify(getProject()) !== contents) {
                                reportGeneration++;
                                results.innerHTML = '<p role="status">프로젝트가 바뀌었습니다. 다시 검사하세요.</p>';
                                return;
                            }
                            if (blocked()) { toast('진행 중인 작업이 끝난 뒤 확인하세요.'); return; }
                            generation++;
                            modal.close();
                            if (move) { pause(); seek(issue.start * project.speed); }
                            focusCaption(issue.captionIndex);
                        };
                    }
                });
            } catch (error) {
                toast(error.message || '자막을 검사하지 못했습니다.');
                input.focus();
            }
        };
        input.focus();
    }
    return {open};
}
