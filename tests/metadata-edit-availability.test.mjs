import test from 'node:test';
import assert from 'node:assert/strict';
import { metadataEditBlocked } from '../dist/metadata-edit-availability.mjs';

function readyApp() {
    return {
        editorReady: true, exporting: false, loadingMedia: false, transcribing: false,
        audioRecording: { requesting: false, current: null },
        persistence: { restorePhase: 'ready', recoveryValid: false },
    };
}

const failedValidReads = [
    'app.editorReady', 'app.exporting', 'app.loadingMedia', 'app.transcribing',
    'app.audioRecording', 'recording.requesting', 'app.audioRecording', 'recording.current',
    'app.persistence', 'persistence.restorePhase', 'app.persistence', 'persistence.restorePhase',
    'app.persistence', 'persistence.recoveryValid',
];

function tracedApp(app, trace, onRead = () => {}) {
    const watch = (object, name) => new Proxy(object, {
        get(target, key) {
            const label = `${name}.${String(key)}`;
            trace.push(label);
            onRead(label, trace.length);
            return target[key];
        },
    });
    app.audioRecording = watch(app.audioRecording, 'recording');
    app.persistence = watch(app.persistence, 'persistence');
    return watch(app, 'app');
}

test('metadata edit availability observes current busy and recovery states without coercing busy values', () => {
    const app = readyApp();
    assert.equal(metadataEditBlocked(app), false);
    app.editorReady = false;
    assert.equal(metadataEditBlocked(app), true);
    app.editorReady = true;
    for (const [owner, key] of [
        [app, 'exporting'], [app, 'loadingMedia'], [app, 'transcribing'],
        [app.audioRecording, 'requesting'], [app.audioRecording, 'current'],
    ]) {
        const token = { key };
        owner[key] = token;
        assert.strictEqual(metadataEditBlocked(app), token, key);
        owner[key] = false;
        assert.equal(metadataEditBlocked(app), false, `${key} cleared`);
    }
    for (const phase of ['restoring', 'failed', undefined]) {
        app.persistence.restorePhase = phase;
        assert.equal(metadataEditBlocked(app), true, String(phase));
    }
    app.persistence.recoveryValid = true;
    assert.equal(metadataEditBlocked(app), true, 'valid flag alone does not admit an unknown phase');
    app.persistence.restorePhase = 'failed';
    assert.equal(metadataEditBlocked(app), false, 'failed-valid metadata editing remains available');
    app.persistence.restorePhase = 'restoring';
    assert.equal(metadataEditBlocked(app), true, 'valid flag does not admit a pending restore');
    app.persistence.restorePhase = 'ready';
    app.persistence.recoveryValid = false;
    assert.equal(metadataEditBlocked(app), false);
});

test('metadata edit availability preserves short-circuit order and repeated live recovery reads', () => {
    const values = readyApp();
    const trace = [];
    const app = tracedApp(values, trace);
    assert.equal(metadataEditBlocked(app), false);
    assert.deepEqual(trace, failedValidReads.slice(0, 10), 'ready skips the second phase and recovery flag');

    trace.length = 0;
    values.editorReady = false;
    assert.equal(metadataEditBlocked(app), true);
    assert.deepEqual(trace, ['app.editorReady']);

    trace.length = 0;
    values.editorReady = true;
    let reads = 0;
    Object.defineProperty(values.persistence, 'restorePhase', {
        get: () => ++reads === 1 ? 'restoring' : 'failed',
    });
    values.persistence.recoveryValid = true;
    assert.equal(metadataEditBlocked(app), false, 'the second live phase read permits failed-valid recovery');
    assert.equal(reads, 2);
    assert.deepEqual(trace, failedValidReads);
});

test('metadata edit availability propagates each getter failure without later reads', () => {
    for (let throwAt = 1; throwAt <= failedValidReads.length; throwAt++) {
        const values = readyApp();
        values.persistence = { restorePhase: 'failed', recoveryValid: true };
        const trace = [];
        const failure = new Error(`generated getter failure ${throwAt}`);
        const app = tracedApp(values, trace, (_label, index) => {
            if (index === throwAt) throw failure;
        });
        assert.throws(() => metadataEditBlocked(app), error => error === failure);
        assert.deepEqual(trace, failedValidReads.slice(0, throwAt));
    }
});
