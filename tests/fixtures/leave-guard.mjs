import vm from 'node:vm';
import assert from 'node:assert/strict';

// Capture the actual app binding, not the browser's native prompt policy.
export async function mountLeaveGuard(f) {
  const events = new Map(), writes = [];
  f.context.window.addEventListener = (name, callback) => events.set(name, callback);
  f.context.localStorage.setItem = (key, value) => writes.push([key,value]);
  vm.runInContext('bindUi(app); renderInspector()', f.context);
  await vm.runInContext('saveProject()', f.context);
  return () => {
    const before = f.evaluate('({state,history,future})'), saved = writes.length;
    const toast = f.element('#toast').textContent;
    const event = {prevented:false,preventDefault() { this.prevented = true; }};
    events.get('beforeunload')(event);
    assert.deepEqual(f.evaluate('({state,history,future})'), before);
    assert.equal(writes.length, saved);
    assert.equal(f.element('#toast').textContent, toast);
    return event.prevented;
  };
}
