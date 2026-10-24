import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDemoProject} from '../dist/core/project.mjs';
import {settingsPanelMarkup} from '../dist/panel-markup.mjs';

test('both editable trim surfaces allow arbitrary fractional values without a tenth-second step grid',()=>{
  const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  for(const id of ['trimStart','trimEnd']){
    const input=html.match(new RegExp('<input[^>]+id="'+id+'"[^>]*>'))?.[0];
    assert.ok(input,id);assert.match(input,/type="number"/);assert.match(input,/step="any"/);assert.match(input,/min="0"/);
  }
  const project=createDemoProject();
  for(const clip of [{start:1.234567,end:11.987654},{start:1e-7,end:0.1000001}]){
    const markup=settingsPanelMarkup(project,clip);
    for(const [id,value] of [['panelTrimStart',clip.start],['panelTrimEnd',clip.end]]){
      const input=markup.match(new RegExp('<input[^>]+id="'+id+'"[^>]*>'))?.[0];
      assert.ok(input,id);assert.match(input,/type="number"/);assert.match(input,/step="any"/);
      assert.equal(Number(input.match(/value="([^"]*)"/)[1]),value);
    }
  }
});
