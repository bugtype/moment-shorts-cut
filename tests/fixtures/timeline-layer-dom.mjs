// Focused DOM model for the emitted layer lane. No native event dispatch, layout or IME.
const decode = value => value.replace(/&(?:amp|lt|gt|quot|#39);/g, entity =>
    ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]);
const escape = value => String(value).replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function installLayerTrackDom(track, document) {
    let children = [], writes = 0, assignedHTML = '';
    function text(data) {
        return {
            nodeType: 3, nodeName: '#text', data, parentNode: null,
            get nodeValue() { return this.data; }, set nodeValue(value) { this.data = value; },
            get textContent() { return this.data; }, set textContent(value) { this.data = value; },
            get parentElement() { return this.parentNode; },
            get isConnected() { return this.parentNode?.isConnected || false; },
        };
    }
    function element(tag) {
        const attributes = new Map(), childNodes = [];
        const node = {
            nodeType: 1, nodeName: tag.toUpperCase(), tagName: tag.toUpperCase(),
            dataset: {}, style: {}, childNodes, parentNode: null, ownerDocument: document,
            get isConnected() { return this.parentNode?.isConnected || false; },
            get parentElement() { return this.parentNode; },
            get children() { return childNodes.filter(child => child.nodeType === 1); },
            get childElementCount() { return this.children.length; },
            get firstChild() { return childNodes[0] || null; },
            get lastChild() { return childNodes.at(-1) || null; },
            get firstElementChild() { return this.children[0] || null; },
            get textContent() { return childNodes.map(child => child.textContent).join(''); },
            set textContent(value) {
                if (childNodes.some(child => child === document.activeElement || child.contains?.(document.activeElement)))
                    document.activeElement = document.body;
                for (const child of childNodes) child.parentNode = null;
                childNodes.length = 0;
                if (String(value)) this.appendChild(text(String(value)));
            },
            get innerHTML() { return childNodes.map(serialize).join(''); },
            set innerHTML(value) {
                this.textContent = '';
                parseBody(this, value);
            },
            get className() { return attributes.get('class') || ''; },
            set className(value) { attributes.set('class', value); },
            setAttribute(name, value) {
                attributes.set(name, String(value));
                if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
                if (name === 'style') for (const declaration of value.split(';')) {
                    const [key, value] = declaration.split(':');
                    if (key) this.style[key] = value;
                }
            },
            getAttribute(name) { return attributes.get(name) ?? null; },
            removeAttribute(name) { attributes.delete(name); },
            appendChild(child) { child.parentNode = this; childNodes.push(child); return child; },
            contains(target) { return target === this || childNodes.some(child => child === target || child.contains?.(target)); },
            matches(selector) {
                return selector.split(',').some(part => {
                    const match = part.trim().match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
                    return match && attributes.has(match[1]) && (match[2] === undefined || attributes.get(match[1]) === match[2]);
                });
            },
            closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest?.(selector) || null; },
            querySelectorAll(selector) { return descendants(this).filter(child => child.matches(selector)); },
            querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
            focus(options) { document.activeElement = this; track.focusCalls.push({ node: this, options }); },
            attributes,
        };
        return node;
    }
    function descendants(node) {
        return node.children.flatMap(child => [child, ...descendants(child)]);
    }
    function attributes(node, source) {
        for (const [, name, value] of source.matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(name, decode(value));
    }
    function parseBody(node, source) {
        const prefix = source.match(/^<span\b([^>]*)>([^<]*)<\/span>/);
        if (prefix) {
            const span = element('span');
            attributes(span, prefix[1]);
            span.appendChild(text(decode(prefix[2])));
            node.appendChild(span);
            source = source.slice(prefix[0].length);
        }
        if (source) node.appendChild(text(decode(source)));
    }
    function serialize(node) {
        if (node.nodeType === 3) return escape(node.data);
        const values = new Map(node.attributes);
        if (Object.keys(node.style).length) values.set('style', Object.entries(node.style).map(([key, value]) => `${key}:${value}`).join(';'));
        const attrs = [...values].map(([key, value]) => ` ${key}="${escape(value)}"`).join('');
        return `<${node.tagName.toLowerCase()}${attrs}>${node.childNodes.map(serialize).join('')}</${node.tagName.toLowerCase()}>`;
    }
    Object.defineProperties(track, {
        children: { configurable: true, get: () => children },
        childNodes: { configurable: true, get: () => children },
        childElementCount: { configurable: true, get: () => children.length },
        isConnected: { configurable: true, get: () => true },
        writes: { configurable: true, get: () => writes },
        assignedHTML: { configurable: true, get: () => assignedHTML },
        innerHTML: {
            configurable: true, get: () => children.map(serialize).join(''),
            set(value) {
                if (children.some(node => node.contains(document.activeElement))) document.activeElement = document.body;
                for (const node of children) node.parentNode = null;
                children = [];
                writes++;
                assignedHTML = value;
                // Keep raw fallback input observable; do not claim native CR/NUL parsing.
                for (const [, tag, attrs, body] of value.matchAll(/<(button|span)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
                    const node = element(tag);
                    attributes(node, attrs);
                    parseBody(node, body);
                    node.parentNode = track;
                    children.push(node);
                }
            },
        },
    });
    track.ownerDocument = document;
    track.focusCalls = [];
    track.querySelectorAll = selector => descendants(track).filter(node => node.matches(selector));
    track.querySelector = selector => track.querySelectorAll(selector)[0] || null;
    track.contains = target => children.some(node => node.contains(target));
    track.createText = text;
    track.createElement = element;
    return track;
}
