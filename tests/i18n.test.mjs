import test from 'node:test';
import assert from 'node:assert/strict';
import {messages as shell} from '../dist/i18n/catalogs/shell.mjs';
import {messages as panels} from '../dist/i18n/catalogs/panels.mjs';
import {messages as errors} from '../dist/i18n/catalogs/errors.mjs';
import {messages as templates} from '../dist/i18n/catalogs/templates.mjs';
import {SUPPORTED_LOCALES,LOCALE_STORAGE_KEY,initLocale,getLocale,setLocale,onLocaleChange,
    t,translateFor,normalizeLocale,message,formatError,text,attrs,mark,setText,setAttr,setValidity,localize} from '../dist/i18n.mjs';

function node(tagName='SPAN') {
    const attributes=new Map();
    return {
        tagName,children:[],textContent:'',value:'authored text',selectionStart:3,selectionEnd:3,
        setAttribute(name,value){attributes.set(name,String(value));},
        getAttribute(name){return attributes.get(name)??null;},
        removeAttribute(name){attributes.delete(name);},
        setCustomValidity(value){this.validationMessage=value;},
        matches(){return true;},querySelectorAll(){return [];}
    };
}
function documentFor(...nodes) {
    return {documentElement:{lang:'ko'},querySelectorAll(){return nodes;}};
}
test('all domain catalogs have exactly matching keys and named placeholders without HTML',()=>{
    const seen=new Set(),parameters=value=>[...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match=>match[1]).sort();
    for(const domain of [shell,panels,errors,templates]){
        const keys=Object.keys(domain.ko).sort();
        for(const locale of SUPPORTED_LOCALES){
            assert.deepEqual(Object.keys(domain[locale]).sort(),keys);
            for(const key of keys){
                assert.equal(typeof domain[locale][key],'string');
                assert.deepEqual(parameters(domain[locale][key]),parameters(domain.ko[key]),locale+':'+key);
                assert.doesNotMatch(domain[locale][key],/<\/?[a-z][^>]*>/i,'Catalogs contain plain text, not HTML');
            }
        }
        for(const key of keys){assert.equal(seen.has(key),false,'Duplicate key '+key);seen.add(key);}
    }
});
test('saved language takes priority; navigator fallback and unavailable storage are safe',()=>{
    const writes=[];
    initLocale({storage:{getItem:()=> 'en',setItem:(...args)=>writes.push(args)},languages:['zh-CN'],document:documentFor()});
    assert.equal(getLocale(),'en');
    setLocale('zh-CN');assert.deepEqual(writes,[[LOCALE_STORAGE_KEY,'zh-CN']]);
    assert.equal(setLocale('de'),false);assert.equal(getLocale(),'zh-CN');
    initLocale({storage:{getItem:()=> 'invalid',setItem(){throw new Error('denied');}},languages:['fr','en-GB']});
    assert.equal(getLocale(),'en');assert.doesNotThrow(()=>setLocale('ko'));
    initLocale({storage:{getItem(){throw new Error('denied');}},languages:['zh-Hans-CN']});
    assert.equal(getLocale(),'zh-CN');
    initLocale();assert.equal(getLocale(),'ko');
});
test('text and attribute interpolation escape once; raw messages preserve user text and nested causes',()=>{
    initLocale();
    const value='"><img src=x onerror=alert(1)>&';
    assert.equal(t('shell.clip',{index:value}),'클립 '+value);
    assert.match(text('shell.clip',{index:value}),/&lt;img/);
    assert.doesNotMatch(text('shell.clip',{index:value}),/<img/);
    assert.match(attrs('title','shell.clip',{index:value}),/&quot;/);
    assert.doesNotMatch(attrs('title','shell.clip',{index:value}),/<img/);
    assert.match(mark('shell.clip',{index:value}),/&quot;/);
    const descriptor=message('shell.clip',{index:message('shell.save')});
    assert.equal(descriptor.message,'클립 저장');
    setLocale('en');
    assert.equal(formatError(descriptor),'Clip Save');
    assert.equal(translateFor('ko','shell.save'),'저장');
    assert.equal(formatError(new Error(value)),value);
    assert.throws(()=>attrs('onclick','shell.save'));
    setLocale('ko');
});
test('in-place translation preserves controls, values, caret, children and separate attribute parameters',()=>{
    const label=node(),input=node('INPUT'),container=node(),child=node();
    container.children=[child];
    setText(label,'shell.save');
    setAttr(input,'title','shell.clip',{index:2});
    setAttr(input,'aria-label','shell.clip',{index:3});
    setAttr(input,'placeholder','shell.seekLabel');
    container.setAttribute('data-i18n','shell.save');
    container.textContent='must not replace child';
    input.setAttribute('data-i18n','shell.save');
    const doc=documentFor(label,input,container);
    initLocale({document:doc,languages:['en']});
    assert.equal(label.textContent,'Save');assert.equal(input.getAttribute('title'),'Clip 2');
    assert.equal(input.getAttribute('aria-label'),'Clip 3');
    assert.equal(input.value,'authored text');assert.equal(input.selectionStart,3);
    assert.equal(container.children[0],child);assert.equal(container.textContent,'must not replace child');
    assert.equal(doc.documentElement.lang,'en');
    setLocale('zh-CN');assert.equal(label.textContent,'保存');assert.equal(input.getAttribute('title'),'片段 2');
    assert.equal(input.value,'authored text');assert.equal(input.selectionEnd,3);
    initLocale();
});
test('validity clearing removes its marker; malformed params and failing subscriber are isolated',()=>{
    const input=node('INPUT'),label=node();setValidity(input,'shell.seekRange');setText(label,'shell.save');
    initLocale({document:documentFor(input,label)});
    let called=0;const bad=onLocaleChange(()=>{throw new Error('view failure');}),good=onLocaleChange(()=>called++);
    setLocale('en');assert.equal(called,1);assert.match(input.validationMessage,/output duration/);assert.equal(label.textContent,'Save');
    setValidity(input,'');setLocale('zh-CN');assert.equal(input.validationMessage,'');assert.equal(input.getAttribute('data-i18n-validity'),null);
    label.setAttribute('data-i18n-params','invalid');assert.doesNotThrow(()=>localize(label));
    bad();good();initLocale();
});

test('unsupported language and missing keys have deterministic fallbacks; Chinese variants use Simplified Chinese',()=>{
    for (const input of ['zh','zh-TW','zh-Hant-HK','zh_CN'])
        assert.equal(normalizeLocale(input),'zh-CN');
    assert.equal(normalizeLocale('de-DE'),null);
    assert.equal(normalizeLocale(undefined),null);
    assert.equal(translateFor('de-DE','shell.save'),'저장');
    assert.equal(translateFor('en','missing.example'),'missing.example');
    assert.equal(translateFor('zh-TW','shell.save'),'保存');
    assert.equal(translateFor('en','shell.clip'),'Clip {index}');
});
