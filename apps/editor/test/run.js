// Serves the built app (apps/editor/dist) on a local static http server and runs the browser suite (test.js) against it.
// Usage (from ws/): npm test          (builds first)
//                   node apps/editor/test/run.js   (uses the existing dist/)
// Env: OSH_PORT (default: a free port), CHROME (default /usr/bin/google-chrome), PLAYWRIGHT_CORE (optional path).
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');

const DIST = path.resolve(__dirname, '../dist');
const EXTRA = { '/blank.html': path.join(__dirname, 'blank.html') }; // same-origin helper page used by the R7-MN3 BroadcastChannel test
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('dist/index.html not found: run `npm run build` first'); process.exit(2); }

function resolveFile(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  if (EXTRA[p]) return EXTRA[p];
  const f = path.resolve(DIST, '.' + (p === '/' ? '/index.html' : p));
  return f.startsWith(DIST + path.sep) ? f : null;
}

const server = http.createServer((req, res) => {
  // Browsers ask an http origin for /favicon.ico (a file:// page never does); its 404 would be a console error that the
  // suite's no-console-errors checks count. The app ships no favicon, so answer with an empty 204.
  if (req.url.split('?')[0] === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const f = resolveFile(req.url);
  if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});

server.listen(+process.env.OSH_PORT || 0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log('serving ' + DIST + ' at ' + url);
  const child = spawn(process.execPath, [path.join(__dirname, 'test.js')], { stdio: 'inherit', env: { ...process.env, OSH_URL: url } });
  child.on('exit', code => { server.close(); process.exit(code === null ? 1 : code); });
});
