import {createShellPresentation} from '../../dist/shell-presentation.mjs';
import * as i18n from '../../dist/i18n.mjs';
import { createSeekDialog } from '../../dist/seek-dialog.mjs';
import { createCaptionInspectionDialog } from '../../dist/caption-inspection-dialog.mjs';
import { shiftCaptionTiming } from '../../dist/core/caption-timing.mjs';
import { replaceCaptionText } from '../../dist/core/caption-text.mjs';
import { createTemplateWorkspace } from '../../dist/template-workspace.mjs';
import { createMediaSources } from '../../dist/media-sources.mjs';
import { createProjectPersistence } from '../../dist/project-persistence.mjs';
import { createCaptionGeneration } from '../../dist/caption-generation.mjs';
import { createInspectorView } from '../../dist/inspector-view.mjs';
import { bindPreviewDrag, bindEditorKeyboard } from '../../dist/editor-interactions.mjs';
import { createTemplatePreview } from '../../dist/template-preview.mjs';
import { createVideoExport } from '../../dist/video-export.mjs';
import { createAudioRecording } from '../../dist/audio-recording.mjs';
import { createTranscriptionClient } from '../../dist/transcription-client.mjs';
import * as panelMarkup from '../../dist/panel-markup.mjs';
import { icon, esc, fmt, decimalTime } from '../../dist/ui-format.mjs';
import * as projectModule from '../../dist/core/project.mjs';
import { prepareCommand } from '../../dist/core/commands.mjs';
import { CommandError, LocalizedError, hasMinimumDuration } from '../../dist/core/validation.mjs';
import { createEditorService } from '../../dist/integration/editor-service.mjs';
import * as captionModule from '../../dist/captions.mjs';
import { adjacentCut, renderCaptionTrack, renderCaptionTrackError, updateTimelineMarkup, createTimelineView } from '../../dist/timeline-view.mjs';
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
  const panelSource=['shell-presentation.mjs','design-panel.mjs','effects-panel.mjs','template-gallery.mjs','template-workspace.mjs','panel-markup.mjs','template-preview.mjs','inspector-view.mjs','timeline-view.mjs','caption-panel.mjs','playback.mjs','export-flow.mjs','media-loader.mjs','design-workspace.mjs','workspace-panels.mjs','app-bindings.mjs','editing-actions.mjs','caption-flow.mjs'].map(f=>fs.readFileSync(new URL('../../dist/'+f,import.meta.url),'utf8')).join('\n');
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
   const attributes = new Map();
   const e = {
     value: '', innerHTML: '', textContent: '', hidden: false,
     style: { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } },
     dataset: {},
     clientWidth: 700, clientHeight: 500, width: 540, height: 960,
     currentTime: 0, duration: 12, readyState: 4, videoWidth: 1920, videoHeight: 1080,
     classList: { add() {}, remove() {}, toggle() {} },
     setAttribute(name,value) { attributes.set(name,String(value)); if(name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value); if(name==='title') this.title=String(value); },
     getAttribute(name) { return attributes.get(name) ?? null; },
     removeAttribute(name) { attributes.delete(name); if(name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]; },
     setCustomValidity(value) { this.validationMessage=value; },
     setPointerCapture() {},
     addEventListener() {}, removeEventListener() {}, insertAdjacentHTML() {},
     getContext() { return context2d; },
     querySelector(selector) { return selector === '.icon' ? null : element(key + ' ' + selector); },
     querySelectorAll() { return []; },
     focus(options) {
       doc.activeElement = this;
       focusEvents.push({ target: this, action: 'focus', options });
     },
     scrollIntoView(options) { focusEvents.push({ target: this, action: 'scroll', options }); },
     setSelectionRange(start, end) { this.selectionStart=start;this.selectionEnd=end; },
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
    querySelector: element, querySelectorAll: selector => selector.includes('[data-i18n') ? [...elements.values()].filter(node => [...['data-i18n','data-i18n-validity',...['aria-label','title','placeholder','alt','aria-valuetext','content','data-label'].map(name=>'data-i18n-'+name)]].some(name=>node.getAttribute?.(name))) : [],
    documentElement: {lang: 'ko'},
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
    ...i18n, createShellPresentation, msg: i18n.message, ...projectModule, createSeekDialog, createCaptionInspectionDialog, replaceCaptionText, prepareCommand, CommandError, LocalizedError, hasMinimumDuration, createEditorService, ...captionModule,
    adjacentCut, renderCaptionTrack, renderCaptionTrackError, updateTimelineMarkup, createTimelineView, createInspectorView, createInputHistory,
    ...effectsModule, ...templateModule, readTemplateLibrary, validateTemplateLibrary,
    mountTemplateGallery, mountEffectsPanel, ...typographyModule, createCompositionRenderer,
    createTemplateWorkspace: options => createTemplateWorkspace(options, {
      readStorage: key => context.localStorage.getItem(key),
      writeStorage: (key, value) => context.localStorage.setItem(key, value),
      mount: (root, options) => context.mountTemplateGallery(root, options),
    }),
    createProjectStore, createTranscriptionClient, createVideoExport, bindPreviewDrag, bindEditorKeyboard,
    createMediaSources: options => createMediaSources(options, {
      createURL: file => context.URL.createObjectURL(file),
      revokeURL: url => context.URL.revokeObjectURL(url),
      createCanvas: () => context.document.createElement('canvas'),
      setTimer: (callback, delay) => context.setTimeout(callback, delay),
      clearTimer: timer => context.clearTimeout(timer),
    }),
    createProjectPersistence: options => createProjectPersistence(options, {
      readSettings: key => context.localStorage.getItem(key),
      writeSettings: (key, value) => context.localStorage.setItem(key, value),
      setTimer: (callback, delay) => context.setTimeout(callback, delay),
      clearTimer: timer => context.clearTimeout(timer),
    }),
    createCaptionGeneration: options => createCaptionGeneration(options, {
      createAudioContext: () => new context.AudioContext(),
      createOfflineContext: (...args) => new context.OfflineAudioContext(...args),
    }),
    createTemplatePreview: options => createTemplatePreview(options, {
      requestFrame: callback => context.requestAnimationFrame(callback),
      cancelFrame: id => context.cancelAnimationFrame(id),
      clock: () => context.performance.now(),
    }),
    createAudioRecording: callbacks => createAudioRecording(callbacks, {
      acquireStream: () => context.navigator.mediaDevices.getUserMedia({ audio: true }),
      createRecorder: stream => new context.MediaRecorder(stream),
      createFile: (chunks, name, options) => new context.File(chunks, name, options),
      setTimer: (callback, delay) => context.setInterval(callback, delay),
      clearTimer: timer => context.clearInterval(timer),
    }), shiftCaptionTiming, mountDesignPanel, ...panelMarkup, icon, esc, fmt, decimalTime,
  });
  // Keep the existing split-helper fault injection in this VM without a production test hook.
  const captionPanelSource=fs.readFileSync(new URL('../../dist/caption-panel.mjs',import.meta.url),'utf8');
  context.createCaptionPanel=vm.runInContext('(()=>{'+captionPanelSource.replace(/^import .*;$/gm,'').replace('export function','function')+';return createCaptionPanel;})()',context);
  // Preserve the parser fault injection without adding a production-only dependency hook.
  const textWorkflowSource=fs.readFileSync(new URL('../../dist/text-file-workflow.mjs',import.meta.url),'utf8');
  context.createTextFileWorkflow=vm.runInContext('(()=>{'+textWorkflowSource.replace(/^import .*;$/gm,'').replace('export function','function')+';return createTextFileWorkflow;})()',context);
  // Load extracted app modules in this VM so timers, promises and DOM access keep the
  // same realm semantics the browser app has (the host realm would add microtask hops).
  const loadFactory=(file,name)=>{
    const moduleSource=fs.readFileSync(new URL('../../dist/'+file,import.meta.url),'utf8');
    context[name]=vm.runInContext('(()=>{'+moduleSource.replace(/^import .*;$/gm,'').replace('export function','function')+';return '+name+';})()',context);
  };
  loadFactory('playback.mjs','createPlayback');
  loadFactory('export-flow.mjs','createExportFlow');
  loadFactory('media-loader.mjs','createMediaLoader');
  loadFactory('design-workspace.mjs','createDesignWorkspace');
  loadFactory('workspace-panels.mjs','createWorkspacePanels');
  loadFactory('app-bindings.mjs','bindUi');
  loadFactory('editing-actions.mjs','createEditingActions');
  loadFactory('caption-flow.mjs','createCaptionFlow');
  vm.runInContext(source.replace(/^import .*;$/gm,'').replace(/init\(\);\s*$/,'globalThis.ready=init();'),context);
  await context.ready;
  for(const [id,cb] of pendingFrames){pendingFrames.delete(id);cb(performance.now());}
  assert.equal(pendingFrames.size,0,'A paused editor must not schedule a perpetual animation loop');
  const evaluate=code=>JSON.parse(JSON.stringify(vm.runInContext(code,context)));
  return { source, context, evaluate, element, doc, context2d, pendingFrames, focusEvents, documentEvents,
    get measurementCalls() { return measurementCalls; } };
}
