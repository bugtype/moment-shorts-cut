import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {TEMPLATES} from '../dist/template-catalog.mjs';

// Explicit CLI adapter: records commands in JSON, never creates native PNG pixels.
const adapter = `
const fs = require('node:fs');
const path = require('node:path');
const fonts = []; let serial = 0;
module.exports = {
  GlobalFonts: {registerFromPath(file, family) { fonts.push([path.basename(file), family]); }},
  async loadImage(input) {
    if (Buffer.isBuffer(input)) return JSON.parse(input.toString());
    if (path.basename(input) !== 'sample.svg') throw Error('Unexpected input image');
    fs.readFileSync(input);
    return {id:'sample', width:540, height:960};
  },
  createCanvas(width, height) {
    const events = [], canvas = {id:++serial, width, height};
    const context = new Proxy({}, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'measureText') return text => ({width:String(text).length * 10});
        if (key === 'createRadialGradient') return () => ({addColorStop(){}});
        return (...args) => events.push([key, ...args.map(arg => arg?.id ? {id:arg.id, width:arg.width, height:arg.height} : arg)]);
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    canvas.getContext = type => { if (type !== '2d') throw Error('Unexpected context'); return context; };
    canvas.toBuffer = type => {
      if (type !== 'image/png') throw Error('Unexpected encoding');
      return Buffer.from(JSON.stringify({synthetic:true, id:canvas.id, width:canvas.width, height:canvas.height, events, fonts}));
    };
    return canvas;
  },
};
`;

test('layout QA CLI uses the shared compositor and keeps every current template inside its sheet', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'moment layout-한글-'));
  try {
    const qa = path.join(directory, 'qa');
    await mkdir(qa);
    await cp(new URL('../dist/', import.meta.url), path.join(directory, 'dist'), {recursive:true});
    await cp(new URL('../package.json', import.meta.url), path.join(directory, 'package.json'));
    const script = path.join(qa, 'render-layout.mjs');
    await cp(new URL('../qa/render-layout.mjs', import.meta.url), script);
    const implementation = path.join(directory, 'synthetic-canvas.cjs');
    await writeFile(implementation, adapter);
    const timed = ['explainer', 'recipe', 'ranking', 'product', 'quiz'];
    const expected = [
      ...TEMPLATES.map(template => template.id + '.png'),
      ...timed.flatMap(id => [.45, .85].map(fraction => id + '-' + fraction + '.png')),
      'all-templates.png', 'after-layout.png',
    ].sort();
    const run = (...extra) => spawnSync(process.execPath, [script, implementation, ...extra], {
      cwd:tmpdir(), encoding:'utf8', timeout:15000, maxBuffer:1024 * 1024,
    });
    const read = async name => JSON.parse(await readFile(path.join(qa, name), 'utf8'));
    const result = run(path.join(directory, 'fonts'));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'Rendered all templates and timed headline states with the production compositor.\n');
    assert.deepEqual((await readdir(qa)).filter(name => name.endsWith('.png')).sort(), expected);
    for (const name of expected.filter(name => !['all-templates.png', 'after-layout.png'].includes(name))) {
      const frame = await read(name);
      assert.equal(frame.synthetic, true);
      assert.deepEqual([frame.width, frame.height], [540, 960]);
      assert.ok(frame.events.some(event => event[0] === 'drawImage' && event[1].id === 'sample'), name);
      assert.ok(frame.events.some(event => event[0] === 'drawImage' && typeof event[1].id === 'number'), name + ' typography');
      assert.deepEqual(frame.fonts, [400, 600, 900].map(weight => ['NotoSansKR-' + weight + '.ttf', 'Noto Sans KR']));
    }
    const sheet = await read('all-templates.png');
    assert.equal(sheet.width, 1500);
    const placements = sheet.events.filter(event => event[0] === 'drawImage');
    assert.equal(placements.length, TEMPLATES.length);
    for (const [index, [, , x, y, width, height]] of placements.entries()) {
      assert.deepEqual([x, y, width, height], [25 + (index % 5) * 295, 136 + Math.floor(index / 5) * 550, 265, 471]);
      assert.ok(x >= 0 && y >= 0 && x + width <= sheet.width && y + height <= sheet.height, TEMPLATES[index].id);
    }
    assert.equal(sheet.height, 140 + Math.ceil(TEMPLATES.length / 5) * 550);
    assert.deepEqual(sheet.events[0], ['fillRect', 0, 0, sheet.width, sheet.height]);
    assert.ok(sheet.events.some(event => event[0] === 'fillText' && event[1] === '영상 중앙을 비운 ' + TEMPLATES.length + '가지 구성'));
    const comparison = await read('after-layout.png');
    assert.deepEqual([comparison.width, comparison.height], [1080, 560]);
    assert.equal(comparison.events.filter(event => event[0] === 'drawImage').length, 4);
    // No app-source parsing dependency; optional font argument remains optional.
    await rm(path.join(directory, 'dist', 'app.js'));
    const repeated = run();
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(repeated.stderr, '');
    assert.deepEqual((await read('reference.png')).fonts, []);
    assert.deepEqual((await readdir(qa)).filter(name => name.endsWith('.png')).sort(), expected);
  } finally {
    await rm(directory, {recursive:true, force:true});
  }
});
