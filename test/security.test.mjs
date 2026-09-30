import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newSalt, deriveKey, seal, unseal, validateEnvelope } from '../public/crypto.mjs';
import { createApp } from '../server.mjs';

test('vault encryption authenticates content and does not expose plaintext', async () => {
  const password = 'Test-only password. Not a user secret.';
  const salt = newSalt(), key = await deriveKey(password, salt);
  const data = { secret: 'test-account-password', draft: 'Private draft 🔐', history: ['private activity'] };
  const first = await seal(data, key, salt), second = await seal(data, key, salt);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(JSON.stringify(first).includes(data.secret), false);
  assert.equal(JSON.stringify(first).includes(password), false);
  assert.deepEqual(await unseal(first, key), data);
  const wrongKey = await deriveKey('Wrong test password', salt);
  await assert.rejects(unseal(first, wrongKey));
  const altered = structuredClone(first);
  altered.ciphertext = (altered.ciphertext.startsWith('A') ? 'B' : 'A') + altered.ciphertext.slice(1);
  await assert.rejects(unseal(altered, key));
  assert.throws(() => validateEnvelope({ ...first, iterations: 1 }));
  assert.equal(key.extractable, false);
});

test('local server protects ciphertext, rejects cross-origin writes, and prevents lost updates', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'social-desk-test-'));
  const instance = await createApp({ dataDir, port: 0 });
  t.after(async () => {
    await new Promise(resolve => instance.server.close(resolve));
    const resolved = path.resolve(dataDir);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('social-desk-test-'));
    await rm(resolved, { recursive: true, force: true });
  });
  const { origin } = instance;
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  const token = html.match(/name="local-token" content="([a-f0-9]+)"/)[1];
  const headers = { 'X-Social-Desk': token, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${origin}/api/vault`)).status, 403);
  assert.equal((await fetch(`${origin}/api/vault`, { headers: { ...headers, Origin: 'https://attacker.example' } })).status, 403);
  // Fetch replaces Host; use HTTP directly so the malicious header reaches the server.
  const invalidHostStatus = await new Promise((resolve, reject) => {
    http.get(origin, { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(invalidHostStatus, 403);
  assert.equal((await fetch(origin, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(`${origin}/data/vault.json`)).status, 404);
  const initial = await (await fetch(`${origin}/api/vault`, { headers })).json();
  assert.deepEqual(initial, { envelope: null, revision: null });
  assert.equal((await fetch(`${origin}/api/vault`, { method: 'PUT', headers, body: JSON.stringify({ envelope: { password: 'plaintext' }, revision: null }) })).status, 400);
  const salt = newSalt(), key = await deriveKey('test-master-password', salt);
  const encrypted = await seal({ password: 'must-never-be-on-disk' }, key, salt);
  const put = revision => fetch(`${origin}/api/vault`, { method: 'PUT', headers, body: JSON.stringify({ envelope: encrypted, revision }) });
  const first = await put(null); assert.equal(first.status, 200);
  const { revision } = await first.json();
  assert.equal((await put(null)).status, 409);
  const disk = await readFile(instance.vaultPath, 'utf8');
  assert.equal(disk.includes('must-never-be-on-disk'), false);
  assert.deepEqual(await unseal(JSON.parse(disk), key), { password: 'must-never-be-on-disk' });
  const latest = await (await fetch(`${origin}/api/vault`, { headers })).json();
  assert.equal(latest.revision, revision);
  const updated = await seal({ password: 'new-value' }, key, salt);
  const racing = await Promise.all([1, 2].map(() => fetch(`${origin}/api/vault`, { method: 'PUT', headers, body: JSON.stringify({ envelope: updated, revision }) })));
  assert.deepEqual(racing.map(r => r.status).sort(), [200, 409]);
});
