import { LocalizedError } from './core/validation.mjs';
import { message as msg, formatError } from './i18n.mjs';
import { createProjectDocument, projectSubtitles, assertProjectFileSize } from './core/project.mjs';
import { CommandError } from './core/validation.mjs';
import { parseSubtitles, MAX_SUBTITLE_BYTES } from './captions.mjs';

// JSON and subtitle imports share one request owner so neither can overwrite a newer import.
export function createTextFileWorkflow({
    getProject, execute, query: $, closeModal, focusImportedCaption,
    settingsUnavailable, download, toast,
}) {
    async function readUtf8File(file, settingsFile = false) {
        const bytes = await file.arrayBuffer();
        if (settingsFile) assertProjectFileSize(bytes.byteLength);
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        }
        catch {
            throw new LocalizedError(msg('errors.utf8'));
        }
    }
    let textImportRequest = 0;
    function guardTextImport() {
        const request = ++textImportRequest, original = getProject(), contents = JSON.stringify(getProject());
        return () => {
            if (request !== textImportRequest || getProject() !== original || JSON.stringify(getProject()) !== contents)
                throw new CommandError('CONFLICT', msg('errors.importConflict'));
        };
    }
    async function importProjectSettings(file, closeImportedDialog = closeModal) {
        try {
            const beforeCommit = guardTextImport();
            assertProjectFileSize(file.size);
            const result = await execute('project.import', { document: JSON.parse(await readUtf8File(file, true)) }, beforeCommit);
            if (!result.ok)
                throw new Error(result.error.message);
            closeImportedDialog();
            toast(msg('errors.settingsApplied'));
            return result;
        }
        catch (error) {
            toast((error.messageKey ? error : error.message) || msg('errors.settingsCheck'));
            return { ok: false, error: { code: 'IMPORT_FAILED', message: formatError(error) } };
        }
        finally {
            $('#projectInput').value = '';
        }
    }
    function downloadProjectSettings() {
        if (settingsUnavailable())
            return;
        try {
            const project = getProject();
            const blob = new Blob([JSON.stringify(createProjectDocument(project), null, 2)], { type: 'application/json' });
            assertProjectFileSize(blob.size);
            download(blob, `${project.name || 'moment'}.moment.json`);
        } catch (error) {
            toast((error.messageKey ? error : error.message) || msg('errors.settingsSave'));
        }
    }
    function downloadSubtitles(format = 'srt') {
        if (settingsUnavailable())
            return;
        try {
            const project = getProject();
            const text = projectSubtitles(project, { format, bom: format === 'srt' });
            if (!text || (format === 'vtt' && text === 'WEBVTT\n\n')) {
                toast(msg('errors.noCaptionsSave'));
                return;
            }
            const type = format === 'vtt' ? 'text/vtt;charset=utf-8' : 'text/plain;charset=utf-8';
            download(new Blob([text], { type }), `${project.name}.${format}`);
        }
        catch (error) {
            toast((error.messageKey ? error : error.message) || msg('errors.captionSave'));
        }
    }
    function downloadSrt() { downloadSubtitles('srt'); }
    async function importSrt(file) {
        try {
            const beforeCommit = guardTextImport();
            if (file.size > MAX_SUBTITLE_BYTES)
                throw new LocalizedError(msg('errors.subtitleFileLimit'));
            const text = await readUtf8File(file);
            const captions = parseSubtitles(text, getProject().duration);
            const result = await execute('captions.replace', { captions }, beforeCommit);
            if (!result.ok)
                throw new Error(result.error.message);
            focusImportedCaption();
            toast(msg('errors.captionsImported',{count:captions.length}));
        }
        catch (error) {
            toast((error.messageKey ? error : error.message) || msg('errors.captionRead'));
        }
        finally {
            $('#srtInput').value = '';
        }
    }
    return { importProjectSettings, downloadProjectSettings, importSrt, downloadSrt, downloadSubtitles };
}
