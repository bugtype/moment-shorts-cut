import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {decimalTime} from '../dist/ui-format.mjs';
import {decimalTime as seekDecimalTime} from '../dist/seek-dialog.mjs';
import {createProjectDocument,createDemoProject} from '../dist/core/project.mjs';
import {createAppFixture} from './fixtures/app.mjs';

async function fixture(start = 1.234, end = 11.987) {
  const f = await createAppFixture();
  f.context.seedClip = {start,end};
  vm.runInContext('state.clips=[seedClip];timelineCache=null;history=[];future=[];selected=0;renderTimeline();renderInspector();', f.context);
  return f;
}
const values = f => [f.element('#trimStart').value, f.element('#trimEnd').value];
const apply = f => f.element('#trimButton').onclick();

test('editable decimal formatter round trips small and precise nonnegative times without exponent notation', () => {
  assert.equal(seekDecimalTime, decimalTime);
  for (const value of [0,1,1.234,11.987,1e-7,Number.MIN_VALUE,12-Number.EPSILON*8,86400]) {
    const text = decimalTime(value);
    assert.doesNotMatch(text, /e/i);
    assert.equal(Number(text),value);
  }
});

test('untouched desktop Apply preserves both precise boundaries and existing history behavior', async () => {
  const f=await fixture();
  assert.deepEqual(values(f),['1.234','11.987']);
  const clips=f.evaluate('state.clips');
  apply(f);
  assert.deepEqual(f.evaluate('state.clips'),clips);
  assert.equal(f.evaluate('history.length'),1);
  assert.deepEqual(values(f),['1.234','11.987']);
});

test('editing either boundary preserves the other exact value, including undo and redo', async () => {
  for (const [field,value,expected] of [
    ['#trimStart','2.34567',{start:2.34567,end:11.987}],
    ['#trimEnd','10.87654',{start:1.234,end:10.87654}],
  ]) {
    const f=await fixture();
    f.element(field).value=value;apply(f);
    assert.deepEqual(f.evaluate('state.clips'),[expected]);
    vm.runInContext('undo()',f.context);
    assert.deepEqual(values(f),['1.234','11.987']);
    vm.runInContext('undo(true)',f.context);
    assert.deepEqual(f.evaluate('state.clips'),[expected]);
  }
});

test('imported and split precise clips remain exact through inspector render and Apply', async () => {
  const f=await fixture();
  const project=createDemoProject();project.clips=[{start:1.234567,end:11.987654}];
  f.context.importDocument=createProjectDocument(project);
  assert.equal(vm.runInContext("runEditorCommand('project.import',{document:importDocument})",f.context),true);
  assert.deepEqual(values(f),['1.234567','11.987654']);
  assert.equal(vm.runInContext("runEditorCommand('timeline.split',{clipIndex:0,sourceTime:6.123456});selected=1;renderInspector();true",f.context),true);
  assert.deepEqual(values(f),['6.123456','11.987654']);
  const clips=f.evaluate('state.clips');apply(f);
  assert.deepEqual(f.evaluate('state.clips'),clips);
});

test('unrelated commands preserve precise in-progress drafts until explicit Apply', async () => {
  const f=await fixture();
  f.element('#trimStart').value='2.3456789';
  vm.runInContext("runEditorCommand('project.update',{patch:{name:'renamed'}});renderInspector();",f.context);
  assert.deepEqual(values(f),['2.3456789','11.987']);
  assert.deepEqual(f.evaluate('state.clips'),[{start:1.234,end:11.987}]);
  apply(f);
  assert.deepEqual(f.evaluate('state.clips'),[{start:2.3456789,end:11.987}]);
});

test('minimum intervals, exact endpoints and tiny starts do not drift on Apply', async () => {
  for (const [start,end] of [[8.1,8.2],[11.9,12],[1e-7,11.999999999999998],[Number.MIN_VALUE,1]]) {
    const f=await fixture(start,end);
    assert.equal(Number(values(f)[0]),start);assert.equal(Number(values(f)[1]),end);
    assert.doesNotMatch(values(f).join(' '),/e/i);
    apply(f);
    assert.deepEqual(f.evaluate('state.clips'),[{start,end}]);
    assert.equal(f.evaluate('history.length'),1);
  }
});
