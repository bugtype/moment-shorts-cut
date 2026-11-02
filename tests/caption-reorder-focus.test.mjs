import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {renderCaptionTrack} from '../dist/timeline-view.mjs';
import {validateProject} from '../dist/core/project.mjs';
import {initLocale} from '../dist/i18n.mjs';
import {createTrack} from './fixtures/timeline-dom.mjs';
import {createAppFixture} from './fixtures/app.mjs';

// Model native remove/reinsert focus reset explicitly. This does not run a
// browser, native Tab order, screen reader or native keyboard event sequence.
function installFocusMoves(track, document = {body: {}, documentElement: {}}) {
    track.children.length = 0;
    const createElement = track.ownerDocument.createElement;
    track.ownerDocument = document;
    track.isConnected = true;
    document.hasFocus = () => true;
    const fallbackCreate = document.createElement?.bind(document);
    const events = [];
    let moves = 0, afterMove = () => {}, resetFocus = true;
    document.createElement = tag => {
        if (tag !== 'button' && fallbackCreate) return fallbackCreate(tag);
        const node = createElement(tag);
        node.tagName = tag.toUpperCase();
        node.hidden = false;
        node.disabled = false;
        node.focus = options => { document.activeElement = node; events.push({node, options}); };
        node.closest = selector => selector === '[data-caption-index]' ? node : null;
        const remove = node.remove;
        node.remove = () => {
            if (track.children.includes(node) && document.activeElement === node && resetFocus)
                document.activeElement = document.body;
            remove();
        };
        return node;
    };
    const insertBefore = track.insertBefore;
    track.insertBefore = (node, next) => {
        const moving = track.children.includes(node);
        insertBefore(node, next);
        if (moving) { moves++; afterMove(node); }
    };
    return {track, document, events, get moves() {return moves;},
        set afterMove(value) {afterMove = value;}, set resetFocus(value) {resetFocus = value;}};
}
const first = {captionIndex: 0, clipIndex: 0, start: 2, end: 3, text: 'A'};
const second = {captionIndex: 1, clipIndex: 0, start: 5, end: 6, text: 'B'};
const earlier = {...second, start: 0, end: 1};
function fixture() {
    const f = installFocusMoves(createTrack());
    renderCaptionTrack(f.track, [earlier, first], 12, 1);
    f.a = f.track.children[1]; f.b = f.track.children[0];
    f.document.activeElement = f.a;
    return f;
}
const undoOrder = f => renderCaptionTrack(f.track, [first, second], 12, 1);

test('surviving moved caption keeps focus without scroll after reorder', () => {
    const f = fixture();
    undoOrder(f);
    assert.deepEqual(f.track.children, [f.a, f.b]);
    assert.equal(f.document.activeElement, f.a);
    assert.equal(f.moves, 1);
    assert.deepEqual(f.events, [{node: f.a, options: {preventScroll: true}}]);
    undoOrder(f);
    assert.equal(f.moves, 1);
    assert.equal(f.events.length, 1, 'unchanged refresh never refocuses');
});

test('reordering around the focused button preserves it without a redundant focus call', () => {
    const f = fixture();
    f.document.activeElement = f.b;
    undoOrder(f);
    assert.equal(f.document.activeElement, f.b);
    assert.equal(f.events.length, 0);
    const retained = fixture(); retained.resetFocus = false;
    undoOrder(retained);
    assert.equal(retained.document.activeElement, retained.a);
    assert.equal(retained.events.length, 0, 'a port retaining native focus does not receive a second focus');
});

test('outside and competing focus are never stolen by caption reordering', () => {
    for (const duringMove of [false, true]) {
        const f = fixture(), outside = {};
        if (duringMove) f.afterMove = () => {f.document.activeElement = outside;};
        else f.document.activeElement = outside;
        undoOrder(f);
        assert.equal(f.document.activeElement, outside);
        assert.equal(f.events.length, 0);
    }
});

test('document-root fallback is repaired, but a removed occurrence receives no new focus policy', () => {
    const f = fixture();
    f.afterMove = () => {f.document.activeElement = f.document.documentElement;};
    undoOrder(f);
    assert.equal(f.document.activeElement, f.a);
    assert.equal(f.events.length, 1);
    const removed = fixture();
    renderCaptionTrack(removed.track, [earlier], 12, 1);
    assert.deepEqual(removed.track.children, [removed.b]);
    assert.equal(removed.document.activeElement, removed.document.body);
    assert.equal(removed.events.length, 0);
});

test('hidden, disabled, detached or inactive-document targets do not regain focus', () => {
    for (const guard of ['hidden', 'disabled', 'ancestor', 'detached', 'inactive']) {
        const f = fixture();
        f.afterMove = () => {
            if (guard === 'hidden') f.a.hidden = true;
            if (guard === 'disabled') f.a.disabled = true;
            if (guard === 'ancestor') f.a.closest = () => ({});
            if (guard === 'detached') f.track.isConnected = false;
            if (guard === 'inactive') f.document.hasFocus = () => false;
        };
        undoOrder(f);
        assert.equal(f.document.activeElement, f.document.body, guard);
        assert.equal(f.events.length, 0, guard);
    }
});

for (const locale of ['ko', 'en', 'zh-CN']) test(`${locale}: actual Undo/Redo keeps surviving caption keyboard target and activation`, async () => {
    const f = await createAppFixture();
    const moves = installFocusMoves(f.element('#captionTrack'), f.doc);
    initLocale({languages: [locale]});
    try {
        vm.runInContext("state=initial();state.duration=12;state.clips=[{start:0,end:12}];state.captions=[{start:2,end:3,text:'Unchanged A'},{start:5,end:6,text:'Edited B'}];history=[];future=[];timelineCache=null;bind();renderTimeline();renderInspector();", f.context);
        const original = f.evaluate('state');
        validateProject(original);
        const changed = await f.context.window.moment.execute('captions.update', {captionIndex: 1, patch: {start: 0, end: 1}});
        assert.equal(changed.ok, true);
        const edited = f.evaluate('state'), track = moves.track;
        const a = track.children[1], b = track.children[0];
        let prevented = 0;
        const press = (focused, redo) => {
            f.doc.activeElement = focused;
            const count = moves.events.length;
            f.documentEvents.get('keydown')({key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: redo,
                target: focused, preventDefault() {prevented++;}});
            assert.equal(f.doc.activeElement, focused);
            assert.deepEqual(f.evaluate('state'), redo ? edited : original);
            assert.equal(f.evaluate('history.length'), redo ? 1 : 0);
            assert.equal(f.evaluate('future.length'), redo ? 0 : 1);
            assert.deepEqual(track.children, redo ? [b, a] : [a, b]);
            assert.equal(moves.events.length, count + (focused === (redo ? b : a) ? 1 : 0));
        };
        for (let repeat = 0; repeat < 3; repeat++) {
            press(a, false); press(a, true); press(b, false); press(b, true);
        }
        assert.equal(prevented, 12);
        assert.ok(moves.events.every(event => event.options.preventScroll));
        f.doc.activeElement = a;
        track.onclick({target: a, detail: 0});
        assert.equal(f.evaluate('current'), 2);
        assert.equal(f.evaluate('panel'), 'captions');
        assert.equal(f.doc.activeElement, f.element('[data-caption-text="0"]'));
        assert.deepEqual(f.evaluate('state'), edited);
    } finally {initLocale();}
});
