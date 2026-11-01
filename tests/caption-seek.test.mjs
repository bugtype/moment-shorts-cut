import test from 'node:test';
import assert from 'node:assert/strict';
import {captionSeekTime} from '../dist/caption-seek.mjs';
import {captionOccurrences} from '../dist/captions.mjs';
import {buildTimelineEntries, locateTimelineEntry} from '../dist/timeline-index.mjs';

function previous(value) {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    view.setBigUint64(0, view.getBigUint64(0) - 1n);
    return view.getFloat64(0);
}
function contains(project, target, time) {
    const {entries,total} = buildTimelineEntries(project.clips);
    if (!(time >= 0 && time < total)) return false;
    const position = locateTimelineEntry(entries,time), caption = project.captions[target.captionIndex];
    if (caption.basis !== 'timeline' && (position.index !== target.clipIndex || position.source >= entries[target.clipIndex].clip.end)) return false;
    const clock = caption.basis === 'timeline' ? time : position.source;
    return clock >= caption.start && clock < caption.end && (caption.basis !== 'timeline' || clock < total);
}

test('valid preferred targets remain exact and no project or public occurrences are changed', () => {
    const project = {speed:.75, clips:[{start:.1,end:.7}], captions:[{start:.2,end:.6,text:'Cue'}]};
    const before = structuredClone(project), output = captionOccurrences(project.captions,project.clips,project.speed);
    for (const time of [.2,.3]) assert.equal(captionSeekTime(project,{captionIndex:0,clipIndex:0},time),time);
    assert.deepEqual(project,before);
    assert.deepEqual(captionOccurrences(project.captions,project.clips,project.speed),output);
});

test('fractional speed, source offsets and repeated clips seek the earliest valid representable repair', () => {
    let repairs = 0;
    for (const speed of [.25,.3,.75,1,1.1,4]) for (const start of [.1,5,80000])
        for (const offset of [0,12,86400]) for (const delta of [.01,.21,.41]) {
            const clips = [...(offset ? [{start:0,end:offset}] : []), {start,end:start+1}];
            const project = {speed,clips,captions:[{start:start+delta,end:start+delta+.01,text:'Cue'}]};
            const target = {captionIndex:0,clipIndex:clips.length-1};
            const occurrence = captionOccurrences(project.captions,clips,speed).find(item=>item.clipIndex===target.clipIndex);
            const preferred = occurrence.start*speed, time = captionSeekTime(project,target,preferred);
            assert.notEqual(time,null);
            assert.ok(contains(project,target,time),JSON.stringify({project,time}));
            if (contains(project,target,preferred)) assert.equal(time,preferred);
            else { repairs++; assert.equal(contains(project,target,previous(time)),false); }
        }
    assert.ok(repairs > 0);
});

test('timeline clock and mixed overlap witnesses use the renderer original pre-speed clock', () => {
    for (const basis of ['source','timeline']) {
        const project = {speed:.75,clips:[{start:0,end:12}],captions:[
            {start:0,end:.5,text:'First'}, {start:.21,end:.6,text:'Second',basis},
        ]};
        const target = {captionIndex:0,clipIndex:0,otherCaptionIndex:1,...(basis==='source'?{otherClipIndex:0}:{})};
        const time = captionSeekTime(project,target,.21/.75*.75);
        assert.ok(contains(project,target,time));
        assert.ok(contains(project,{captionIndex:1,clipIndex:0},time));
        assert.equal(contains(project,{captionIndex:1,clipIndex:0},previous(time)),false);
    }
});

test('unrepresentable ranges never cross cue ends, retained clip ends, total or occurrence identity', () => {
    const project = {speed:1,clips:[{start:0,end:12},{start:0,end:1}],captions:[{start:1e-20,end:2e-20,text:'Tiny'}]};
    assert.equal(captionSeekTime(project,{captionIndex:0,clipIndex:1},12),null);
    assert.equal(captionSeekTime(project,{captionIndex:0,clipIndex:0,otherCaptionIndex:0,otherClipIndex:1},0),null);
    for (const basis of ['source','timeline']) {
        const trimmed = {speed:1,clips:[{start:0,end:1}],captions:[{start:1,end:2,text:'Outside',basis}]};
        assert.equal(captionSeekTime(trimmed,{captionIndex:0,clipIndex:0},1),null);
    }
    assert.equal(captionSeekTime(project,{captionIndex:3,clipIndex:0},0),null);
    assert.equal(captionSeekTime(project,{captionIndex:0,clipIndex:4},0),null);
});

test('subnormal ranges converge exactly without a fixed epsilon or search cutoff', () => {
    const project = {speed:1,clips:[{start:0,end:86400}],captions:[{start:Number.MIN_VALUE,end:Number.MIN_VALUE*2,text:'Tiny',basis:'timeline'}]};
    assert.equal(captionSeekTime(project,{captionIndex:0},0),Number.MIN_VALUE);
    project.speed=2;
    assert.equal(captionSeekTime(project,{captionIndex:0},0),Number.MIN_VALUE);
});
