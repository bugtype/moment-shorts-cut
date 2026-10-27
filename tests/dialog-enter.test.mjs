import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogEnterBlocked } from '../dist/dialog-enter.mjs';

const keys = ['defaultPrevented', 'key', 'isComposing', 'keyCode', 'ctrlKey', 'metaKey', 'altKey', 'shiftKey'];
const plainEnter = {defaultPrevented:false, key:'Enter', isComposing:false, keyCode:13,
    ctrlKey:false, metaKey:false, altKey:false, shiftKey:false};

test('dialog Enter admission keeps strict key/IME checks and raw lazy flag results', () => {
    const opaque = {[Symbol.toPrimitive](){assert.fail('truthiness must not coerce');}};
    assert.equal(dialogEnterBlocked(plainEnter), false);
    assert.equal(dialogEnterBlocked({key:'Enter', keyCode:'229'}), undefined);
    for (const key of [undefined, 'Escape', 'NumpadEnter', opaque]) {
        assert.equal(dialogEnterBlocked({...plainEnter, key}), true);
    }
    for (const [index, key] of keys.entries()) {
        const reads = [], event = {};
        const blocked = key === 'key' ? 'Escape' : key === 'keyCode' ? 229 : opaque;
        for (const name of keys) Object.defineProperty(event, name, {get(){
            assert.equal(this, event);
            reads.push(name);
            return name === key ? blocked : plainEnter[name];
        }});
        assert.equal(dialogEnterBlocked(event), key === 'key' || key === 'keyCode' ? true : opaque);
        assert.deepEqual(reads, keys.slice(0, index + 1));
    }
});

test('dialog Enter admission preserves getter order and thrown identities without later reads', () => {
    for (const [index, point] of keys.entries()) {
        const sentinel = {}, reads = [], event = {};
        for (const key of keys) Object.defineProperty(event, key, {get(){
            reads.push(key);
            if (key === point) throw sentinel;
            return plainEnter[key];
        }});
        assert.throws(() => dialogEnterBlocked(event), error => error === sentinel);
        assert.deepEqual(reads, keys.slice(0, index + 1));
    }
});
