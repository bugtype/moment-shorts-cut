// Render the exact production compositor using a native Canvas implementation.
// This verifies composed frames; it is not a browser screenshot or a codec test.
// Usage: node qa/render-layout.mjs <native-canvas-package> <font-directory>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createDemoProject } from '../dist/core/project.mjs';
import { createCompositionRenderer } from '../dist/composition-renderer.mjs';
import { TEMPLATES, applyTemplate } from '../dist/template-catalog.mjs';
const require=createRequire(import.meta.url);
const {createCanvas,loadImage,GlobalFonts}=require(process.argv[2]||'@napi-rs/canvas');
const fontDir=process.argv[3];
if(fontDir)for(const weight of [400,600,900])GlobalFonts.registerFromPath(path.join(fontDir,`NotoSansKR-${weight}.ttf`),'Noto Sans KR');
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const {draw:paint}=createCompositionRenderer(()=>createCanvas(1,1));
const sample=await loadImage(path.join(root,'dist/sample.svg'));
const out=path.join(root,'qa');
const sheetHeight=140+Math.ceil(TEMPLATES.length/5)*550;
const sheet=createCanvas(1500,sheetHeight),sc=sheet.getContext('2d');
sc.fillStyle='#f5f4ef';sc.fillRect(0,0,1500,sheetHeight);sc.fillStyle='#28332d';sc.font='900 30px "Noto Sans KR"';sc.fillText(`영상 중앙을 비운 ${TEMPLATES.length}가지 구성`,25,46);sc.font='400 16px "Noto Sans KR"';sc.fillText('실제 합성 코드로 렌더링한 샘플 · 배경 박스 없는 타이틀과 대사',25,77);
const comparison=createCanvas(1080,560),cc=comparison.getContext('2d');cc.fillStyle='#f5f4ef';cc.fillRect(0,0,1080,560);
for(const [i,template] of TEMPLATES.entries()){
 const p=createDemoProject();applyTemplate(p,template,true);
 if(template.id==='interview'){p.captions.forEach((cap,i)=>cap.speaker=String(i%2));p.globalKeywords='속도';}
 const canvas=createCanvas(540,960),c=canvas.getContext('2d');
 const fraction=template.id==='recipe'?.4:.1,time=12*fraction;
 paint(c,540,960,p,{source:sample,sw:540,sh:960,ready:true,sourceTime:time,time,total:12,elapsed:time,remaining:12-time,progress:fraction});
 const png=canvas.toBuffer('image/png');
 fs.writeFileSync(path.join(out,`${template.id}.png`),png);
 const x=25+(i%5)*295,y=120+Math.floor(i/5)*550;
 sc.fillStyle='#28332d';sc.font='600 18px "Noto Sans KR"';sc.fillText(template.name,x,y);const still=await loadImage(png);sc.drawImage(still,x,y+16,265,471);
 const j=['reference','explainer','interview','recipe'].indexOf(template.id);
 if(j>=0){const cx=20+j*265;cc.fillStyle='#28332d';cc.font='600 16px "Noto Sans KR"';cc.fillText(template.name,cx,40);cc.drawImage(still,cx,60,245,435);}
 // Midpoint and end-state samples catch timed-question/answer layout regressions.
 if(['explainer','recipe','ranking','product','quiz'].includes(template.id))for(const f of [.45,.85]){
  const t=12*f;paint(c,540,960,p,{source:sample,sw:540,sh:960,ready:true,sourceTime:t,time:t,total:12,elapsed:t,remaining:12-t,progress:f});
  fs.writeFileSync(path.join(out,`${template.id}-${f}.png`),canvas.toBuffer('image/png'));
 }
}
fs.writeFileSync(path.join(out,'all-templates.png'),sheet.toBuffer('image/png'));
fs.writeFileSync(path.join(out,'after-layout.png'),comparison.toBuffer('image/png'));
console.log('Rendered all templates and timed headline states with the production compositor.');
