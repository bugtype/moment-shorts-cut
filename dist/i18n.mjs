import {messages as advisory} from './i18n/catalogs/advisory.mjs';
import {messages as duplicateRange} from './i18n/catalogs/duplicate-range.mjs';
import {messages as sourceVideo} from './i18n/catalogs/source-video.mjs';
import {messages as audioMix} from './i18n/catalogs/audio-mix.mjs';
import {messages as guides} from './i18n/catalogs/guides.mjs';
import {messages as replaceRange} from './i18n/catalogs/replace-range.mjs';
import {messages as importReview} from './i18n/catalogs/import-review.mjs';
import {messages as scenePng} from './i18n/catalogs/scene-png.mjs';
import {messages as stacking} from './i18n/catalogs/stacking.mjs';
import {messages as keywords} from './i18n/catalogs/keywords.mjs';
import {messages as review} from './i18n/catalogs/review.mjs';
import {messages as speakers} from './i18n/catalogs/speakers.mjs';
import {messages as collections} from './i18n/catalogs/collections.mjs';
import {messages as graphics} from './i18n/catalogs/graphics.mjs';
import {messages as session} from './i18n/catalogs/session.mjs';
import {messages as shell} from './i18n/catalogs/shell.mjs';
import {messages as panels} from './i18n/catalogs/panels.mjs';
import {messages as errors} from './i18n/catalogs/errors.mjs';
import {messages as templates} from './i18n/catalogs/templates.mjs';

export const SUPPORTED_LOCALES = Object.freeze(['ko', 'en', 'zh-CN']);
export const LOCALE_STORAGE_KEY = 'moment-ui-locale-v1';
const catalogs = Object.fromEntries(SUPPORTED_LOCALES.map(locale =>
    [locale, Object.assign({}, shell[locale], panels[locale], errors[locale], templates[locale], session[locale], graphics[locale], collections[locale], speakers[locale], review[locale], keywords[locale], stacking[locale], scenePng[locale], importReview[locale], replaceRange[locale], guides[locale], audioMix[locale], sourceVideo[locale], duplicateRange[locale], advisory[locale])]));
const attributes = ['aria-label', 'title', 'placeholder', 'alt', 'aria-valuetext', 'content', 'data-label'];
const subscribers = new Set();
let locale = 'ko', storage, root;

const escape = value => String(value).replace(/[&<>"']/g, char =>
    ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
export function normalizeLocale(value) {
    if (typeof value !== 'string') return null;
    const language = value.toLowerCase().replace(/_/g, '-');
    if (language === 'ko' || language.startsWith('ko-')) return 'ko';
    if (language === 'en' || language.startsWith('en-')) return 'en';
    if (language === 'zh' || language.startsWith('zh-')) return 'zh-CN';
    return null;
}
export function translateFor(language, key, params = {}, depth = 0) {
    const selected = normalizeLocale(language) || 'ko';
    const source = catalogs[selected][key] ?? catalogs.ko[key] ?? key;
    return source.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, name) =>
        Object.hasOwn(params, name) ? (params[name]?.messageKey && depth < 4 ?
            translateFor(selected, params[name].messageKey, params[name].messageParams || {}, depth + 1) : String(params[name])) : token);
}
export const getLocale = () => locale;
export const t = (key, params = {}) => translateFor(locale, key, params);
export function message(key, params = {}) {
    return {messageKey: key, messageParams: {...params}, message: translateFor('ko', key, params)};
}
export function formatError(error) {
    return error?.messageKey ? t(error.messageKey, error.messageParams || {}) :
        (typeof error === 'string' ? error : error?.message || '');
}
export function mark(key, params = {}) {
    return 'data-i18n="' + escape(key) + '" data-i18n-params="' + escape(JSON.stringify(params)) + '"';
}
export function text(key, params = {}) {
    return '<span ' + mark(key, params) + '>' + escape(t(key, params)) + '</span>';
}
export function attrs(name, key, params = {}) {
    if (!attributes.includes(name)) throw new Error('Unsupported localized attribute: ' + name);
    return name + '="' + escape(t(key, params)) + '" data-i18n-' + name + '="' + escape(key) +
        '" data-i18n-' + name + '-params="' + escape(JSON.stringify(params)) + '"';
}
export function setText(node, key, params = {}) {
    if (!node) return;
    node.setAttribute('data-i18n', key);
    node.setAttribute('data-i18n-params', JSON.stringify(params));
    node.textContent = t(key, params);
}
export function setAttr(node, name, key, params = {}) {
    if (!node) return;
    if (!attributes.includes(name)) throw new Error('Unsupported localized attribute: ' + name);
    node.setAttribute('data-i18n-' + name, key);
    node.setAttribute('data-i18n-' + name + '-params', JSON.stringify(params));
    node.setAttribute(name, t(key, params));
}
export function setValidity(node, key, params = {}) {
    if (!node) return;
    if (!key) {
        node.removeAttribute('data-i18n-validity');
        node.removeAttribute('data-i18n-validity-params');
        node.setCustomValidity('');
        return;
    }
    node.setAttribute('data-i18n-validity', key);
    node.setAttribute('data-i18n-validity-params', JSON.stringify(params));
    node.setCustomValidity(t(key, params));
}
function paramsFor(node, name) {
    try {
        const value = JSON.parse(node.getAttribute(name) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
}
export function localize(target = root) {
    if (!target) return;
    const selector = ['[data-i18n]', '[data-i18n-validity]', ...attributes.map(name => '[data-i18n-' + name + ']')].join(',');
    const nodes = [...(target.querySelectorAll?.(selector) || [])];
    if (target.matches?.(selector)) nodes.unshift(target);
    for (const node of nodes) {
        const key = node.getAttribute('data-i18n');
        // A marker must own only a text leaf, never an input, icon or nested control.
        if (key && !node.children?.length && !['INPUT','TEXTAREA','SELECT'].includes(node.tagName))
            node.textContent = t(key, paramsFor(node, 'data-i18n-params'));
        const validity = node.getAttribute('data-i18n-validity');
        if (validity) node.setCustomValidity(t(validity, paramsFor(node, 'data-i18n-validity-params')));
        for (const name of attributes) {
            const attributeKey = node.getAttribute('data-i18n-' + name);
            if (attributeKey) node.setAttribute(name, t(attributeKey, paramsFor(node, 'data-i18n-' + name + '-params')));
        }
    }
    if (target.documentElement) target.documentElement.lang = locale;
}
export function onLocaleChange(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
}
export function setLocale(value, {persist = true} = {}) {
    if (!SUPPORTED_LOCALES.includes(value)) return false;
    const changed = locale !== value;
    locale = value;
    if (persist) { try { storage?.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* Session choice still works. */ } }
    localize();
    if (changed) for (const callback of subscribers) {
        try { callback(locale); } catch { /* One view must not block other locale subscribers. */ }
    }
    return true;
}
export function initLocale({storage: preferenceStorage, languages = [], document: target} = {}) {
    storage = preferenceStorage;
    root = target;
    let saved;
    try { saved = storage?.getItem(LOCALE_STORAGE_KEY); } catch { /* Restricted storage is optional. */ }
    const selected = SUPPORTED_LOCALES.includes(saved) ? saved :
        languages.map(normalizeLocale).find(Boolean) || 'ko';
    setLocale(selected, {persist: false});
    return locale;
}
