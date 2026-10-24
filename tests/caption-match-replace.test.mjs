import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale,setLocale} from '../dist/i18n.mjs';

async function fixture(texts=['😀 Mina met Mina','Mina arrived']) {
    const f=await createAppFixture();f.context.inputTexts=texts;
    vm.runInContext("state.duration=20000;state.clips=[{start:0,end:20000}];state.captions=inputTexts.map((text,i)=>({start:i,end:i+1,text,basis:i%2?'timeline':'source',timing:'estimated',speaker:'1',keywords:'keep'}));current=2;history=[];future=[];switchPanel('captions');",f.context);
    f.input=(id,value)=>{const node=f.element('#'+id);node.value=value;node.oninput();};
    f.find=(find,replacement)=>{f.input('captionFind',find);f.input('captionReplacement',replacement);};
    f.next=()=>f.element('#nextCaptionMatch').onclick();
    f.previous=()=>f.element('#previousCaptionMatch').onclick();
    // Fixture DOM does not parse textarea initial text; emulate the rendered value.
    f.row=index=>{const node=f.element(`[data-caption-text="${index}"]`);node.value=f.evaluate(`state.captions[${index}].text`);return node;};
    f.replace=()=>f.element('#replaceCaptionMatch').onclick({});
    return f;
}

test('replace one UTF16 literal match, skip inserted query on Next, preserve metadata and one undo',async()=>{
    const f=await fixture();const before=f.evaluate('state');f.find('Mina','Mina $&$1');f.next();f.row(0);
    assert.deepEqual([f.doc.activeElement.selectionStart,f.doc.activeElement.selectionEnd],[3,7]);
    f.replace();assert.equal(f.evaluate('state.captions[0].text'),'😀 Mina $&$1 met Mina');
    assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('current'),2);
    const after=f.evaluate('state');after.captions[0].text=before.captions[0].text;assert.deepEqual(after,before);
    assert.equal(f.element('#replaceCaptionMatch').disabled,true);
    f.next();assert.equal(f.doc.activeElement,f.element('[data-caption-text="0"]'));
    assert.deepEqual([f.doc.activeElement.selectionStart,f.doc.activeElement.selectionEnd],[17,21]);
    f.next();assert.equal(f.doc.activeElement,f.element('[data-caption-text="1"]'));
    f.next();assert.deepEqual([f.doc.activeElement.selectionStart,f.doc.activeElement.selectionEnd],[3,7]);
    vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);
    vm.runInContext('undo(true)',f.context);assert.equal(f.evaluate('state.captions[0].text'),'😀 Mina $&$1 met Mina');
});

test('nonoverlap search, crosspage focus and replacement anchor survive rerenders',async()=>{
    const f=await fixture(Array.from({length:101},(_,i)=>i===50?'aaaa':i===100?'aa':'none'));
    f.find('aa','aa!');f.next();assert.match(f.element('#panelContent').innerHTML,/data-caption-text="50"/);f.row(50);f.replace();
    vm.runInContext('renderPanel()',f.context);assert.equal(f.element('#captionFind').value,'aa');assert.equal(f.element('#captionReplacement').value,'aa!');
    f.next();assert.deepEqual([f.doc.activeElement.selectionStart,f.doc.activeElement.selectionEnd],[3,5]);
    f.next();assert.equal(f.doc.activeElement,f.element('[data-caption-text="100"]'));
    f.previous();assert.equal(f.doc.activeElement,f.element('[data-caption-text="50"]'));assert.deepEqual([f.doc.activeElement.selectionStart,f.doc.activeElement.selectionEnd],[3,5]);
    assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('current'),2);
});

