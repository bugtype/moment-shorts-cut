import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverUrl = new URL('../cli/mcp.mjs', import.meta.url);
const server = fileURLToPath(serverUrl);
const limit = 10 * 1024 * 1024;
const ping = id => JSON.stringify({jsonrpc: '2.0', id, method: 'ping'});
const replies = output => output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
function native(input) {
  const child = spawnSync(process.execPath, [server], {
    input, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
  });
  assert.equal(child.signal, null, child.error?.message);
  return child;
}

// Execute the real, unchanged entry point in a fresh process. Only stream ports
// and native Buffer operation counters are injected for deterministic framing,
// allocation/copy work and drain/error ordering.
function controlled(setup, after = '') {
  const source = `
    import assert from 'node:assert/strict';
    import { EventEmitter } from 'node:events';
    const output = process.stdout;
    const frames = [], trace = [];
    const stream = new EventEmitter();
    stream.write = text => { frames.push(JSON.parse(text)); return true; };
    Object.defineProperty(process, 'stdout', {value: stream});
    process.argv = [process.execPath, ${JSON.stringify(server)}];
    const ping = id => JSON.stringify({jsonrpc: '2.0', id, method: 'ping'});
    ${setup}
    await import(${JSON.stringify(serverUrl.href)});
    ${after}
    output.write(JSON.stringify({frames, trace}));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
  });
  assert.equal(child.signal, null, child.error?.message);
  return {...child, receipt: child.stdout ? JSON.parse(child.stdout) : null};
}

test('stdio enforces the exact byte cap with LF and EOF, then releases each completed line', () => {
  for (const ending of ['', '\n']) {
    const exact = ping(1).padEnd(limit, ' ');
    const accepted = native(exact + ending);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.stderr, '');
    assert.deepEqual(replies(accepted.stdout), [{jsonrpc: '2.0', id: 1, result: {}}]);
    const rejected = native(exact + ' ' + ending);
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, '');
    assert.match(rejected.stderr, /oversized input/);
  }
  const input = ping(2).padEnd(6 * 1024 * 1024, ' ') + '\n' +
    ping(3).padEnd(6 * 1024 * 1024, ' ') + '\n' + ping(4);
  assert.ok(Buffer.byteLength(input) > limit);
  const child = native(input);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  assert.deepEqual(replies(child.stdout).map(reply => reply.id), [2, 3, 4]);
});

test('stdio recovers from blank, invalid JSON and UTF-8 frames before a final EOF request', () => {
  const input = Buffer.concat([
    Buffer.from('\n{broken\r\n'), Buffer.from([0xff, 10]),
    Buffer.from(ping('한글🙂') + '\r\n' + ping(2)),
  ]);
  const child = native(input);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  assert.deepEqual(replies(child.stdout), [
    ...Array.from({length: 3}, () => ({jsonrpc: '2.0', id: null,
      error: {code: -32700, message: 'Parse error'}})),
    {jsonrpc: '2.0', id: '한글🙂', result: {}}, {jsonrpc: '2.0', id: 2, result: {}},
  ]);
});

test('stdio owns retained bytes, splits UTF-8 safely and bounds one-byte accumulation work', () => {
  const child = controlled(`
    const payload = Buffer.from(ping('한글🙂').padEnd(4096, ' ') + '\\r\\n' + ping(2));
    let copied = 0, allocated = 0, largest = 0, growths = 0;
    const concat = Buffer.concat, alloc = Buffer.alloc, copy = Buffer.prototype.copy;
    const owned = () => (new Error().stack.split('\\n')[3] || '').includes('/cli/mcp.mjs:');
    Buffer.concat = function(...args) {
      const count = owned(), result = concat.apply(this, args);
      if (count) copied += result.length;
      return result;
    };
    Buffer.alloc = function(...args) {
      const count = owned(), result = alloc.apply(this, args);
      if (count) { allocated += result.length; largest = Math.max(largest, result.length);
        if (result.length) growths++; }
      return result;
    };
    Buffer.prototype.copy = function(...args) {
      const count = owned(), length = copy.apply(this, args);
      if (count) copied += length;
      return length;
    };
    Object.defineProperty(process, 'stdin', {value: {
      async *[Symbol.asyncIterator]() {
        try {
          for (const byte of payload) {
            const fragment = Buffer.from([byte]);
            yield fragment;
            fragment.fill(120); // Mutation after the next pull must not alter retained bytes.
          }
        } finally { trace.push('closed'); }
      }
    }});
  `, `
    assert.deepEqual(frames, [
      {jsonrpc:'2.0', id:'한글🙂', result:{}}, {jsonrpc:'2.0', id:2, result:{}}
    ]);
    assert.deepEqual(trace, ['closed']);
    assert.ok(copied > payload.length, 'The real transport operations were counted');
    assert.ok(copied <= payload.length * 5, 'Prefix copies must be amortized linear');
    assert.ok(allocated <= payload.length * 4, 'Geometric capacity allocations stay bounded');
    assert.ok(largest <= 8192);
    assert.ok(growths > 0 && growths < 32);
  `);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
});

test('stdio awaits drain before dispatching another line in the same chunk', () => {
  const child = controlled(`
    stream.write = text => {
      const reply = JSON.parse(text); frames.push(reply); trace.push('write:' + reply.id);
      if (reply.id === 1) {
        setImmediate(() => { trace.push('drain'); stream.emit('drain'); });
        return false;
      }
      return true;
    };
    Object.defineProperty(process, 'stdin', {value: {
      async *[Symbol.asyncIterator]() {
        try { trace.push('pull'); yield Buffer.from(ping(1) + '\\n' + ping(2) + '\\n'); }
        finally { trace.push('closed'); }
      }
    }});
  `);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  assert.deepEqual(child.receipt.trace, ['pull', 'write:1', 'drain', 'write:2', 'closed']);
  assert.deepEqual(child.receipt.frames.map(reply => reply.id), [1, 2]);
});

test('stdio closes input on stream/output failure without dispatching buffered later requests', () => {
  for (const failingPort of ['input', 'output']) {
    const child = controlled(`
      const failingPort = ${JSON.stringify(failingPort)};
      if (failingPort === 'output') {
        let failed = false;
        stream.write = text => {
          if (failed) throw new Error('closed output');
          frames.push(JSON.parse(text));
          setImmediate(() => { failed = true; stream.emit('error', new Error('drain failed')); });
          return false;
        };
      }
      Object.defineProperty(process, 'stdin', {value: {
        async *[Symbol.asyncIterator]() {
          try {
            if (failingPort === 'input') {
              yield Buffer.from(ping(1));
              throw new Error('input failed');
            }
            yield Buffer.from(ping(1) + '\\n' + ping(2) + '\\n');
          } finally { trace.push('closed'); }
        }
      }});
    `);
    assert.equal(child.status, 1);
    assert.match(child.stderr, /stream failure/);
    assert.deepEqual(child.receipt.trace, ['closed']);
    assert.deepEqual(child.receipt.frames.map(reply => reply.id), failingPort === 'input' ? [] : [1]);
  }
});

test('stdio clamps tail capacity to the byte limit and accepts several large lines in one chunk', () => {
  const child = controlled(`
    const limit = 10 * 1024 * 1024, firstSize = 6 * 1024 * 1024;
    const exact = Buffer.from(ping(1).padEnd(limit, ' '));
    const multiple = Buffer.from(ping(3).padEnd(firstSize, ' ') + '\\n' +
      ping(4).padEnd(firstSize, ' ') + '\\n');
    const allocations = [], allocate = Buffer.alloc;
    Buffer.alloc = function(size, ...args) {
      if ((new Error().stack.split('\\n')[2] || '').includes('/cli/mcp.mjs:')) allocations.push(size);
      return allocate.call(this, size, ...args);
    };
    Object.defineProperty(process, 'stdin', {value: {
      async *[Symbol.asyncIterator]() {
        yield exact.subarray(0, firstSize);
        yield exact.subarray(firstSize);
        yield Buffer.from('\\n' + ping(2) + '\\n');
        yield multiple;
        yield Buffer.from(ping(5));
      }
    }});
  `, `
    assert.deepEqual(frames.map(reply => reply.id), [1, 2, 3, 4, 5]);
    assert.ok(frames.every(reply => !reply.error));
    assert.deepEqual(allocations.filter(size => size > 0), [firstSize, limit, Buffer.byteLength(ping(5))]);
    assert.equal(Math.max(...allocations), limit, 'Capacity growth is capped, not merely used length');
  `);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
});
