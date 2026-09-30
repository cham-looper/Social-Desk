import http from 'node:http';
import { readFile, mkdir, open, rename } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateEnvelope } from './public/crypto.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 64 * 1024 * 1024;
const digest = data => createHash('sha256').update(data).digest('hex');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const routes = new Map([['/', 'index.html'], ['/app.mjs', 'app.mjs'], ['/crypto.mjs', 'crypto.mjs'], ['/style.css', 'style.css'], ['/favicon.svg', 'favicon.svg']]);

export async function createApp({ dataDir = path.join(root, 'data'), port = 4318 } = {}) {
  const token = randomBytes(32).toString('hex');
  const vaultPath = path.join(dataDir, 'vault.json');
  let writeQueue = Promise.resolve();
  let origin;
  async function stored() {
    try { const text = await readFile(vaultPath, 'utf8'); return { envelope: JSON.parse(text), revision: digest(text) }; }
    catch (error) { if (error.code === 'ENOENT') return { envelope: null, revision: null }; throw error; }
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src blob:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    try {
      if (req.headers.host !== new URL(origin).host) return send(403, { error: 'Unrecognized host.' });
      if (req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'Cross-origin access is not allowed.' });
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return send(403, { error: 'Open Social Desk directly.' });
      const url = new URL(req.url, origin);
      if (url.pathname === '/api/vault') {
        if (req.headers['x-social-desk'] !== token) return send(403, { error: 'Reload Social Desk to reconnect.' });
        if (req.method === 'GET') return send(200, await stored());
        if (req.method !== 'PUT') return send(405, { error: 'Method not allowed.' });
        if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'JSON required.' });
        let total = 0;
        const chunks = [];
        for await (const chunk of req) {
          total += chunk.length;
          if (total > MAX_BODY) return send(413, { error: 'Vault is too large. Remove some attachments.' });
          chunks.push(chunk);
        }
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); validateEnvelope(payload.envelope); }
        catch { return send(400, { error: 'Invalid encrypted vault.' }); }
        const performWrite = async () => {
          const current = await stored();
          if (payload.revision !== current.revision) return { status: 409, body: { error: 'This vault changed in another tab. Export your current work before reloading.' } };
          await mkdir(dataDir, { recursive: true, mode: 0o700 });
          const serialized = JSON.stringify(payload.envelope);
          const temporary = path.join(dataDir, `vault-${randomBytes(8).toString('hex')}.tmp`);
          const handle = await open(temporary, 'wx', 0o600);
          try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
          await rename(temporary, vaultPath);
          return { status: 200, body: { revision: digest(serialized) } };
        };
        const job = writeQueue.then(performWrite);
        writeQueue = job.catch(() => {});
        const result = await job;
        return send(result.status, result.body);
      }
      if (req.method !== 'GET') return send(405, { error: 'Method not allowed.' });
      const file = routes.get(url.pathname);
      if (!file) return send(404, { error: 'Not found.' });
      let content = await readFile(path.join(root, 'public', file), 'utf8');
      if (file === 'index.html') content = content.replace('__LOCAL_TOKEN__', token);
      return send(200, content, types[path.extname(file)]);
    } catch { send(500, { error: 'Could not read or save the local vault. Check the data folder and disk space.' }); }
  });
  server.requestTimeout = 60000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, vaultPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { origin } = await createApp({ port: Number(process.env.SOCIAL_DESK_PORT || 4318), dataDir: process.env.SOCIAL_DESK_DATA_DIR || undefined });
    console.log(`Social Desk is ready at ${origin}`);
    console.log('Local access only. Keep this process running while using the app.');
  } catch (error) { console.error(error.code === 'EADDRINUSE' ? 'Social Desk may already be running: open http://127.0.0.1:4318' : 'Social Desk could not start.'); process.exitCode = 1; }
}
