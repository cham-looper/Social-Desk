import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const SIDEBAR = 232;
export const SITE_TOP = 225;
export const SITE_FOOT = 36;

export function publicHTTPS(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) throw new Error('Invalid platform address.');
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  // Social sites use public DNS names. Block literal IPs and local destinations.
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      isIP(host) || host.startsWith('[') || !host.includes('.') ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || host.endsWith('.localhost')) {
    throw new Error('Use a public HTTPS platform address, without credentials or a custom port.');
  }
  return url.href;
}

export function accountPartition(id) {
  if (typeof id !== 'string' || !id.length || id.length > 100) throw new Error('Invalid account.');
  return `persist:account-${createHash('sha256').update(id).digest('hex')}`;
}

export function trustedSender(event, contents, origin) {
  return event.sender === contents && event.senderFrame === contents.mainFrame && event.senderFrame?.url === `${origin}/`;
}

export function platformBounds(width, height) {
  return { x: SIDEBAR, y: SITE_TOP, width: Math.max(0, width - SIDEBAR), height: Math.max(0, height - SITE_TOP - SITE_FOOT) };
}

export const remotePreferences = partition => ({
  partition, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
  contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
  webviewTag: false, navigateOnDragDrop: false, spellcheck: true
});
