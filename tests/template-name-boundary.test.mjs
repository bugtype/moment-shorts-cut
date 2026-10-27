import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {setLocale, translateFor} from '../dist/i18n.mjs';

const unescape = value => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"})[entity]);
async function openSave(name, locale='ko') {
    const f = await createAppFixture(), writes = [];
    f.context.localStorage.setItem = (key, value) => writes.push({key,value});
    f.context.projectName = name;
    vm.runInContext(`setLocale(${JSON.stringify(locale)},{persist:false});state.name=projectName;panel='templates';renderPanel();`, f.context);
    const before = f.evaluate('({state,history,future,current})');
    f.element('#panelContent').querySelector('#saveMyTemplate').onclick();
    const tag = f.element('#modal').innerHTML.match(/<input[^>]*id="customTemplateName"[^>]*>/)[0];
    const value = unescape(tag.match(/value="([^"]*)"/)[1]);
    // Model only HTML value initialization; no native maxlength/IME/browser claim.
    const input = f.element('#customTemplateName'); input.value = value;
    return {f,writes,before,input,value,tag,save:()=>f.element('#saveCustomTemplate').onclick()};
}
const stored = f => JSON.parse(f.writes.find(write=>write.key==='moment-templates-v1').value);

test('Save style suggests a bounded whole-codepoint name, including the 39-unit plus emoji boundary in every locale', async()=>{
    try {
        for (const locale of ['ko','en','zh-CN']) {
            for (const name of ['가'.repeat(39)+'🎬', 'e\u0301'.repeat(24), '👩\u200d💻'.repeat(10)]) {
                const f=await openSave(name,locale), full=translateFor(locale,'templates.suggestName',{name});
                assert.match(f.tag,/maxlength="40"/);
                assert.ok(f.value.length<=40,`${locale}: suggestion exceeds the existing UTF-16 limit`);
                assert.equal(f.value.isWellFormed(),true);
                assert.ok(full.startsWith(f.value)); // Not normalization or grapheme segmentation.
                if(f.value.length<full.length) assert.ok(f.value.length+[...full.slice(f.value.length)][0].length>40);
                f.save();
                assert.equal(stored(f)[0].name,f.value.trim(),'save must retain the displayed suggestion');
                assert.equal(stored(f)[0].name.isWellFormed(),true);
                assert.deepEqual(f.f.evaluate('({state,history,future,current})'),f.before);
            }
        }
    } finally { setLocale('ko',{persist:false}); }
});

test('short escaped suggestions and exact 40-unit authored template names retain their text', async()=>{
    for (const name of ['Source & <🎬>', '원본']) {
        const f=await openSave(name);
        assert.equal(f.value,translateFor('ko','templates.suggestName',{name}));
        f.input.value='🎬'.repeat(20);f.save();
        assert.equal(stored(f)[0].name,'🎬'.repeat(20));
        assert.deepEqual(f.f.evaluate('({state,history,future,current})'),f.before);
    }
});

test('overlong programmatic Save submissions are rejected without truncation and can be corrected in place', async()=>{
    try {
        for (const locale of ['ko','en','zh-CN']) {
            const f=await openSave('Original',locale);
            for (const invalid of ['가'.repeat(39)+'🎬','x'.repeat(41)]) {
                f.input.value=invalid;f.save();
                assert.deepEqual(f.writes,[]);
                assert.equal(f.input.value,invalid);
                assert.equal(f.f.element('#modal').open,true);
                assert.equal(f.f.element('#toast').textContent,translateFor(locale,'templates.nameLength'));
                assert.deepEqual(f.f.evaluate('({state,history,future,current})'),f.before);
            }
            f.input.value='  Corrected 🎬  ';f.save();
            assert.equal(stored(f)[0].name,'Corrected 🎬');
            assert.equal(f.writes.length,1);
        }
    } finally { setLocale('ko',{persist:false}); }
});
