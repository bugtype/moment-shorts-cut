import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {measureLines,createTypographyRenderer} from '../dist/typography.mjs';
import {createCanvasTrace} from './fixtures/canvas-trace.mjs';

const context={measureText:text=>({width:Array.from(text).length*10})};
const clusters=['e\u0301','한','🇰🇷','👍🏽','👨‍👩‍👧‍👦'];
for(const cluster of clusters){
 test(`visual wrapping preserves the complete grapheme ${cluster}`,()=>{
  assert.deepEqual(measureLines(context,cluster+cluster,10),[cluster,cluster]);
  assert.deepEqual(measureLines(context,'A'+cluster+'B',10),['A',cluster,'B']);
 });
}

test('paragraphs and ASCII whitespace retain existing wrapping semantics',()=>{
 const legacy=(text,max)=>{const lines=[];for(const paragraph of text.split('\n')){let line='';for(const char of paragraph){if(line&&context.measureText(line+char).width>max){lines.push(line.trimEnd());line=char.trimStart();}else line+=char;}lines.push(line);}return lines;};
 for(const text of ['','abc def',' ab  cd ','\nA\n\nB\n','\t A B \t','longword','a\r b'])
  for(const max of [0,10,20,35,100])assert.deepEqual(measureLines(context,text,max),legacy(text,max));
 assert.deepEqual(measureLines(context,'A \u0301B',10),['A',' \u0301','B']);
 assert.deepEqual(measureLines(context,' \u0301 A',20),[' \u0301','A']);
});

test('shared typography sprite rendering sends intact graphemes to canvas text drawing',()=>{
 const trace=createCanvasTrace(),renderer=createTypographyRenderer(trace.makeCanvas);
 const value=clusters.join('');
 renderer.label(trace.context,value,10,20,{size:20,maxWidth:10,maxHeight:1000,color:'#ffffff',stroke:1});
 const fill=trace.events.filter(e=>e[1]==='fillText').map(e=>e[2]);
 const stroke=trace.events.filter(e=>e[1]==='strokeText').map(e=>e[2]);
 assert.deepEqual(fill,clusters);assert.deepEqual(stroke,clusters);assert.equal(fill.join(''),value);
});

test('engines without Intl retain bounded legacy code-point wrapping rather than failing draw',async()=>{
 const source=await fs.readFile(new URL('../dist/typography.mjs',import.meta.url),'utf8');
 for(const Intl of [undefined,{}]){
  const sandbox=vm.createContext({Intl});
  vm.runInContext(source.replace(/^import .*;$/gm,'').replace(/^export /gm,''),sandbox);
  sandbox.ctx=context;sandbox.value='e\u0301🇰🇷';
  const result=vm.runInContext('measureLines(ctx,value,10)',sandbox);
  assert.deepEqual(Array.from(result),['e','\u0301','🇰','🇷']);
  sandbox.value='x'.repeat(100);assert.equal(vm.runInContext('measureLines(ctx,value,10).length',sandbox),100);
 }
});
