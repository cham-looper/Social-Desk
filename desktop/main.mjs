import { app, BrowserWindow, WebContentsView, ipcMain, session, shell, powerMonitor, clipboard, dialog } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.mjs';
import { publicHTTPS, accountPartition, trustedSender, platformBounds, remotePreferences } from './policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.SOCIAL_DESK_DATA_DIR || path.join(root, 'data'));
mkdirSync(path.join(dataDir, 'desktop-profile'), { recursive: true });
app.setPath('userData', path.join(dataDir, 'desktop-profile'));
app.setPath('sessionData', path.join(dataDir, 'desktop-profile'));
app.setName('Social Desk');

if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  let win, local, unlocked = false, active = null, quitting = false, closeRequested = false;
  const pages = new Map(), configured = new Set();
  const send = data => { if (win && !win.isDestroyed()) win.webContents.send('social-desk:event', data); };
  const status = (entry, message = '') => {
    if (entry !== active || entry.view.webContents.isDestroyed()) return;
    const wc = entry.view.webContents;
    let origin = '';
    try { origin = new URL(wc.getURL()).origin; } catch { /* Initial navigation. */ }
    send({ type: 'site', id: entry.id, origin, loading: wc.isLoading(), message,
      back: wc.navigationHistory.canGoBack(), forward: wc.navigationHistory.canGoForward() });
  };
  function hide() { if (active) active.view.setVisible(false); active = null; }
  function destroyPages() {
    hide();
    for (const entry of pages.values()) {
      if (!win.isDestroyed()) win.contentView.removeChildView(entry.view);
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close({ waitForBeforeUnload: false });
    }
    pages.clear();
  }
  function lock() { unlocked = false; destroyPages(); }
  const bounds = () => { if (active) { const [w, h] = win.getContentSize(); active.view.setBounds(platformBounds(w, h)); } };
  function activity() { send({ type: 'activity' }); }
  function configureSession(ses) {
    if (configured.has(ses)) return;
    configured.add(ses);
    ses.setPermissionCheckHandler(() => false);
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(false);
      if (active) status(active, `This site requested ${permission}. Use your browser if that feature is required.`);
    });
    ses.setDevicePermissionHandler(() => false);
    ses.webRequest.onBeforeRequest((details, callback) => {
      // Keep account pages away from the local vault server and local files.
      if (/^(data:|blob:)/.test(details.url)) return callback({});
      try { publicHTTPS(details.url.replace(/^wss:/, 'https:')); callback({}); }
      catch { callback({ cancel: true }); }
    });
    ses.on('will-download', event => {
      event.preventDefault();
      if (active) status(active, 'Downloads from social sites are disabled here. Open the site in your browser to download.');
    });
  }
  function openAccount(payload) {
    const { id, url } = payload || {};
    const partition = accountPartition(id), home = publicHTTPS(url);
    let entry = pages.get(id);
    if (entry && entry.home !== home) {
      if (active === entry) hide();
      win.contentView.removeChildView(entry.view);
      entry.view.webContents.close({ waitForBeforeUnload: false }); pages.delete(id); entry = null;
    }
    hide();
    if (!entry) {
      configureSession(session.fromPartition(partition));
      const view = new WebContentsView({ webPreferences: remotePreferences(partition) });
      entry = { id, home, view }; pages.set(id, entry); win.contentView.addChildView(view);
      const wc = view.webContents;
      const navigate = (event, target = event.url) => {
        try { publicHTTPS(target); } catch { event.preventDefault(); status(entry, 'That link cannot open here. Use Open in browser if needed.'); }
      };
      wc.on('will-navigate', navigate); wc.on('will-redirect', navigate);
      wc.on('will-frame-navigate', (event) => navigate(event, event.url));
      wc.setWindowOpenHandler(({ url: target }) => {
        // Keep web popups unprivileged and inside this account's existing view.
        try { const safe = publicHTTPS(target); setImmediate(() => { if (unlocked && !wc.isDestroyed()) wc.loadURL(safe).catch(() => {}); }); }
        catch { status(entry, 'This sign-in popup needs your normal browser. Browser logins stay in that browser.'); }
        return { action: 'deny' };
      });
      for (const event of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page']) wc.on(event, () => status(entry));
      wc.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
        if (mainFrame && code !== -3) status(entry, 'The page could not load. Retry, or use Open in browser.');
      });
      wc.on('render-process-gone', () => status(entry, 'This page stopped. Click Reload to try again.'));
      let lastInput = 0;
      const signalActivity = () => { if (Date.now() - lastInput > 1000) { lastInput = Date.now(); activity(); } };
      wc.on('before-input-event', signalActivity); wc.on('before-mouse-event', signalActivity);
    }
    active = entry; bounds(); entry.view.setVisible(true);
    if (!entry.view.webContents.getURL()) entry.view.webContents.loadURL(home).catch(() => {});
    status(entry); return { ok: true };
  }

  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(async () => {
  local = await createApp({ dataDir, port: 0 });
  win = new BrowserWindow({ width: 1400, height: 920, minWidth: 1100, minHeight: 720, title: 'Social Desk',
    backgroundColor: '#f4f6fa', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(root, 'desktop', 'preload.cjs'), partition: 'workspace',
      sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true, webviewTag: false } });
  win.setMenu(null);
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on('zoom-changed', event => event.preventDefault());
  win.webContents.on('will-navigate', (event, url = event.url) => { if (url !== `${local.origin}/`) event.preventDefault(); });
  win.webContents.on('will-redirect', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (unlocked) { try { void shell.openExternal(publicHTTPS(url)); } catch { /* Unsafe link. */ } }
    return { action: 'deny' };
  });
  win.webContents.on('did-start-navigation', event => { if (event.isMainFrame && !event.isSameDocument) lock(); });
  win.webContents.on('render-process-gone', () => lock());
  win.webContents.session.setPermissionCheckHandler((_wc, permission, requestingOrigin) => permission === 'clipboard-sanitized-write' && requestingOrigin === local.origin);
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  win.on('resize', bounds);
  win.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    if (!closeRequested) { closeRequested = true; send({ type: 'close' }); }
  });
  powerMonitor.on('lock-screen', () => { lock(); send({ type: 'lock' }); });
  powerMonitor.on('suspend', () => { lock(); send({ type: 'lock' }); });

  ipcMain.handle('social-desk:command', async (event, name, payload) => {
    if (!trustedSender(event, win.webContents, local.origin)) throw new Error('Untrusted workspace.');
    if (name === 'lock') { lock(); return; }
    if (name === 'unlock') { unlocked = true; return; }
    if (name === 'close-cancel') { closeRequested = false; return; }
    if (name === 'quit') {
      lock();
      for (const ses of configured) { ses.flushStorageData(); await ses.cookies.flushStore(); }
      quitting = true; win.destroy(); app.quit(); return;
    }
    if (!unlocked) throw new Error('Unlock your workspace first.');
    if (name === 'hide') { hide(); return; }
    if (name === 'open') return openAccount(payload);
    if (name === 'external') return shell.openExternal(publicHTTPS(payload));
    if (name === 'forget') {
      const partition = accountPartition(payload);
      const confirmed = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cancel', 'Sign out locally'], defaultId: 0, cancelId: 0,
        message: 'Forget this account’s saved browser session?', detail: 'This clears its cookies and website data on this computer. Your encrypted account details and posting history are kept.' });
      if (confirmed.response !== 1) return false;
      const entry = pages.get(payload);
      if (entry) { if (active === entry) hide(); win.contentView.removeChildView(entry.view); entry.view.webContents.close({ waitForBeforeUnload: false }); pages.delete(payload); }
      const ses = session.fromPartition(partition);
      await ses.clearStorageData(); await ses.clearCache(); await ses.cookies.flushStore(); return true;
    }
    if (!active) throw new Error('Open a platform first.');
    const wc = active.view.webContents;
    if (name === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (name === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (name === 'reload') wc.reload();
    else if (name === 'paste') {
      if (typeof payload !== 'string' || payload.length > 100000) throw new Error('Invalid draft text.');
      clipboard.writeText(payload); wc.focus(); wc.paste();
    }
  });
  await win.loadURL(local.origin);
  win.show();
  app.on('before-quit', event => {
    if (!quitting && win && !win.isDestroyed()) { event.preventDefault(); win.close(); }
  });
  app.on('will-quit', () => { local.server.close(); });
  }).catch(error => {
    console.error('Social Desk startup failed:', error.message);
    dialog.showErrorBox('Social Desk could not start', 'Check the data folder permissions and restart the app. Your encrypted vault has not been reset.');
    quitting = true; app.quit();
  });
}
