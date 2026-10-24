import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mountTemplateGallery } from '../dist/template-gallery.mjs';
import { createAppFixture } from './fixtures/app.mjs';

function controls() {
    let stars = [], active = null, html = '';
    const node = dataset => ({ dataset, connected: true, attributes: {},
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; },
        removeAttribute(name) { delete this.attributes[name]; },
        classList: { toggle() {} },
        focus() { assert.equal(this.connected, true); active = this; }
    });
    const grid = {
        get innerHTML() { return html; },
        set innerHTML(value) {
            html = value;
            for (const star of stars) star.connected = false;
            stars = [...value.matchAll(/data-favorite="([^"]+)"[^>]*aria-pressed="([^"]+)"/g)].map(match => {
                const star = node({ favorite: match[1] });
                star.setAttribute('aria-pressed', match[2]);
                return star;
            });
        }
    };
    return { grid, node, stars: () => stars, get active() { return active; } };
}
function fixture({ category = '전체', favorites = ['recipe'], toggle } = {}) {
    const dom = controls(), nodes = new Map();
    const filter = dom.node({ category: '즐겨찾기' });
    filter.setAttribute('aria-pressed', category === '즐겨찾기');
    nodes.set('#templateGrid', dom.grid);
    const root = {
        innerHTML: '',
        querySelector(selector) {
            if (!nodes.has(selector)) nodes.set(selector, dom.node({}));
            return nodes.get(selector);
        },
        querySelectorAll(selector) {
            if (selector === '[data-favorite]') return dom.stars();
            if (selector === '[data-category]') return [filter];
            return [];
        }
    };
    const api = { ui: { category, query: '' }, favorites, custom: [],
        favorite(id) {
            if (toggle) return toggle({ id, root, api, nodes });
            const index = favorites.indexOf(id);
            if (index < 0) favorites.push(id);
            else favorites.splice(index, 1);
        }
    };
    mountTemplateGallery(root, api);
    return { dom, root, api, nodes, filter };
}

test('favorite toggle focuses the newly mounted same star and stale star is inert', () => {
    const f = fixture(), star = f.dom.stars().find(item => item.dataset.favorite === 'recipe');
    star.focus();
    star.onclick();
    assert.equal(star.connected, false);
    assert.equal(f.dom.active.dataset.favorite, 'recipe');
    assert.notEqual(f.dom.active, star);
    assert.equal(f.dom.active.getAttribute('aria-pressed'), 'false');
    star.onclick();
    assert.deepEqual(f.api.favorites, []);
});

for (const position of ['first', 'middle', 'last']) {
    test(`removing ${position} filtered favorite focuses nearest surviving star`, () => {
        const f = fixture({ category: '즐겨찾기', favorites: ['recipe', 'interview', 'explainer'] });
        const before = f.dom.stars();
        const index = position === 'first' ? 0 : position === 'middle' ? 1 : before.length - 1;
        before[index].focus();
        before[index].onclick();
        assert.equal(f.dom.active, f.dom.stars()[Math.min(index, f.dom.stars().length - 1)]);
    });
}

test('last filtered favorite falls back to active Favorites filter, then search', () => {
    for (const available of [true, false]) {
        const f = fixture({ category: '즐겨찾기' });
        if (!available) f.filter.setAttribute('aria-pressed', 'false');
        f.dom.stars()[0].onclick();
        assert.equal(f.dom.stars().length, 0);
        assert.equal(f.dom.active, available ? f.filter : f.root.querySelector('#templateSearch'));
    }
});

test('refused toggle keeps favorite state and restores current star without extra action', () => {
    let attempts = 0;
    const f = fixture({ toggle() { attempts++; } });
    f.dom.stars().find(star => star.dataset.favorite === 'recipe').onclick();
    assert.equal(attempts, 1);
    assert.deepEqual(f.api.favorites, ['recipe']);
    assert.equal(f.dom.active.dataset.favorite, 'recipe');
    assert.equal(f.dom.active.getAttribute('aria-pressed'), 'true');
});

test('synchronous gallery replacement and detached callbacks never steal focus', () => {
    const f = fixture({ toggle({ root, api }) { mountTemplateGallery(root, { ...api, favorite() {} }); } });
    const old = f.dom.stars()[0];
    old.onclick();
    assert.equal(f.dom.active, null);
    old.onclick();
    assert.equal(f.dom.active, null);
    const current = f.dom.stars()[0];
    f.nodes.set('#templateGrid', {});
    current.onclick();
    assert.equal(f.dom.active, null);
});

test('actual app favorite writes once, preserves editor state and handles failed storage retry', async () => {
    const f = await createAppFixture(), dom = controls(), root = f.element('#panelContent');
    const query = root.querySelector.bind(root), queryAll = root.querySelectorAll.bind(root);
    root.querySelector = selector => selector === '#templateGrid' ? dom.grid : query(selector);
    root.querySelectorAll = selector => selector === '[data-favorite]' ? dom.stars() : queryAll(selector);
    let writes = 0, fail = false;
    f.context.localStorage.setItem = () => { writes++; if (fail) throw Error('storage full'); };
    vm.runInContext("panel = 'templates'; renderPanel();", f.context);
    const before = f.evaluate('({state, history, future, current, playing})');
    const recipe = () => dom.stars().find(star => star.dataset.favorite === 'recipe');
    recipe().focus();
    recipe().onclick();
    assert.equal(writes, 1);
    assert.equal(dom.active, recipe());
    assert.equal(recipe().getAttribute('aria-pressed'), 'true');
    fail = true;
    recipe().onclick();
    assert.equal(writes, 2);
    assert.equal(recipe().getAttribute('aria-pressed'), 'true', 'failed write rolls back');
    assert.equal(dom.active, recipe());
    fail = false;
    recipe().onclick();
    assert.equal(writes, 3);
    assert.equal(recipe().getAttribute('aria-pressed'), 'false');
    assert.deepEqual(f.evaluate('({state, history, future, current, playing})'), before);
});
