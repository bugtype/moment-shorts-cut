import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoProject} from '../dist/core/project.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';

const commands = [
    {name:'captions.split.long', change:{limit:12,captionIndex:0,count:1}, noop:{limit:24,captionIndex:1,count:1}, keys:['updated','changedCaptions','addedCaptions','outputDuration']},
    {name:'captions.speaker.assign', change:{captionIndex:0,count:1,speaker:'1'}, noop:{captionIndex:1,count:1,speaker:''}, keys:['updated','changedCaptions','outputDuration']},
    {name:'captions.timing.shift', change:{basis:'source',delta:.25}, noop:{basis:'source',delta:0}, keys:['updated','shiftedCaptions','outputDuration']},
    {name:'captions.text.replace', change:{find:'첫번째',replacement:'교정'}, noop:{find:'not present',replacement:'unused'}, keys:['updated','matches','changedCaptions']},
];
function project() {
    const value=createDemoProject();
    value.captions=[
        {start:1,end:4,text:'첫번째 자막은 여러 단어와 긴 설명을 포함합니다'},
        {start:5,end:7,text:'retained',basis:'timeline'},
    ];
    return value;
}
function freeze(value) {
    if(value && typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}

test('caption transform preparation keeps command-specific acknowledgments and deeply isolates changed projects',()=>{
    for(const entry of commands) {
        const source=freeze(project()),before=JSON.stringify(source),args=freeze(structuredClone(entry.change));
        const result=prepareCommand(source,entry.name,args);
        assert.equal(result.data.updated,true,entry.name);
        assert.deepEqual(Object.keys(result),['project','data']);
        assert.deepEqual(Object.keys(result.data),entry.keys,entry.name);
        assert.notEqual(result.project,source);
        assert.notEqual(result.project.captions,source.captions);
        // The unchanged cue can be reused by a transform, but never by its prepared project.
        result.project.captions.at(-1).text='mutated returned cue';
        result.project.design.title.lines[0]='mutated returned title';
        assert.equal(JSON.stringify(source),before,entry.name);
        assert.deepEqual(args,entry.change);
    }
});

test('no-op caption transformations return only their acknowledgment without manufacturing a project',()=>{
    for(const entry of commands) {
        const source=freeze(project()),before=JSON.stringify(source);
        const result=prepareCommand(source,entry.name,freeze(structuredClone(entry.noop)));
        assert.deepEqual(Object.keys(result),['data'],entry.name);
        assert.equal(result.data.updated,false);
        assert.deepEqual(Object.keys(result.data),entry.keys,entry.name);
        assert.equal(JSON.stringify(source),before);
    }
});

test('shared preparation retains argument-error priority over project validation and never mutates inputs',()=>{
    for(const entry of commands) {
        const source=project();source.speed=0;freeze(source);
        const args=freeze({...entry.change,unexpected:true}),before=JSON.stringify(source);
        assert.throws(()=>prepareCommand(source,entry.name,args),error=>error.code==='INVALID_ARGUMENT' && error.path==='arguments.unexpected');
        assert.equal(JSON.stringify(source),before);
    }
});
