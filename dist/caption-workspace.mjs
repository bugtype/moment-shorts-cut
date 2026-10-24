import { createCaptionSpeakerDialog } from './caption-speaker-dialog.mjs';
import { createCaptionShiftDialog } from './caption-shift-dialog.mjs';
import {createCaptionImportDialog} from './caption-import-dialog.mjs';
import {createCaptionRangeDialog} from './caption-range-dialog.mjs';
import {createCaptionPanel} from './caption-panel.mjs';
import {createCaptionInspectionDialog} from './caption-inspection-dialog.mjs';
import {createCaptionNavigation} from './caption-navigation.mjs';
import {createCaptionOverlapDialog} from './caption-overlap-dialog.mjs';

// Compose caption tools; the app retains project commits, media and persistence authority.
export function createCaptionWorkspace(app) {
    const busy = () => !app.editorReady || app.exporting || app.loadingMedia || app.transcribing ||
        app.audioRecording.requesting || app.audioRecording.current;
    const mediaUnavailable = () => busy() || !app.mediaReady();
    const metadataUnavailable = () => busy() || (app.persistence.restorePhase !== 'ready' &&
        !(app.persistence.restorePhase === 'failed' && app.persistence.recoveryValid));
    const navigation = {
        getProject: () => app.state,
        getMedia: () => [app.sources.videoFile, app.sources.audioFile],
        query: app.query, modal: app.modal,
        openModal: (...args) => app.modalOpen(...args),
        pause: () => app.pause(), seek: time => app.seekTo(time),
        focusCaption: index => { app.switchPanel('captions'); app.focusCaption(index); },
        toast: value => app.toast(value),
    };
    // Reading-speed inspection itself remains readable without media; its controller
    // consults blocked only for report navigation, preserving the existing contract.
    const inspection = createCaptionInspectionDialog({...navigation, blocked: mediaUnavailable});
    const rowNavigation = createCaptionNavigation({
        ...navigation, blocked: () => app.panel !== 'captions' || mediaUnavailable(),
    });
    const overlaps = createCaptionOverlapDialog({
        ...navigation, blocked: () => app.panel !== 'captions' || metadataUnavailable(),
        seekBlocked: () => !app.mediaReady(),
    });
    const removal = createCaptionRangeDialog(app, metadataUnavailable);
    const importer = createCaptionImportDialog(app, metadataUnavailable);
    const rangeSpeaker = createCaptionSpeakerDialog(app, metadataUnavailable);
    const rangeShift = createCaptionShiftDialog(app, metadataUnavailable);
    return createCaptionPanel({
        blocked: () => app.panel !== 'captions' || app.modal.open || metadataUnavailable(),
        importFile: () => importer.open(),
        removeRange: index => removal.open(index),
        shiftRange: index => rangeShift.open(index),
        speakerRange: index => rangeSpeaker.open(index),
        view: index => rowNavigation.open(index), inspect: () => inspection.open(), overlaps: () => overlaps.open(),
        execute: (command, args) => app.runEditorCommand(command, args),
        query: app.query, queryAll: app.queryAll,
        getProject: () => app.state,
        getDuration: () => app.duration(),
        sourceTime: () => app.locate(app.current).source,
        edit: (change, refresh) => app.edit(change, refresh),
        refresh: () => app.renderPanel(),
        toast: value => app.toast(value),
    });
}
