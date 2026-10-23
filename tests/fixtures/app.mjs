import * as panelMarkup from '../../dist/panel-markup.mjs';
import { icon, esc, fmt } from '../../dist/ui-format.mjs';
import * as projectModule from '../../dist/core/project.mjs';
import { prepareCommand } from '../../dist/core/commands.mjs';
import { CommandError } from '../../dist/core/validation.mjs';
import { createEditorService } from '../../dist/integration/editor-service.mjs';
import * as captionModule from '../../dist/captions.mjs';
import { renderCaptionTrack, renderCaptionTrackError, updateTimelineMarkup } from '../../dist/timeline-view.mjs';
import { createInputHistory } from '../../dist/input-history.mjs';
import { createTrack } from './timeline-dom.mjs';
import * as effectsModule from '../../dist/effects.mjs';
import * as templateModule from '../../dist/template-catalog.mjs';
import {readTemplateLibrary,validateTemplateLibrary} from '../../dist/template-library.mjs';
import { mountTemplateGallery } from '../../dist/template-gallery.mjs';
import { mountEffectsPanel } from '../../dist/effects-panel.mjs';
import * as typographyModule from '../../dist/typography.mjs';
import { createCompositionRenderer } from '../../dist/composition-renderer.mjs';
import { createProjectStore } from '../../dist/project-store.mjs';
import { mountDesignPanel } from '../../dist/design-panel.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Synthetic DOM/media only. Each call owns a separate VM, controls and event queues.
export async function createAppFixture() {
  const source=fs.readFileSync(new URL('../../dist/app.js',import.meta.url),'utf8');
  const panelSource=['design-panel.mjs','effects-panel.mjs','template-gallery.mjs','panel-markup.mjs'].map(f=>fs.readFileSync(new URL('../../dist/'+f,import.meta.url),'utf8')).join('\n');
  const html=fs.readFileSync(new URL('../../dist/index.html',import.meta.url),'utf8');
  const ids=new Set([...`${html}\n${source}\n${panelSource}`.matchAll(/id="([\w-]+)"/g)].map(m=>m[1]));
  const selectors=[...source.matchAll(/\$\('#([\w-]+)'\)/g)].map(m=>m[1]);
  assert.deepEqual([...new Set(selectors.filter(id=>!ids.has(id)))],[], 'Every fixed DOM ID must be declared');
  const htmlIds=[...html.matchAll(/id="([\w-]+)"/g)].map(m=>m[1]);
  assert.equal(htmlIds.length,new Set(htmlIds).size,'No duplicate IDs in the page');

  const elements=new Map(),focusEvents=[];
  let measurementCalls=0;
  const context2d = new Proxy({}, {
    get(target, key) {
      if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (key === 'measureText') return text => {
        measurementCalls++;
        return { width: text.length * 10 };
      };
      return () => {};
    },
  });
  function element(key=''){
   if(elements.has(key))return elements.get(key);
   const e = {
     value: '', innerHTML: '', textContent: '', hidden: false, style: {}, dataset: {},
     clientWidth: 700, clientHeight: 500, width: 540, height: 960,
     currentTime: 0, duration: 12, readyState: 4, videoWidth: 1920, videoHeight: 1080,
     classList: { add() {}, remove() {}, toggle() {} },
     setAttribute() {}, setPointerCapture() {}, removeAttribute() {},
     addEventListener() {}, removeEventListener() {}, insertAdjacentHTML() {},
     getContext() { return context2d; },
     querySelector(selector) { return selector === '.icon' ? null : element(key + ' ' + selector); },
     querySelectorAll() { return []; },
     focus(options) {
       doc.activeElement = this;
       focusEvents.push({ target: this, action: 'focus', options });
     },
     scrollIntoView(options) { focusEvents.push({ target: this, action: 'scroll', options }); },
     pause() {}, play() { return Promise.resolve(); },
     getBoundingClientRect() { return { left: 0, top: 0, width: 540, height: 960 }; },
     showModal() { this.open = true; }, close() { this.open = false; },
   };
   elements.set(key,e);return e;
  }
  let canvasCount=0,rafCounter=0;const pendingFrames=new Map();
  Object.assign(element('#captionTrack'),createTrack());
  for(const id of ['zoom','volume','audioVolume','mobileZoom','captionSize','captionY','panelVolume'])element('#'+id).type='range';
  for(const id of ['trimStart','trimEnd','panelTrimStart','panelTrimEnd']){
   const control=element('#'+id);control.type='number';
   // Model the numeric getter contract; this is not browser input sanitization.
   Object.defineProperty(control,'valueAsNumber',{configurable:true,get(){const value=String(this.value);return value.trim()===''?NaN:Number(value);}});
  }
  const documentEvents=new Map();
  const doc = {
    querySelector: element, querySelectorAll: () => [],
    addEventListener(name, handler) { documentEvents.set(name, handler); },
    body: element('body'), fonts: { ready: Promise.resolve() },
    createElement: () => element('canvas-' + (++canvasCount)),
  };
  const context = vm.createContext({
    document: doc, window: { addEventListener() {} }, Image: class { complete = false; },
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame(callback) {
      pendingFrames.set(++rafCounter, callback);
      return rafCounter;
    },
    cancelAnimationFrame(id) { pendingFrames.delete(id); },
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    console, URL, Blob, TextDecoder, performance, Number, Math, Promise, structuredClone,
    ...projectModule, prepareCommand, CommandError, createEditorService, ...captionModule,
    renderCaptionTrack, renderCaptionTrackError, updateTimelineMarkup, createInputHistory,
    ...effectsModule, ...templateModule, readTemplateLibrary, validateTemplateLibrary,
    mountTemplateGallery, mountEffectsPanel, ...typographyModule, createCompositionRenderer,
    createProjectStore, mountDesignPanel, ...panelMarkup, icon, esc, fmt,
  });
  vm.runInContext(source.replace(/^import .*;$/gm,'').replace(/init\(\);\s*$/,'globalThis.ready=init();'),context);
  await context.ready;
  for(const [id,cb] of pendingFrames){pendingFrames.delete(id);cb(performance.now());}
  assert.equal(pendingFrames.size,0,'A paused editor must not schedule a perpetual animation loop');
  const evaluate=code=>JSON.parse(JSON.stringify(vm.runInContext(code,context)));
  return { source, context, evaluate, element, doc, context2d, pendingFrames, focusEvents, documentEvents,
    get measurementCalls() { return measurementCalls; } };
}
