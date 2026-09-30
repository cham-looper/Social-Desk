import test from 'node:test';
import assert from 'node:assert/strict';
import { publicHTTPS, accountPartition, trustedSender, platformBounds, remotePreferences } from '../desktop/policy.mjs';

test('remote platform URLs reject local servers, credentials, custom protocols and encoded local IPs', () => {
  for (const raw of ['http://x.com/', 'file:///C:/secret', 'javascript:alert(1)', 'https://user:pass@x.com',
    'https://127.0.0.1/', 'https://2130706433/', 'https://[::1]/', 'https://localhost/', 'https://foo.localhost/',
    'https://router.local/', 'https://192.168.1.2/', 'https://x.com:4318/', '', null]) {
    assert.throws(() => publicHTTPS(raw), String(raw));
  }
  assert.equal(publicHTTPS('https://accounts.google.com/signin'), 'https://accounts.google.com/signin');
  assert.equal(publicHTTPS('https://social.example.org/'), 'https://social.example.org/');
});

test('account partitions isolate accounts without accepting file paths', () => {
  assert.match(accountPartition('../name'), /^persist:account-[a-f0-9]{64}$/);
  assert.equal(accountPartition('account-a'), accountPartition('account-a'));
  assert.notEqual(accountPartition('account-a'), accountPartition('account-b'));
  assert.throws(() => accountPartition(''));
  assert.throws(() => accountPartition('x'.repeat(101)));
  const preferences = remotePreferences(accountPartition('a'));
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.webSecurity, true);
  assert.equal(preferences.preload, undefined);
});

test('only the exact local main frame can call desktop commands', () => {
  const mainFrame = { url: 'http://127.0.0.1:1234/' }, wc = { mainFrame };
  assert.equal(trustedSender({ sender: wc, senderFrame: mainFrame }, wc, 'http://127.0.0.1:1234'), true);
  assert.equal(trustedSender({ sender: {}, senderFrame: mainFrame }, wc, 'http://127.0.0.1:1234'), false);
  assert.equal(trustedSender({ sender: wc, senderFrame: { url: mainFrame.url } }, wc, 'http://127.0.0.1:1234'), false);
  assert.equal(trustedSender({ sender: wc, senderFrame: mainFrame }, wc, 'http://127.0.0.1:9999'), false);
});

test('platform content cannot cover trusted navigation or status strip on resize', () => {
  assert.deepEqual(platformBounds(1400, 900), { x: 232, y: 225, width: 1168, height: 639 });
  assert.deepEqual(platformBounds(200, 150), { x: 232, y: 225, width: 0, height: 0 });
});
