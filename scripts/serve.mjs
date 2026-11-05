// Minimal static server for local fixtures/tests. Usage: node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.argv[2] || 8123);
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const target = resolve(root, `.${pathname}`);
  if (target !== root && !target.startsWith(`${root}${sep}`)) { response.writeHead(403); response.end('forbidden'); return; }
  try {
    const body = await readFile(target);
    response.writeHead(200, { 'content-type': types[extname(target).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404); response.end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} at http://127.0.0.1:${port}/`));
