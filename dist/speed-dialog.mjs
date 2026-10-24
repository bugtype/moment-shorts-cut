import {decimalTime} from './ui-format.mjs';
import {text, message, setAttr} from './i18n.mjs';

const presetSpeeds = [.5, .75, 1, 1.25, 1.5, 2];
// Keep imported/API rates visible without replacing the select or other drafts.
export function syncSpeedControl(select, currentOption, speed) {
    const exact = decimalTime(speed), custom = !presetSpeeds.includes(speed);
    currentOption.hidden = !custom;
    currentOption.value = custom ? exact : '';
    currentOption.textContent = custom ? `${exact}×` : '';
    select.value = exact;
    setAttr(select, 'title', 'shell.currentSpeed', {speed: exact});
    setAttr(select, 'aria-label', 'shell.currentSpeed', {speed: exact});
}

export function createSpeedDialog({getProject, getMedia, query: $, modal, openModal, blocked, execute, toast}) {
    let generation = 0;
    function open() {
        const project = getProject();
        syncSpeedControl($('#speed'), $('#currentSpeedOption'), project.speed);
        if (blocked()) { toast(message('shell.speedBusy')); return; }
        const owner = ++generation, contents = JSON.stringify(project), media = getMedia();
        openModal(message('shell.customSpeed'), `<label class="panel-label" for="customSpeedValue">${text('shell.speedMultiplier')}</label><input class="panel-input" id="customSpeedValue" type="number" min="0.25" max="4" step="any" inputmode="decimal">`, `<div class="modal-foot"><button class="button" id="cancelCustomSpeed">${text('shell.cancel')}</button><button class="button primary" id="confirmCustomSpeed">${text('shell.applySpeed')}</button></div>`);
        const input = $('#customSpeedValue'), confirm = $('#confirmCustomSpeed');
        const owns = () => generation === owner && modal.open && $('#confirmCustomSpeed') === confirm;
        input.value = decimalTime(project.speed);
        modal.onclose = () => { if (generation === owner && !modal.open) generation++; };
        const close = () => { generation++; modal.close(); $('#speed').focus(); };
        $('#cancelCustomSpeed').onclick = () => { if (owns()) close(); };
        confirm.onclick = () => {
            if (!owns()) return;
            if (blocked()) { toast(message('shell.speedBusy')); return; }
            const currentMedia = getMedia();
            if (getProject() !== project || JSON.stringify(getProject()) !== contents || media.some((source, index) => source !== currentMedia[index])) {
                toast(message('shell.speedStale')); return;
            }
            const speed = input.value.trim() === '' ? NaN : Number(input.value);
            if (!Number.isFinite(speed) || speed < .25 || speed > 4) {
                toast(message('shell.speedRange')); input.focus(); return;
            }
            if (speed === project.speed) { close(); return; }
            if (execute('project.update', {patch: {speed}}) && owns()) close();
        };
        input.onkeydown = event => {
            if (!owns() || event.defaultPrevented || event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
            event.preventDefault(); confirm.onclick();
        };
        input.focus();
    }
    function change(value) {
        if (value === 'custom') return open();
        if (blocked()) toast(message('shell.speedBusy'));
        else execute('project.update', {patch: {speed: Number(value)}});
        syncSpeedControl($('#speed'), $('#currentSpeedOption'), getProject().speed);
    }
    return {open, change};
}
