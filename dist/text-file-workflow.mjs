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
            throw new Error('파일을 올바른 UTF-8로 저장한 뒤 다시 불러오세요.');
        }
    }
    let textImportRequest = 0;
    function guardTextImport() {
        const request = ++textImportRequest, original = getProject(), contents = JSON.stringify(getProject());
        return () => {
            if (request !== textImportRequest || getProject() !== original || JSON.stringify(getProject()) !== contents)
                throw new CommandError('CONFLICT', '프로젝트가 변경되었거나 다른 가져오기를 선택했습니다. 파일을 다시 선택하세요.');
        };
    }
    async function importProjectSettings(file) {
        try {
            const beforeCommit = guardTextImport();
            assertProjectFileSize(file.size);
            const result = await execute('project.import', { document: JSON.parse(await readUtf8File(file, true)) }, beforeCommit);
            if (!result.ok)
                throw new Error(result.error.message);
            closeModal();
            toast('편집 설정을 적용했습니다. 실행 취소할 수 있습니다.');
            return result;
        }
        catch (error) {
            toast(error.message || '설정 파일을 확인하세요.');
            return { ok: false, error: { code: 'IMPORT_FAILED', message: error.message } };
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
            toast(error.message || '편집 설정을 저장하지 못했습니다.');
        }
    }
    function downloadSubtitles(format = 'srt') {
        if (settingsUnavailable())
            return;
        try {
            const project = getProject();
            const text = projectSubtitles(project, { format, bom: format === 'srt' });
            if (!text || (format === 'vtt' && text === 'WEBVTT\n\n')) {
                toast('저장할 자막이 없습니다.');
                return;
            }
            const type = format === 'vtt' ? 'text/vtt;charset=utf-8' : 'text/plain;charset=utf-8';
            download(new Blob([text], { type }), `${project.name}.${format}`);
        }
        catch (error) {
            toast(error.message || '자막을 저장하지 못했습니다.');
        }
    }
    function downloadSrt() { downloadSubtitles('srt'); }
    async function importSrt(file) {
        try {
            const beforeCommit = guardTextImport();
            if (file.size > MAX_SUBTITLE_BYTES)
                throw new Error('자막 파일은 2 MB 이하만 지원합니다.');
            const text = await readUtf8File(file);
            const captions = parseSubtitles(text, getProject().duration);
            const result = await execute('captions.replace', { captions }, beforeCommit);
            if (!result.ok)
                throw new Error(result.error.message);
            focusImportedCaption();
            toast(`${captions.length}개의 자막을 불러왔습니다.`);
        }
        catch (error) {
            toast(error.message || '자막 파일을 읽지 못했습니다.');
        }
        finally {
            $('#srtInput').value = '';
        }
    }
    return { importProjectSettings, downloadProjectSettings, importSrt, downloadSrt, downloadSubtitles };
}
