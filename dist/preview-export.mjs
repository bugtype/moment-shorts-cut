import { message } from './i18n.mjs';

// Capture the pixels already displayed, not a newly decoded or high-resolution frame.
export function createPreviewExport({ getProject, getMedia, getCanvas, createCanvas, blocked, download, toast }) {
    let generation = 0;
    return function savePreview() {
        const request = ++generation;
        if (blocked()) return;
        let snapshot;
        try {
            const project = getProject(), signature = JSON.stringify(project);
            const media = getMedia().slice(), name = project.name || 'moment';
            const source = getCanvas(), width = source?.width, height = source?.height;
            const current = () => request === generation && !blocked() && getProject() === project &&
                JSON.stringify(getProject()) === signature && getMedia().length === media.length &&
                getMedia().every((item, index) => item === media[index]);
            if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
                throw new Error('Invalid preview dimensions');
            snapshot = createCanvas();
            snapshot.width = width;
            snapshot.height = height;
            const context = snapshot.getContext('2d');
            if (!context || typeof snapshot.toBlob !== 'function') throw new Error('PNG encoding unavailable');
            context.drawImage(source, 0, 0);
            snapshot.toBlob(blob => {
                try {
                    if (!current()) return;
                    if (!blob || !blob.size || blob.type !== 'image/png') throw new Error('Invalid PNG');
                    download(blob, `${name}.preview-${width}x${height}.png`);
                }
                catch {
                    if (request === generation) toast(message('shell.previewPngError'));
                }
            }, 'image/png');
        }
        catch {
            if (request === generation) toast(message('shell.previewPngError'));
        }
        finally {
            // Native toBlob copies the bitmap before returning. Release only our
            // scratch surface; its independent encoding and callback may continue.
            if (snapshot) {
                try { snapshot.width = 0; } catch { /* Best-effort native cleanup. */ }
                try { snapshot.height = 0; } catch { /* Preserve the primary error. */ }
            }
            snapshot = null;
        }
    };
}