test('same replacement, blank result and excessive length are atomic and leave selection usable',async()=>{
    const f=await fixture(['Mina']);f.find('Mina','Mina');f.next();f.row(0);f.replace();assert.equal(f.evaluate('history.length'),0);
    for(const replacement of ['', '  ', 'x'.repeat(2001)]){
        f.input('captionReplacement',replacement);f.replace();assert.equal(f.evaluate('state.captions[0].text'),'Mina');assert.equal(f.evaluate('history.length'),0);
    }
    f.input('captionReplacement','ok');f.replace();assert.equal(f.evaluate('state.captions[0].text'),'ok');
    const large=await fixture(['x'.repeat(1999)+'a']);large.find('a','zz');large.next();large.row(0);large.replace();assert.equal(large.evaluate('history.length'),0);
    const empty=await fixture(['aaa']);empty.find('aa','');empty.next();empty.row(0);empty.replace();assert.equal(empty.evaluate('state.captions[0].text'),'a');
});

test('stale committed text/project, dirty row, detached controls and IME cannot replace',async()=>{
    for(const mutation of ["state.captions[0].text='Mina changed'",'state=structuredClone(state)',"switchPanel('media')",'modal.showModal()', 'loadingMedia=true',"persistence.restorePhase='restoring'", "persistence.restorePhase='failed';persistence.recoveryValid=false"]){
        const f=await fixture();f.find('Mina','Name');f.next();f.row(0);vm.runInContext(mutation,f.context);const before=f.evaluate('state');f.replace();assert.deepEqual(f.evaluate('state'),before);assert.equal(f.evaluate('history.length'),0,mutation);
    }
    const f=await fixture();f.find('Mina','Name');f.next();f.row(0).value='uncommitted';f.replace();assert.equal(f.evaluate('history.length'),0);
    f.row(0);for(const event of [{isComposing:true},{keyCode:229}])f.element('#replaceCaptionMatch').onclick(event);
    f.element('#panelContent').oncompositionstart();f.replace();f.element('#panelContent').oncompositionend();assert.equal(f.evaluate('history.length'),0);
    const old=f.element('#replaceCaptionMatch').onclick;vm.runInContext('renderPanel()',f.context);old({});assert.equal(f.evaluate('history.length'),0);
    f.row(0);f.replace();assert.equal(f.evaluate('history.length'),1);
});

test('failed-valid replacements and undo stay in memory; localized match controls preserve authored text',async()=>{
    try {for(const [locale,label] of [['ko','선택한 일치 바꾸기'],['en','Replace match'],['zh-CN','替换当前匹配']]){
        const f=await fixture(),writes=[];f.context.localStorage.setItem=(...args)=>writes.push(args);setLocale(locale,{persist:false});
        vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true;renderPanel();",f.context);
        assert.ok(f.element('#panelContent').innerHTML.includes(label));f.find('Mina','Name');f.next();f.row(0);f.replace();
        assert.equal(f.evaluate('history.length'),1);await vm.runInContext('saveProject(true);scheduleSave();undo();',f.context);
        assert.deepEqual(writes,[]);assert.equal(f.evaluate('state.captions[0].text'),'😀 Mina met Mina');
    }}finally{initLocale();}
});


test('all search actions reject explicit IME events and counting many repeated matches keeps 50 rendered rows',async()=>{
    const f=await fixture(Array.from({length:10000},()=> 'aa'.repeat(32)));f.find('aa','b');
    assert.equal(f.element('#captionSearchStatus').textContent,'일치 0 / 320000');
    for(const id of ['previousCaptionMatch','nextCaptionMatch','replaceCaptionMatch','replaceAllCaptions'])
        for(const event of [{isComposing:true},{keyCode:229}])f.element('#'+id).onclick(event);
    assert.equal(f.evaluate('history.length'),0);assert.equal(f.element('#captionSearchStatus').textContent,'일치 0 / 320000');
    f.previous();assert.equal(f.doc.activeElement,f.element('[data-caption-text="9999"]'));
    assert.deepEqual([f.doc.activeElement.selectionStart,f.doc.activeElement.selectionEnd],[62,64]);
    assert.equal((f.element('#panelContent').innerHTML.match(/data-caption-text=/g)||[]).length,50);
    f.next();assert.equal(f.doc.activeElement,f.element('[data-caption-text="0"]'));
    assert.deepEqual([f.doc.activeElement.selectionStart,f.doc.activeElement.selectionEnd],[0,2]);
});
