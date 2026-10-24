import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptionSearch } from '../dist/caption-search.mjs';

function fixture(captions) {
    let project = { captions }, focused = null;
    const nodes = new Map();
    const query = selector => {
        if (!nodes.has(selector)) nodes.set(selector, {
            value: '', attributes: {},
            setAttribute(name, value) { this.attributes[name] = value; },
            removeAttribute(name) { delete this.attributes[name]; },
            focus() {}, setSelectionRange(start, end) { this.selection = [start, end]; }
        });
        return nodes.get(selector);
    };
    const search = createCaptionSearch({
        query, getProject: () => project, blocked: () => false, toast() {},
        focusCaption(index) { focused = index; query(`[data-caption-text="${index}"]`).value = project.captions[index].text; },
        execute(_command, { captionIndex, patch }) {
            project = { captions: project.captions.map((caption, index) => index === captionIndex ? { ...caption, ...patch } : caption) };
            return true;
        }, edit(change) { change(); }
    });
    search.bind();
    return {
        query, search, get project() { return project; },
        find(value) { query('#captionFind').value = value; query('#captionFind').oninput(); },
        replace(value) { query('#captionReplacement').value = value; query('#captionReplacement').oninput(); },
        move(direction) {
            query(direction > 0 ? '#nextCaptionMatch' : '#previousCaptionMatch').onclick();
            return { index: focused, selection: focused === null ? null : query(`[data-caption-text="${focused}"]`).selection,
                status: JSON.parse(query('#captionSearchStatus').attributes['data-i18n-params']) };
        }
    };
}

// Reference materializes matches only in tests, matching the original generator contract.
function reference(captions, query) {
    const matches = [];
    for (let index = 0; index < captions.length; index++) {
        for (let start = captions[index].text.indexOf(query); start >= 0;
            start = captions[index].text.indexOf(query, start + query.length)) {
            matches.push({caption: captions[index], index, start});
        }
    }
    let selected = null;
    return direction => {
        const index = selected ? captions.indexOf(selected.caption) : undefined;
        let target = null;
        for (const match of matches) {
            const ahead = index === undefined || match.index > index || (match.index === index && match.start > selected.start);
            const behind = index === undefined || match.index < index || (match.index === index && match.start < selected.start);
            if (direction > 0 && !target && ahead) target = match;
            if (direction < 0 && behind) target = match;
        }
        selected = target || (direction > 0 ? matches[0] : matches.at(-1));
        let current = 0;
        matches.forEach((match, ordinal) => {
            if (selected?.caption === match.caption && selected.start === match.start) {
                current = ordinal + 1;
                selected = match;
            }
        });
        return { index: selected?.index ?? null, selection: selected ? [selected.start, selected.start + query.length] : null,
            status: {current, count: matches.length} };
    };
}

test('allocation-light scanner matches original occurrence order and wrapping deterministically', () => {
    const shared = {text: 'same same'};
    for (const [captions, query] of [
        [[{text:'aaaaa'}, {text:'aa xx aa'}], 'aa'],
        [[{text:'😀 é 😀'}, {text:'é é'}], 'é'],
        [[{text:'😀😀'}, {text:'a😀 b'}], '😀'],
        [[{text:' spaced  text '}, {text:' three spaces '}], ' '],
        [[{text:'$& $1 $&'}, {text:'$&'}], '$&'],
        [[shared, {text:'none'}, shared], 'same'],
        [[{text:'absent'}], 'missing']
    ]) {
        const f = fixture(captions), expected = reference(captions, query);
        f.find(query);
        for (const direction of [1,1,-1,1,1,1,-1,-1,-1,1,-1,1]) {
            assert.deepEqual(f.move(direction), expected(direction), `query ${JSON.stringify(query)}, direction ${direction}`);
        }
    }
});

test('scanner rescans in-place reordering and cue changes without cached ordinals', () => {
    const a = {text:'hit'}, b = {text:'hit hit'}, f = fixture([a,b]);
    f.find('hit');
    f.move(1);
    f.project.captions.reverse();
    f.search.update();
    assert.deepEqual(JSON.parse(f.query('#captionSearchStatus').attributes['data-i18n-params']), {current:3,count:3});
    a.text = 'changed';
    f.search.update();
    assert.deepEqual(f.move(-1), {index:0,selection:[4,7],status:{current:2,count:2}});
});

test('replacement anchor skips inserted matches forward and keeps backward/wrap behavior', () => {
    const f = fixture([{text:'x x'}, {text:'x'}]);
    f.find('x');
    f.replace('x x');
    f.move(1);
    f.query('#replaceCaptionMatch').onclick();
    assert.equal(f.project.captions[0].text, 'x x x');
    assert.deepEqual(f.move(1), {index:0,selection:[4,5],status:{current:3,count:4}});
    assert.deepEqual(f.move(-1), {index:0,selection:[2,3],status:{current:2,count:4}});
    f.query('#replaceCaptionMatch').onclick();
    assert.deepEqual(f.move(-1), {index:0,selection:[4,5],status:{current:3,count:5}});
});
