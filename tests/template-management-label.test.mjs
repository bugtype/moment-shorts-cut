import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppFixture} from './fixtures/app.mjs';
import {setLocale} from '../dist/i18n.mjs';

// Actual app handlers and emitted markup, not native accessibility-tree/voice QA.
const decode=value=>value.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g, entity=>({'&quot;':'\"','&#39;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'}[entity]));
for (const locale of ['ko','en','zh-CN']) for (const authoredName of ['Distinct style', '<A & \"B\">']) {
 test(`saved template management names contain visible labels in ${locale} for ${authoredName}`,async()=>{
  const f=await createAppFixture();setLocale(locale,{persist:false});
  const before=f.evaluate('state');
  f.evaluate("switchPanel('templates');true");
  f.element('#panelContent #saveMyTemplate').onclick();
  f.element('#customTemplateName').value=authoredName;
  f.element('#saveCustomTemplate').onclick();
  const html=f.element('#panelContent #templateGrid').innerHTML;
  const buttons=[...html.matchAll(/<button\b([^>]*\bdata-(update|export|rename|duplicate|remove)-template="[^"]+"[^>]*)>([\s\S]*?)<\/button>/g)];
  assert.equal(buttons.length,5);
  for (const [,attrs,action,body] of buttons) {
   const name=decode(/\saria-label="([^"]+)"/.exec(attrs)?.[1] || '');
   const visible=body.replace(/<[^>]*>/g,'').replace(/…/g,'').trim();
   assert.ok(name.includes(visible),`${action}: ${JSON.stringify(name)} contains ${JSON.stringify(visible)}`);
   assert.ok(name.includes(authoredName));
   assert.match(attrs,/data-i18n-aria-label=/);
  }
  assert.deepEqual(f.evaluate('state'),before);
  assert.equal(f.evaluate('history.length'),0);
 });
}
