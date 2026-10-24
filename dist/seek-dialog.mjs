// User-entered output time, not a source-frame or audio-sample address.
export function parseOutputTime(value) {
    const text = value.trim();
    if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(text))
        throw new Error('초 또는 분:초, 시:분:초 형식으로 입력하세요.');
    const parts = text.split(':').map(Number);
    if (parts.slice(1).some(part => part >= 60))
        throw new Error('분·초 자리는 60보다 작아야 합니다.');
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    if (!Number.isFinite(seconds)) throw new Error('유한한 시간을 입력하세요.');
    return seconds;
}

// Preserve the current numeric value without exponent notation or rounding past the end.
export function decimalTime(value) {
    const [coefficient, exponent] = String(value).split('e');
    if (exponent === undefined) return coefficient;
    const [whole, fraction = ''] = coefficient.split('.');
    const digits = whole + fraction, point = whole.length + Number(exponent);
    if (point <= 0) return '0.' + '0'.repeat(-point) + digits;
    if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
    return digits.slice(0, point) + '.' + digits.slice(point);
}

export function createSeekDialog({getProject, getCurrent, getDuration, getMedia, query: $, modal, openModal, blocked, pause, seek, toast}) {
    let generation = 0;
    function open() {
        if (blocked()) { toast('진행 중인 작업이 끝난 뒤 이동하세요.'); return; }
        const owner = ++generation, project = getProject(), contents = JSON.stringify(project);
        const media = getMedia(), duration = getDuration() / project.speed;
        openModal('출력 시간으로 이동', '<label class="panel-label" for="outputSeekTime">출력 시간</label><input class="panel-input" id="outputSeekTime" type="text" inputmode="decimal" placeholder="12.5 · 01:23.5 · 01:02:03.5" autocomplete="off">', '<div class="modal-foot"><button class="button" id="cancelOutputSeek">취소</button><button class="button primary" id="confirmOutputSeek">이동</button></div>');
        const input = $('#outputSeekTime'), confirm = $('#confirmOutputSeek'), cancel = $('#cancelOutputSeek');
        const owns = () => generation === owner && modal.open && $('#confirmOutputSeek') === confirm;
        input.value = decimalTime(Math.max(0, Math.min(duration, getCurrent() / project.speed)));
        modal.onclose = () => { if (generation === owner && !modal.open) generation++; };
        const close = () => { generation++; modal.close(); $('#timeDisplay').focus(); };
        cancel.onclick = () => { if (owns()) close(); };
        confirm.onclick = () => {
            if (!owns()) return;
            if (blocked()) { toast('진행 중인 작업이 끝난 뒤 이동하세요.'); return; }
            const currentMedia = getMedia();
            if (getProject() !== project || JSON.stringify(getProject()) !== contents || media.some((source, index) => source !== currentMedia[index])) {
                toast('프로젝트가 바뀌었습니다. 이동 창을 다시 여세요.');
                return;
            }
            try {
                const time = parseOutputTime(input.value);
                if (time > duration) throw new Error('출력 길이 안의 시간을 입력하세요.');
                close();
                pause();
                seek(time * project.speed);
            } catch (error) { toast(error.message); input.focus(); }
        };
        input.onkeydown = event => {
            if (!owns() || event.defaultPrevented || event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
            event.preventDefault();
            confirm.onclick();
        };
        input.focus();
    }
    return {open};
}
