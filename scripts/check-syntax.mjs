import {lstat, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const directories = ['dist', 'cli', 'examples', 'qa', 'scripts'];

async function discover() {
  const files = [];
  async function walk(relative) {
    for (const entry of await readdir(path.join(root, relative), {withFileTypes:true})) {
      const file = relative + '/' + entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') await walk(file);
      } else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) files.push(file);
      // Symlinks are not followed; only this checkout's regular source files belong here.
    }
  }
  for (const directory of directories) {
    if (!(await lstat(path.join(root, directory))).isDirectory())
      throw new Error(directory + ' must be a regular directory, not a symlink.');
    await walk(directory);
  }
  if (!(await lstat(path.join(root, 'verify.mjs'))).isFile())
    throw new Error('verify.mjs must be a regular file, not a symlink.');
  files.push('verify.mjs');
  return files.sort();
}

function check(file) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(process.execPath, ['--check', path.join(root, file)], {
        cwd:root, stdio:['ignore', 'ignore', 'pipe'],
      });
    } catch (error) {
      resolve({file, error, code:null, signal:null, stderr:''});
      return;
    }
    let stderr = '', error;
    child.on('error', value => { error ||= value; });
    // Wait for close, including after spawn errors, so admitted children/stdio settle.
    child.on('close', (code, signal) => resolve({file, error, code, signal, stderr}));
    // Descriptor-exhaustion spawn failures may not create a stderr stream.
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.stderr?.on('error', value => { error ||= value; });
  });
}

try {
  const files = await discover(), results = new Array(files.length);
  let next = 0;
  await Promise.all(Array.from({length:Math.min(4, files.length)}, async () => {
    while (next < files.length) {
      const index = next++;
      results[index] = await check(files[index]);
    }
  }));
  const failures = results.filter(result => result.code !== 0 || result.signal || result.error);
  for (const result of failures) {
    const details = [result.error?.message, result.stderr.trimEnd(),
      result.signal ? 'Node terminated by ' + result.signal + '.' : ''].filter(Boolean);
    process.stderr.write('[' + result.file + ']\n' +
      (details.join('\n') || 'Node exited with code ' + result.code + '.') + '\n');
  }
  if (failures.length) {
    process.stderr.write(`Syntax check failed for ${failures.length} of ${files.length} files.\n`);
    process.exitCode = 1;
  } else process.stdout.write(`Syntax checked ${files.length} files.\n`);
} catch (error) {
  process.stderr.write('Syntax check: ' + error.message + '\n');
  process.exitCode = 1;
}
