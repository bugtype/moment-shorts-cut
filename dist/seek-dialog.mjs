import { dialogEnterBlocked } from './dialog-enter.mjs';
import { decimalTime } from './ui-format.mjs';
export { decimalTime } from './ui-format.mjs';
import {text, message} from './i18n.mjs';
// User-entered output time, not a source-frame or audio-sample address.
export function parseOutputTime(value) {
    const text = value.trim();
    if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(text))
        throw Object.assign(new Error(), message("shell.seekFormat"));
    const parts = text.split(':').map(Number);
    if (parts.slice(1).some(part => part >= 60))
        throw Object.assign(new Error(), message("shell.seekComponents"));
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    if (!Number.isFinite(seconds)) throw Object.assign(new Error(), message("shell.seekFinite"));
    return seconds;
}

export function createSeekDialog({getProject, getCurrent, getDuration, getMedia, query: $, modal, openModal, blocked, pause, seek, toast}) {
    let generation = 0;
    function open() {
        if (blocked()) { toast(message("shell.seekBusy")); return; }
        const owner = ++generation, project = getProject(), contents = JSON.stringify(project);
        const media = getMedia(), duration = getDuration() / project.speed;
        openModal(message("shell.seekTitle"), `<label class="panel-label" for="outputSeekTime">${text("shell.seekLabel")}</label><input class="panel-input" id="outputSeekTime" type="text" inputmode="decimal" placeholder="12.5 · 01:23.5 · 01:02:03.5" autocomplete="off">`, `<div class="modal-foot"><button class="button" id="cancelOutputSeek">${text("shell.cancel")}</button><button class="button primary" id="confirmOutputSeek">${text("shell.move")}</button></div>`);
        const input = $('#outputSeekTime'), confirm = $('#confirmOutputSeek'), cancel = $('#cancelOutputSeek');
        const owns = () => generation === owner && modal.open && $('#confirmOutputSeek') === confirm;
        input.value = decimalTime(Math.max(0, Math.min(duration, getCurrent() / project.speed)));
        modal.onclose = () => { if (generation === owner && !modal.open) generation++; };
        const close = () => { generation++; modal.close(); $('#timeDisplay').focus(); };
        cancel.onclick = () => { if (owns()) close(); };
        confirm.onclick = () => {
            if (!owns()) return;
            if (blocked()) { toast(message("shell.seekBusy")); return; }
            const currentMedia = getMedia();
            if (getProject() !== project || JSON.stringify(getProject()) !== contents || media.some((source, index) => source !== currentMedia[index])) {
                toast(message("shell.seekStale"));
                return;
            }
            try {
                const time = parseOutputTime(input.value);
                if (time > duration) throw Object.assign(new Error(), message("shell.seekRange"));
                close();
                pause();
                seek(time * project.speed);
            } catch (error) { toast(error); input.focus(); }
        };
        input.onkeydown = event => {
            if (!owns() || dialogEnterBlocked(event)) return;
            event.preventDefault();
            confirm.onclick();
        };
        input.focus();
    }
    return {open};
}
