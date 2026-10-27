import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
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

test('engines without Intl retain bounded legacy code-point wrapping rather than failing draw',()=>{
 const moduleUrl=new URL('../dist/typography.mjs',import.meta.url).href;
 for(const unavailable of ['undefined','{}']){
  const result=spawnSync(process.execPath,['--input-type=module','--eval',`
   import assert from 'node:assert/strict';
   globalThis.Intl=${unavailable};
   const {measureLines}=await import(${JSON.stringify(moduleUrl)});
   const context={measureText:text=>({width:Array.from(text).length*10})};
   assert.deepEqual(measureLines(context,'e\\u0301🇰🇷',10),['e','\\u0301','🇰','🇷']);
   assert.equal(measureLines(context,'x'.repeat(100),10).length,100);
  `],{encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
  assert.equal(result.error,undefined);
  assert.equal(result.signal,null);
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,'');
  assert.equal(result.stderr,'');
 }
});
