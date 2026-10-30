import { projectGraphicsText } from './core/graphics-text.mjs';
import { LocalizedError } from './core/validation.mjs';
import { message as msg, formatError } from './i18n.mjs';
import { createProjectDocument, projectSubtitles, assertProjectFileSize, timelineDuration, outputDuration } from './core/project.mjs';
import { CommandError } from './core/validation.mjs';
import { parseSubtitlesWithReport, MAX_SUBTITLE_BYTES } from './captions.mjs';

// JSON and subtitle imports share one request owner so neither can overwrite a newer import.
export function createTextFileWorkflow({
    getProject, execute, query: $, closeModal, focusImportedCaption,
    settingsUnavailable, download, toast,
}) {
    async function readUtf8File(file, settingsFile = false) {
        const bytes = await file.arrayBuffer();
        if (settingsFile) assertProjectFileSize(bytes.byteLength);
        else if (bytes.byteLength > MAX_SUBTITLE_BYTES) throw new LocalizedError(msg('errors.subtitleFileLimit'));
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
        const guard = () => {
            if (request !== textImportRequest || getProject() !== original || JSON.stringify(getProject()) !== contents)
                throw new CommandError('CONFLICT', msg('errors.importConflict'));
        };
        guard.isLatest = () => request === textImportRequest;
        return guard;
    }
    async function importProjectSettings(file, closeImportedDialog = closeModal) {
        let beforeCommit;
        try {
            beforeCommit = guardTextImport();
            assertProjectFileSize(file.size);
            const text = await readUtf8File(file, true);
            let document;
            try { document = JSON.parse(text); }
            catch (error) {
                if (error instanceof SyntaxError) throw new LocalizedError(msg('errors.settingsCheck'));
                throw error;
            }
            const result = await execute('project.import', { document }, beforeCommit);
            if (!result.ok)
                throw new Error(result.error.message);
            closeImportedDialog();
            toast(msg('errors.settingsApplied'));
            return result;
        }
        catch (error) {
            if (!beforeCommit || beforeCommit.isLatest())
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
    function downloadGraphicsText() {
        if (settingsUnavailable()) return;
        try {
            const project = getProject();
            const text = projectGraphicsText(project);
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            download(blob, `${project.name || 'moment'}.graphics.txt`);
        } catch (error) {
            toast(error.messageKey ? error : msg('shell.graphicsTextSave'));
        }
    }
    function downloadSubtitles(format = 'srt', range = {}) {
        if (settingsUnavailable())
            return;
        try {
            const project = getProject();
            const review = format === 'review-txt';
            const text = projectSubtitles(project, { ...range, format: review ? 'txt' : format, bom: format === 'srt', ...(review ? {review: true} : {}) });
            if (!text || (format === 'vtt' && text === 'WEBVTT\n\n')) {
                toast(msg('errors.noCaptionsSave'));
                return;
            }
            const type = format === 'vtt' ? 'text/vtt;charset=utf-8' : 'text/plain;charset=utf-8';
            const scoped = Object.hasOwn(range, 'captionIndex') || Object.hasOwn(range, 'count');
            const first = range.captionIndex ?? 0, count = range.count ?? project.captions.length - first;
            const suffix = scoped ? `.rows-${first + 1}-${first + count}` : '';
            download(new Blob([text], { type }), `${project.name || 'moment'}${suffix}.${review ? 'review.txt' : format}`);
            return true; // Download initiated; browser completion is not observable here.
        }
        catch (error) {
            toast((error.messageKey ? error : error.message) || msg('errors.captionSave'));
        }
    }
    function downloadSrt() { downloadSubtitles('srt'); }
    async function importSrt(file, options = {}) {
        const owned = options.owned === true;
        let request;
        const current = () => (!request || request.isLatest()) && (!options.isCurrent || options.isCurrent());
        function reportFailure(error) {
            if (!current()) return {ok:false,stale:true};
            if (!owned) toast((error.messageKey ? error : error.message) || msg('errors.captionRead'));
            return {ok:false,error:error.messageKey ? error : {code:error.code || 'IMPORT_FAILED',message:formatError(error)}};
        }
        try {
            request = guardTextImport();
            const project = getProject(), clock = options.clock || 'source', mode = options.mode ?? 'replace';
            if (!['replace','append'].includes(mode)) throw new LocalizedError(msg('panels.subtitleImportModeInvalid'));
            if (!['source','output'].includes(clock)) throw new LocalizedError(msg('panels.subtitleClockInvalid'));
            const duration = clock === 'output' ? outputDuration(project) : project.duration;
            const speed = project.speed, total = timelineDuration(project);
            const beforeCommit = () => {
                request();
                if (!current()) throw new CommandError('CONFLICT', msg('errors.importConflict'));
                options.beforeCommit?.();
            };
            beforeCommit();
            if (file.size > MAX_SUBTITLE_BYTES) throw new LocalizedError(msg('errors.subtitleFileLimit'));
            const text = await readUtf8File(file);
            beforeCommit();
            const parsed = parseSubtitlesWithReport(text, duration);
            let captions = parsed.captions;
            if (clock === 'output') captions = captions.map(caption => ({...caption,
                start:caption.start * speed,
                // A parser-clamped end represents the exact captured timeline end.
                end:caption.end === duration ? total : caption.end * speed,
                basis:'timeline',
            }));
            let inFlight = false, consumed = false;
            const commit = async () => {
                if (consumed || !current()) return {ok:false,stale:true};
                if (inFlight) return {ok:false,error:{code:'BUSY',message:formatError(msg('errors.busy'))}};
                inFlight = true;
                try {
                    beforeCommit();
                    const result = await execute(mode === 'append' ? 'captions.append' : 'captions.replace', { captions }, beforeCommit);
                    if (result.ok) consumed = true;
                    if (!current()) return {ok:false,stale:true};
                    if (!result.ok) {
                        if (!owned) toast(result.error.message);
                        return result;
                    }
                    const success = msg('errors.captionsImported',{count:captions.length});
                    if (!owned) { focusImportedCaption(); toast(success); }
                    return {...result, message:success};
                } catch (error) {
                    return reportFailure(error);
                } finally {
                    inFlight = false;
                }
            };
            if (options.prepareOnly === true)
                return {ok:true,prepared:true,report:{...parsed.report},commit};
            return await commit();
        } catch (error) {
            return reportFailure(error);
        } finally {
            if (!owned && options.prepareOnly !== true && current()) $('#srtInput').value = '';
        }
    }
    return { importProjectSettings, downloadProjectSettings, downloadGraphicsText, importSrt, downloadSrt, downloadSubtitles };
}
