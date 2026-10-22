import {createServer} from 'node:http';
import {readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml'};
export function createPreviewServer() {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET','HEAD'].includes(request.method)) {
      response.writeHead(405, {Allow:'GET, HEAD'}).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (relative.split(/[\\/]/).some(part => part.startsWith('.'))) {
        response.writeHead(404).end(); return;
      }
      const filename = await realpath(path.resolve(root, relative));
      const contained = path.relative(await realpath(root), filename);
      const type = types[path.extname(filename)];
      if (contained.startsWith('..') || path.isAbsolute(contained) || !type) {
        response.writeHead(404).end(); return;
      }
      const body = await readFile(filename);
      response.writeHead(200, {'Content-Type':type, 'Content-Length':body.length});
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      response.writeHead(error instanceof URIError ? 400 : 404).end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const server = createPreviewServer();
  server.on('error', error => { console.error(`Preview server: ${error.code || error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Moment: http://127.0.0.1:${port}\nOnly dist/ is served. Ctrl+C to stop.`));
}
