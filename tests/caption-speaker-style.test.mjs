import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoProject,projectSubtitles} from '../dist/core/project.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {createTypographyRenderer} from '../dist/typography.mjs';
import {createCanvasTrace} from './fixtures/canvas-trace.mjs';
const update=(p,patch)=>prepareCommand(p,'captions.style.update',{patch});
test('speaker presentation patches preserve exact cue clocks/assignments and sidecars with detached arrays',()=>{
 const p=createDemoProject();p.clips=[{start:1,end:3}];p.captions[0].speaker='0';p.captions[1].speaker='1';p.captions[1].basis='timeline';p.captions[1].timing='estimated';
 const before=structuredClone(p),labels=['','😀'.repeat(40)],colors=['#AbCdEf','#12345678'];
 const r=update(p,{speakerLabels:labels,speakerColors:colors});assert.deepEqual(r.project,{...before,speakerLabels:labels,speakerColors:colors});assert.deepEqual(p,before);
 for(const format of ['srt','vtt','txt'])assert.equal(projectSubtitles(r.project,{format}),projectSubtitles(p,{format}));
 labels[0]='caller changed';colors[0]='#000000';assert.equal(r.project.speakerLabels[0],'');assert.equal(r.project.speakerColors[0],'#AbCdEf');r.project.speakerLabels[1]='result changed';assert.deepEqual(p,before);
 assert.deepEqual(update(p,{speakerLabels:['A','B']}).project.speakerColors,p.speakerColors);
 assert.deepEqual(update(p,{speakerColors:['#000000','#ffffff']}).project.speakerLabels,p.speakerLabels);
});
test('malformed arrays, colors and UTF16 limits reject the whole patch',()=>{
 const p=createDemoProject(),before=structuredClone(p);
 for(const speakerLabels of [[],['one'],['one','two','three'],null,'names',['A',1],['A','😀'.repeat(41)]])assert.throws(()=>update(p,{captionSize:55,speakerLabels}),e=>e.code==='INVALID_ARGUMENT');
 for(const speakerColors of [[],['#ffffff'],['#ffffff','#000000','#ffffff'],null,['red','#000000'],['#fff','#000000'],['#12345g','#000000'],['#1234567','#000000']])assert.throws(()=>update(p,{captionSize:55,speakerColors}),e=>e.code==='INVALID_ARGUMENT');
 assert.deepEqual(p,before);
});
test('speaker patch participates in atomic batch and read-only preflight',()=>{
 const p=createDemoProject(),operation={command:'captions.style.update',arguments:{patch:{speakerLabels:['Host','Guest'],speakerColors:['#ffffff','#000000']}}};
 const preview=prepareCommand(p,'project.preview',{operations:[operation]});assert.deepEqual(preview.data.changedFields,['speakerColors','speakerLabels']);assert.equal(Object.hasOwn(preview,'project'),false);
 const r=prepareCommand(p,'project.batch',{operations:[operation]});assert.deepEqual(r.project.speakerLabels,['Host','Guest']);
 assert.throws(()=>prepareCommand(p,'project.batch',{operations:[operation,{command:'captions.style.update',arguments:{patch:{speakerColors:['bad','bad']}}}]}));assert.deepEqual(p.speakerLabels,['진행자','게스트']);
});
test('renderer traces honor assigned speaker color/name and preserve highlight precedence',()=>{
 for(const style of ['impact','accent','highlight']){
  const p=update(createDemoProject(),{speakerLabels:['Visible Host','Guest'],speakerColors:['#123456','#abcdef'],style}).project;p.design.title.enabled=false;p.design.credit.enabled=false;
  const trace=createCanvasTrace(),renderer=createTypographyRenderer(trace.makeCanvas),cue={start:0,end:2,text:'Dialogue',speaker:'0'};renderer.draw(trace.context,540,960,p,1,1,cue);
  const drawn=trace.events.filter(e=>e[1]==='fillText');const caption=drawn.find(e=>e[2]==='Dialogue'),label=drawn.find(e=>e[2]==='Visible Host');assert.ok(caption);assert.ok(label);
  const colorFor=event=>trace.events.slice(0,trace.events.indexOf(event)).filter(e=>e[0]===event[0]&&e[1]==='fillStyle').at(-1)?.[2];
  assert.equal(colorFor(caption),style==='highlight'?'#10160b':'#123456');assert.equal(colorFor(label),'#123456');
 }
});
