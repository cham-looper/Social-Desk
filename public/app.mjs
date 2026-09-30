import { deriveKey, seal, unseal, newSalt, validateEnvelope, fromBase64 } from './crypto.mjs';

const app = document.querySelector('#app');
const desktop = window.socialDesktop;
if (desktop) document.body.classList.add('desktop');
let activeAccountId = '', siteState = {}, desktopRequest = 0, pendingLock = false;
const desktopCommand = (name, payload) => desktop?.command(name, payload);
const dialog = document.querySelector('#dialog');
const token = document.querySelector('meta[name="local-token"]').content;
document.querySelector('meta[name="local-token"]').remove();
const platformList = [
  ['x', 'X', 'X', 'https://x.com/'], ['facebook', 'Facebook', 'f', 'https://www.facebook.com/'],
  ['instagram', 'Instagram', 'ig', 'https://www.instagram.com/'], ['linkedin', 'LinkedIn', 'in', 'https://www.linkedin.com/feed/'],
  ['telegram', 'Telegram', 'tg', 'https://web.telegram.org/'], ['whatsapp', 'WhatsApp', 'wa', 'https://web.whatsapp.com/'],
  ['pinterest', 'Pinterest', 'P', 'https://www.pinterest.com/'], ['tiktok', 'TikTok', 'tk', 'https://www.tiktok.com/'],
  ['threads', 'Threads', '@', 'https://www.threads.com/'], ['bluesky', 'Bluesky', 'bs', 'https://bsky.app/'],
  ['reddit', 'Reddit', 'r/', 'https://www.reddit.com/'], ['discord', 'Discord', 'dc', 'https://discord.com/channels/@me'],
  ['mastodon', 'Mastodon', 'm', 'https://mastodon.social/'], ['custom', 'Other platform', '+', '']
];
const platforms = Object.fromEntries(platformList.map(([id, name, mark, url]) => [id, { id, name, mark, url }]));
const paths = {
  compose: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L9 17l-4 1 1-4Z"/>',
  accounts: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  drafts: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>',
  settings: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  external: '<path d="M14 3h7v7M21 3l-9 9M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  clip: '<path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2M5 15l9-9"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.drafts}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const platformIcon = id => `<span class="platform-icon ${platforms[id] ? id : 'custom'}" aria-hidden="true">${esc(platforms[id]?.mark || '+')}</span>`;
const date = value => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const bytes = value => value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
const emptyComposer = () => ({ id: null, title: '', text: '', targets: [], files: [] });
let db = null, key = null, salt = null, envelope = null, revision = null;
let view = 'compose', composer = emptyComposer(), dirty = false, queue = Promise.resolve(), saveFailure = '', pendingWrites = 0;
let lastActivity = Date.now(), toastTimer, autoSaveTimer, locked = true, busy = false, historyFilter = 'all', searchTerm = '', restoring = false;
let pageEpoch = 0;

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message; element.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('show'), 4800);
}
function errorText(error) { return error?.message || 'Something went wrong. Your work is still in this window.'; }
async function api(method = 'GET', body) {
  const response = await fetch('/api/vault', { method, headers: { 'X-Social-Desk': token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not access your local vault.');
  return result;
}
function validateData(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.accounts) || !Array.isArray(data.drafts) || !Array.isArray(data.history)) throw new Error('This file does not contain a Social Desk workspace.');
  const text = (v, limit = 100000) => typeof v === 'string' && v.length <= limit;
  for (const a of data.accounts) if (!a || !text(a.id, 100) || !platforms[a.platform] || !text(a.label, 200) || !text(a.username, 500) || !text(a.password, 10000) || !text(a.notes) || !text(a.url, 2048)) throw new Error('Invalid account in backup.');
  for (const a of data.accounts) safeURL(a.url);
  for (const d of data.drafts) {
    if (!d || !text(d.id, 100) || !text(d.title, 200) || !text(d.text) || !Array.isArray(d.targets) || !d.targets.every(id => text(id, 100)) || !Array.isArray(d.files) || !Number.isFinite(Date.parse(d.updatedAt))) throw new Error('Invalid draft in backup.');
    for (const f of d.files) if (!f || !text(f.id, 100) || !text(f.name, 500) || !text(f.type, 100) || !/^data:(image\/(png|jpeg|webp|gif)|video\/(mp4|webm));base64,[A-Za-z0-9+/]+=*$/.test(f.data) || !Number.isFinite(f.size)) throw new Error('Invalid attachment in backup.');
  }
  for (const h of data.history) {
    if (!h || !text(h.id, 100) || !text(h.text) || !text(h.title, 200) || !text(h.label, 200) || !text(h.accountId, 100) || !text(h.draftId, 100) || !platforms[h.platform] || !['pending', 'posted', 'skipped'].includes(h.status) || !Number.isFinite(Date.parse(h.openedAt)) || (h.postedAt !== null && !Number.isFinite(Date.parse(h.postedAt))) || !text(h.postUrl, 2048) || !Array.isArray(h.fileNames) || !h.fileNames.every(name => text(name, 500))) throw new Error('Invalid history in backup.');
    if (h.postUrl) safeURL(h.postUrl);
  }
  return data;
}
function safeURL(raw) {
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('Enter a complete HTTPS address, such as https://mastodon.social/.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Use an HTTPS address without a username or password in the link.');
  return parsed.href;
}
function newDatabase() {
  return { version: 1, createdAt: new Date().toISOString(), accounts: platformList.filter(([id]) => id !== 'custom').map(([id, name, , url]) => ({ id: crypto.randomUUID(), platform: id, label: name, url, username: '', password: '', notes: '' })), drafts: [], history: [] };
}
function updateSaveStatus() {
  const element = document.querySelector('#save-status');
  if (element) { element.textContent = saveFailure ? 'Not saved · export a backup' : pendingWrites ? 'Saving encrypted changes…' : dirty ? 'Unsaved draft' : 'Saved on this computer'; element.classList.toggle('danger-text', !!saveFailure); }
  const banner = document.querySelector('#save-failure');
  if (banner) { banner.textContent = saveFailure; banner.classList.toggle('hidden', !saveFailure); }
}
async function persist() {
  if (!key || !db) throw new Error('Unlock the workspace first.');
  if (saveFailure) throw new Error(saveFailure);
  const snapshot = structuredClone(db), writeKey = key, writeSalt = salt;
  pendingWrites++; updateSaveStatus();
  const run = queue.then(async () => {
    if (saveFailure) throw new Error(saveFailure);
    const next = await seal(snapshot, writeKey, writeSalt);
    const result = await api('PUT', { envelope: next, revision });
    envelope = next; revision = result.revision;
  });
  queue = run.catch(error => { saveFailure = errorText(error); });
  try { await run; } finally { pendingWrites--; updateSaveStatus(); }
}
function renderGate(message = '') {
  if (desktop) desktopCommand('lock').catch(() => {});
  app.innerHTML = `<main class="unlock"><section class="unlock-story"><div class="row"><span class="brand-mark">S</span><span class="wordmark">Social Desk</span></div><div><span class="eyebrow">Your private publishing workspace</span><h1>One desk.<br>All your accounts.</h1><p>Prepare once. Open your platforms. Publish on your terms.</p><div class="platform-ribbon"><span>X</span><span>Instagram</span><span>LinkedIn</span><span>WhatsApp</span><span>+ 9 platforms</span></div></div><div class="unlock-foot row">${icon('shield')} Local storage · Encrypted vault · Manual publishing</div></section><section class="unlock-form"><div><span class="badge blue">${icon('lock')} PRIVATE WORKSPACE</span><h2>${envelope ? 'Welcome back' : 'Make this desk yours'}</h2><p class="muted">${envelope ? 'Unlock your accounts, drafts, and history.' : 'Set a master password to encrypt your workspace on this computer.'}</p><form id="unlock-form" class="stack"><label class="field">Master password<input name="password" type="password" autocomplete="${envelope ? 'current-password' : 'new-password'}" required minlength="${envelope ? 1 : 12}" maxlength="1024" autofocus placeholder="${envelope ? 'Enter your master password' : 'At least 12 characters'}"></label>${envelope ? '' : '<label class="field">Confirm master password<input name="confirm" type="password" autocomplete="new-password" required minlength="12" maxlength="1024"></label><p class="hint backup-warning">Keep this password somewhere safe. There is no password reset or recovery service.</p>'}<p id="unlock-error" class="error ${message ? '' : 'hidden'}">${esc(message)}</p><button class="button primary wide" type="submit">${icon('lock')}${envelope ? 'Unlock workspace' : 'Create encrypted workspace'}</button></form><p class="hint">${desktop ? 'Your master password unlocks the encrypted vault. Sign in to each platform inside the desktop workspace.' : 'Your master password stays in this browser while unlocking. Social-platform logins stay in your normal browser tabs.'}</p><div class="footer-links"><button class="button quiet" data-action="restore">${icon('download')}Restore encrypted backup</button></div></div></section></main>`;
  document.querySelector('#unlock-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button[type="submit"]');
    const password = form.elements.password.value;
    if (!envelope && password !== form.elements.confirm.value) { gateError('The passwords do not match.'); return; }
    if (!envelope && password.trim().length < 12) { gateError('Use a master password with at least 12 non-padding characters.'); return; }
    button.disabled = true; button.textContent = 'Unlocking…';
    try {
      const latest = await api();
      if (!!latest.envelope !== !!envelope) { envelope = latest.envelope; revision = latest.revision; renderGate('The workspace changed. Please unlock again.'); return; }
      revision = latest.revision; envelope = latest.envelope;
      salt = envelope?.salt || newSalt();
      const candidateKey = await deriveKey(password, salt);
      const candidateData = envelope ? validateData(await unseal(envelope, candidateKey)) : newDatabase();
      key = candidateKey; db = candidateData; saveFailure = ''; queue = Promise.resolve();
      if (!envelope) await persist();
      form.reset(); locked = false; lastActivity = Date.now(); pageEpoch++;
      if (desktop) await desktopCommand('unlock');
      composer = emptyComposer(); dirty = false; view = 'compose'; render();
    } catch (error) {
      key = null; db = null; salt = null;
      gateError(error.name === 'OperationError' ? 'That password did not unlock this vault, or the file is damaged.' : errorText(error));
    } finally { if (button.isConnected) { button.disabled = false; button.textContent = envelope ? 'Unlock workspace' : 'Create encrypted workspace'; } }
  });
}
function gateError(text) { const e = document.querySelector('#unlock-error'); e.textContent = text; e.classList.remove('hidden'); }
function render() {
  if (locked) return renderGate();
  if (desktop && view !== 'platform') desktopCommand('hide').catch(() => {});
  const names = { compose: 'Compose', accounts: 'Accounts', drafts: 'Drafts', history: 'History', settings: 'Vault & settings' };
  const count = name => name === 'drafts' ? db.drafts.length : name === 'history' ? db.history.filter(h => h.status === 'pending').length : 0;
  app.innerHTML = `<div class="layout"><aside class="sidebar"><div class="row"><span class="brand-mark">S</span><span class="wordmark">Social Desk</span></div><nav aria-label="Main navigation">${Object.entries(names).map(([id, title]) => `<button class="nav-button ${view === id ? 'active' : ''}" data-action="nav" data-id="${id}" ${view === id ? 'aria-current="page"' : ''}>${icon(id)}${title}${count(id) ? `<span class="nav-count">${count(id)}</span>` : ''}</button>`).join('')}</nav>${platformSidebar()}<div class="sidebar-bottom"><div class="sidebar-note">${icon('shield')} Encrypted on this computer</div><button class="button" data-action="lock">${icon('lock')}Lock workspace</button><p class="small">You choose what gets posted.</p></div></aside><div class="main"><header class="topbar"><span class="topbar-title">Personal workspace <span aria-hidden="true">/</span> ${view === 'platform' ? 'Platform workspace' : names[view]}</span><div class="row"><span class="badge">${desktop ? 'Desktop' : 'Local only'}</span><span id="save-status" class="save-status"></span><button class="button quiet" data-action="lock" aria-label="Lock workspace">${icon('lock')}</button></div></header><div id="save-failure" class="failure-banner hidden" role="alert"></div><main class="content">${view === 'platform' ? platformView() : view === 'compose' ? composeView() : view === 'accounts' ? accountsView() : view === 'drafts' ? draftsView() : view === 'history' ? historyView() : settingsView()}</main></div></div>`;
  updateSaveStatus(); bindView();
}
function platformSidebar() {
  if (!desktop) return '';
  return `<div class="platform-nav"><p class="section-label">Your platforms</p><nav aria-label="Social platforms">${db.accounts.map(a => `<button class="nav-button ${view === 'platform' && activeAccountId === a.id ? 'active' : ''}" data-action="account-open" data-id="${esc(a.id)}" title="${esc(a.label)}">${platformIcon(a.platform)}<span>${esc(a.label)}</span></button>`).join('')}</nav></div>`;
}
function platformView() {
  const account = db.accounts.find(a => a.id === activeAccountId);
  if (!account) return '<p>Select a platform from the sidebar.</p>';
  return `<section class="platform-shell"><div class="site-toolbar"><div class="row"><strong>${esc(account.label)}</strong><span id="site-origin" class="site-origin">${esc(siteState.origin || new URL(account.url).origin)}</span><span id="site-loading" class="hint">${siteState.loading ? 'Loading…' : ''}</span></div><div class="row"><button class="button" data-action="site-back" aria-label="Back">←</button><button class="button" data-action="site-forward" aria-label="Forward">→</button><button class="button" data-action="site-reload">Reload</button><button class="button primary" data-action="site-paste" ${!composer.text.trim() ? 'disabled' : ''}>${icon('copy')}Paste prepared text</button><button class="button" data-action="nav" data-id="compose">Post & media</button><button class="button" data-action="site-external">${icon('external')}Open in browser</button></div><p class="hint">Click the platform’s text field, then Paste prepared text. Attach media and publish yourself.</p></div><div class="site-space" aria-label="Platform browser"><p>Opening ${esc(account.label)}…</p></div><div class="site-status" id="site-status" role="status">${esc(siteState.message || 'Complete login and 2FA on the platform. Google sign-in may require your normal browser.')}</div></section>`;
}
async function openDesktopAccount(account) {
  const request = ++desktopRequest;
  await desktopCommand('hide');
  if (dirty) await saveDraft(false);
  if (locked || request !== desktopRequest) return;
  activeAccountId = account.id; siteState = {}; view = 'platform'; render(); window.scrollTo(0, 0);
  try { await desktopCommand('open', { id: account.id, url: account.url }); }
  catch (error) { const status = document.querySelector('#site-status'); if (status) status.textContent = errorText(error); throw error; }
}
function updateSiteState(data) {
  if (data.id !== activeAccountId) return;
  siteState = data;
  const origin = document.querySelector('#site-origin'), status = document.querySelector('#site-status'), loading = document.querySelector('#site-loading');
  if (origin && data.origin) origin.textContent = data.origin;
  if (status) status.textContent = data.message || 'Complete login and 2FA on the platform. Google sign-in may require your normal browser.';
  if (loading) loading.textContent = data.loading ? 'Loading…' : '';
  const back = document.querySelector('[data-action="site-back"]'), forward = document.querySelector('[data-action="site-forward"]');
  if (back) back.disabled = !data.back;
  if (forward) forward.disabled = !data.forward;
}
function composeView() {
  const chosen = composer.targets.length;
  return `<div class="page-heading"><div><h1>What are you sharing?</h1><p>One draft. Your platforms. You make the final click.</p></div><button class="button" data-action="new">${icon('plus')}New draft</button></div><div class="work-grid"><div class="stack"><section class="panel"><div class="panel-head row between"><h2>Prepare your post</h2><span class="badge">${composer.id ? 'Saved draft' : 'New draft'}</span></div><div class="panel-body"><label class="hidden" for="draft-title">Draft title</label><input id="draft-title" class="composer-title" maxlength="200" placeholder="Give this draft a name…" value="${esc(composer.title)}" aria-label="Draft title"><label class="hidden" for="draft-text">Post text</label><textarea id="draft-text" class="composer-text" maxlength="100000" placeholder="Write your post here. Add links, hashtags, or anything you want to share.\n\nYou can edit it again on each platform before publishing." aria-label="Post text">${esc(composer.text)}</textarea><div class="composer-meta"><button class="button quiet" data-action="attach">${icon('clip')}Add media</button><span id="char-count">${[...composer.text].length.toLocaleString()} characters</span></div><input id="media-input" class="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" multiple><div id="composer-files">${fileList(composer.files, true)}</div></div><div class="compose-actions"><span class="hint">${chosen ? `${chosen} destination${chosen === 1 ? '' : 's'} selected` : 'Choose your destinations'}</span><div class="row"><button class="button" data-action="save">Save draft</button><button class="button primary" data-action="copy">${icon('copy')}Copy text</button></div></div></section><section class="panel"><div class="panel-body"><h2>Your publishing flow</h2><div class="step-list section-label-reset"><div class="row"><span class="step-number">1</span><span>Select a destination and choose <strong>Copy & open</strong>.</span></div><div class="row"><span class="step-number">2</span><span>Check your account, paste, attach media, and publish.</span></div><div class="row"><span class="step-number">3</span><span>Return here and mark it posted in History.</span></div></div></div></section></div><section class="panel"><div class="panel-head row between"><div><h2>Destinations</h2><p class="hint">${desktop ? 'Open here with your saved account session.' : 'Use your saved browser logins.'}</p></div><button class="button quiet" data-action="select-all">${chosen === db.accounts.length ? 'Clear' : 'Select all'}</button></div><div class="dest-list">${db.accounts.length ? db.accounts.map(a => `<div class="destination"><input class="check" type="checkbox" data-target="${esc(a.id)}" aria-label="Select ${esc(a.label)}" ${composer.targets.includes(a.id) ? 'checked' : ''}>${platformIcon(a.platform)}<div class="grow"><p class="destination-name">${esc(a.label)}</p><p>${esc(a.username || (desktop ? 'Sign in inside the workspace' : 'Check account in browser'))}</p></div><button class="button handoff-button" data-action="handoff" data-id="${esc(a.id)}" ${!composer.text.trim() || !composer.targets.includes(a.id) ? 'disabled' : ''}>Copy & open</button></div>`).join('') : '<div class="empty"><p>Add an account to get started.</p><button class="button" data-action="account-add">Add account</button></div>'}</div><div class="platform-footer">Nothing publishes automatically. Platform limits and formatting still apply.</div></section></div>`;
}
function fileList(files, editable = false) {
  if (!files.length) return '';
  return `<div class="file-list">${files.map(f => `<div class="file-chip">${f.type.startsWith('image/') ? `<img src="${esc(f.data)}" alt="">` : icon('clip')}<span class="grow">${esc(f.name)}<br><span class="muted small">${bytes(f.size)}</span></span><button class="button" data-action="file-save" data-id="${esc(f.id)}" aria-label="Save ${esc(f.name)}">${icon('download')}</button>${editable ? `<button class="button quiet" data-action="file-remove" data-id="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">×</button>` : ''}</div>`).join('')}</div><p class="hint">Attach media yourself on each platform. Downloaded copies are ordinary, unencrypted files.</p>`;
}
function accountsView() {
  return `<div class="page-heading"><div><h1>All your accounts</h1><p>Open a platform, or keep its account details in your vault.</p></div><button class="button primary" data-action="account-add">${icon('plus')}Add account</button></div><div class="note">${desktop ? 'Each account has a separate saved browser session. Sign in and complete 2FA yourself. Check the account before posting.' : 'Login happens on the platform itself. These shortcuts use the account currently signed in to your browser; they do not switch accounts or check login status.'}</div><p class="section-label">${db.accounts.length} account shortcuts</p><div class="accounts-grid">${db.accounts.map(a => `<section class="panel account-card"><div class="row between"><div class="row">${platformIcon(a.platform)}<h2>${esc(a.label)}</h2></div>${a.password ? `<span class="badge" title="A password is saved in your vault">${icon('lock')}</span>` : ''}</div><div class="account-details"><p>${esc(a.username || 'No account details added')}</p><p class="muted small">${esc(new URL(a.url).hostname)}</p></div><div class="row"><button class="button" data-action="account-edit" data-id="${esc(a.id)}">Details</button><button class="button" data-action="account-open" data-id="${esc(a.id)}">${icon('external')}Open</button></div>${desktop ? `<button class="button quiet session-forget" data-action="session-forget" data-id="${esc(a.id)}">Forget saved login</button>` : ''}</section>`).join('')}</div>`;
}
function draftsView() {
  return `<div class="page-heading"><div><h1>Your drafts</h1><p>Pick up where you left off.</p></div><button class="button primary" data-action="new">${icon('plus')}New draft</button></div>${db.drafts.length ? `<div class="panel">${[...db.drafts].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(d => `<article class="list-card"><div class="grow"><h3>${esc(d.title || 'Untitled draft')}</h3><p class="list-excerpt">${esc(d.text || 'Media draft')}</p><p class="history-meta">${date(d.updatedAt)} · ${d.targets.length} destinations${d.files.length ? ` · ${d.files.length} media files` : ''}</p></div><div class="row"><button class="button quiet danger" data-action="draft-delete" data-id="${esc(d.id)}">Delete</button><button class="button" data-action="draft-edit" data-id="${esc(d.id)}">Continue editing</button></div></article>`).join('')}</div>` : `<section class="panel empty">${icon('drafts')}<h2>A space for your next idea</h2><p>Your saved drafts will appear here.</p><button class="button primary" data-action="new">Write a draft</button></section>`}`;
}
function historyView() {
  const filtered = db.history.filter(h => (historyFilter === 'all' || h.status === historyFilter) && `${h.title} ${h.text} ${h.label}`.toLowerCase().includes(searchTerm.toLowerCase()));
  return `<div class="page-heading"><div><h1>Posting history</h1><p>Handoffs and posts you have confirmed yourself.</p></div><span class="badge green">${db.history.filter(h => h.status === 'posted').length} marked posted</span></div><div class="toolbar"><input id="history-search" class="search" type="search" placeholder="Find a post or platform…" aria-label="Search history" value="${esc(searchTerm)}"><label class="field"><select id="history-filter" aria-label="Filter history">${[['all','All activity'],['pending','Awaiting confirmation'],['posted','Marked posted'],['skipped','Not posted']].map(([id,label]) => `<option value="${id}" ${historyFilter === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><div id="history-results">${historyRows(filtered)}</div>`;
}
function historyRows(filtered) {
  return filtered.length ? `<div class="panel">${[...filtered].reverse().map(h => `<article class="list-card">${platformIcon(h.platform)}<div class="grow"><div class="row wrap"><h3>${esc(h.title || 'Untitled post')}</h3><span class="badge ${h.status === 'posted' ? 'green' : h.status === 'pending' ? 'amber' : ''}">${h.status === 'posted' ? 'Marked posted' : h.status === 'pending' ? 'Awaiting confirmation' : 'Not posted'}</span></div><p class="list-excerpt">${esc(h.text)}</p><p class="history-meta">${esc(h.label)} · ${date(h.postedAt || h.openedAt)}</p></div><div class="row wrap"><button class="button quiet" data-action="history-detail" data-id="${esc(h.id)}">Details</button>${h.status === 'pending' ? `<button class="button primary" data-action="history-posted" data-id="${esc(h.id)}">${icon('check')}Mark posted</button>` : ''}</div></article>`).join('')}</div>` : `<section class="panel empty">${icon('history')}<h2>${db.history.length ? 'No matching activity' : 'Your history starts here'}</h2><p>Copy & open a destination to record a handoff.<br>Only your confirmation marks it posted.</p></section>`;
}
function settingsView() {
  return `<div class="page-heading"><div><h1>Vault & settings</h1><p>Your workspace stays on this computer.</p></div><span class="badge blue">${icon('shield')}Encrypted at rest</span></div><div class="settings-grid"><section class="panel"><div class="panel-head"><h2>Encrypted backups</h2></div><div class="panel-body"><p class="muted">Back up your accounts, saved secrets, drafts, media, and history together. You will need the master password used when that backup was created.</p><button class="button primary" data-action="backup">${icon('download')}Export encrypted backup</button><button class="button" data-action="restore">Restore a backup</button><p class="hint">Restoring replaces this workspace. Export a current backup first.</p></div></section><section class="panel"><div class="panel-head"><h2>Master password & locking</h2></div><div class="panel-body"><p class="muted">The vault locks after 10 minutes without activity here. Lock it yourself when you step away.</p><button class="button" data-action="change-password">Change master password</button><button class="button" data-action="lock">${icon('lock')}Lock now</button><p class="hint">Locking hides and clears this workspace. It does not sign you out of social sites or clear your clipboard.</p></div></section><section class="panel"><div class="panel-head"><h2>What is kept private</h2></div><div class="panel-body"><p>Account details and passwords, draft text and media, and posting history are encrypted before being saved.</p><p class="hint">The master password is not saved. No analytics, cloud sync, social APIs, or external fonts are used. Platform pages have their own privacy policies.</p><p class="hint">Encryption protects stored files. An unlocked app, a compromised computer, browser extensions, or clipboard history can expose data. This app has not had an independent security audit.</p></div></section><section class="panel"><div class="panel-head"><h2>Browser logins</h2></div><div class="panel-body">${desktop ? `<p>Sign in and complete 2FA inside each platform. Sessions are saved separately for each account, until the platform expires or revokes them.</p><p class="hint">Passwords, drafts and history are encrypted by your master password. Website cookies, caches and other browser data are stored separately in data/desktop-profile; the vault password does not encrypt that entire folder. Protect your Windows login and disk.</p><p class="hint">Google OAuth setup cannot remove Google’s embedded-browser restriction. Use Open in browser if a login fails here. That login stays in your browser and does not transfer back to this app.</p><p class="hint">Encrypted backups do not include website sessions. Use Accounts → Forget saved login to clear an account’s local cookies and website data.</p>` : `<p>Sign in manually on each platform in your normal browser. Let your browser or trusted password manager remember the login.</p><p class="hint">Passwords saved here are optional reference copies. Social Desk does not import cookies, read passwords from your browser, fill login forms, or verify whether you posted.</p><p class="hint">Multiple accounts on the same platform share the browser’s active login. Check the account before every post, or use separate browser profiles manually.</p>`}</div></section></div>`;
}
function bindView() {
  if (view === 'compose') {
    for (const [id, field] of [['draft-title', 'title'], ['draft-text', 'text']]) document.querySelector(`#${id}`).addEventListener('input', event => {
      composer[field] = event.target.value; dirty = true; updateSaveStatus();
      document.querySelector('#char-count').textContent = `${[...composer.text].length.toLocaleString()} characters`;
      document.querySelectorAll('.handoff-button').forEach(button => { button.disabled = !composer.text.trim() || !composer.targets.includes(button.dataset.id); });
      clearTimeout(autoSaveTimer); autoSaveTimer = setTimeout(() => saveDraft(false).catch(error => toast(errorText(error))), 1000);
    });
    document.querySelectorAll('[data-target]').forEach(input => input.addEventListener('change', () => {
      composer.targets = input.checked ? [...new Set([...composer.targets, input.dataset.target])] : composer.targets.filter(id => id !== input.dataset.target);
      dirty = true; render();
    }));
    document.querySelector('#media-input').addEventListener('change', event => attachFiles(event.target.files).catch(error => toast(errorText(error))));
  }
  if (view === 'history') {
    const update = () => {
      historyFilter = document.querySelector('#history-filter').value; searchTerm = document.querySelector('#history-search').value;
      document.querySelector('#history-results').innerHTML = historyRows(db.history.filter(h => (historyFilter === 'all' || h.status === historyFilter) && `${h.title} ${h.text} ${h.label}`.toLowerCase().includes(searchTerm.toLowerCase())));
    };
    document.querySelector('#history-search').addEventListener('input', update);
    document.querySelector('#history-filter').addEventListener('change', update);
  }
}
async function saveDraft(showToast = true) {
  clearTimeout(autoSaveTimer);
  if (!db || !key) return;
  if (!composer.id && !composer.text.trim() && !composer.title.trim() && !composer.files.length) { dirty = false; updateSaveStatus(); if (showToast) toast('Write something or add media first.'); return; }
  if (!composer.id) composer.id = crypto.randomUUID();
  const item = { ...structuredClone(composer), updatedAt: new Date().toISOString() };
  const index = db.drafts.findIndex(d => d.id === item.id);
  if (index < 0) db.drafts.push(item); else db.drafts[index] = item;
  dirty = false;
  try { await persist(); if (showToast) { render(); toast('Draft saved in your encrypted vault.'); } }
  catch (error) { dirty = true; throw error; }
}
async function attachFiles(files) {
  const epoch = pageEpoch, draftId = composer.id;
  const accepted = new Set(['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm']);
  const additions = [];
  let total = db.drafts.reduce((n,d) => n + d.files.reduce((sum,f) => sum + f.size, 0), 0) + (composer.id ? 0 : composer.files.reduce((n,f) => n + f.size, 0));
  for (const file of files) {
    if (!accepted.has(file.type)) throw new Error('Use PNG, JPG, WebP, GIF, MP4, or WebM files.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Each attachment must be 10 MB or smaller. Keep larger videos outside the vault and upload them manually.');
    total += file.size;
    if (total > 25 * 1024 * 1024) throw new Error('This vault supports up to 25 MB of attachments.');
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read this file.')); reader.readAsDataURL(file); });
    additions.push({ id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, data });
  }
  if (locked || epoch !== pageEpoch || draftId !== composer.id) return;
  composer.files.push(...additions); dirty = true; await saveDraft(false); render();
}
function download(content, name, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function openPlatform(account) {
  if (desktop) return openDesktopAccount(account);
  const url = safeURL(account.url);
  const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click();
}
async function handoff(id) {
  if (busy) return;
  const account = db.accounts.find(a => a.id === id);
  if (!account || !composer.text.trim()) throw new Error('Prepare your text first.');
  safeURL(account.url);
  if (!composer.id) composer.id = crypto.randomUUID();
  const outgoing = structuredClone(composer);
  busy = true;
  const epoch = pageEpoch;
  try {
    // Start clipboard access in the click event; browser activation is not carried through an encryption round trip.
    const clipboard = navigator.clipboard.writeText(outgoing.text);
    await clipboard;
    if (locked || epoch !== pageEpoch) return;
    if (!desktop) await openPlatform(account);
    await saveDraft(false);
    recordHandoff(account, outgoing);
    await persist();
    if (desktop) await openDesktopAccount(account); else render();
    toast(desktop ? 'Draft ready. Paste into the platform, publish yourself, then confirm in History.' : 'Text copied. Paste and publish in the platform tab, then mark it posted in History.');
  } catch (error) {
    if (error.name === 'NotAllowedError') throw new Error('Clipboard access was blocked. Allow it for this local app, or select and copy the draft text yourself.');
    throw error;
  } finally { busy = false; }
}
function recordHandoff(account, outgoing) {
  const existing = db.history.find(h => h.status === 'pending' && h.draftId === outgoing.id && h.accountId === account.id && h.text === outgoing.text);
  if (!existing) db.history.push({ id: crypto.randomUUID(), accountId: account.id, draftId: outgoing.id, platform: account.platform, label: account.label, title: outgoing.title, text: outgoing.text, fileNames: outgoing.files.map(f => f.name), status: 'pending', openedAt: new Date().toISOString(), postedAt: null, postUrl: '' });
}
function closeDialog() { if (dialog.open) dialog.close(); dialog.innerHTML = ''; }
function modal(title, content, submit, label = 'Save', extra = '') {
  if (desktop) desktopCommand('hide').catch(() => {});
  closeDialog();
  dialog.innerHTML = `<form id="modal-form"><header class="dialog-head"><h2>${esc(title)}</h2></header><div class="dialog-body">${content}<p id="modal-error" class="error hidden" role="alert"></p></div><footer class="dialog-actions">${extra}<button class="button" type="button" data-action="dialog-close">Cancel</button>${submit ? `<button class="button primary" type="submit">${esc(label)}</button>` : ''}</footer></form>`;
  dialog.showModal();
  document.querySelector('#modal-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!submit) return;
    if (busy) return;
    const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true; busy = true; dialog.inert = true;
    try { await submit(event.currentTarget); closeDialog(); }
    catch (error) { const e = document.querySelector('#modal-error'); if (e) { e.textContent = errorText(error); e.classList.remove('hidden'); } }
    finally { busy = false; dialog.inert = false; if (button.isConnected) button.disabled = false; }
  });
}
function accountDialog(id) {
  const account = db.accounts.find(a => a.id === id) || { platform: 'x', label: '', username: '', password: '', url: platforms.x.url, notes: '' };
  modal(id ? 'Account details' : 'Add account', `<div class="two-col"><label class="field">Platform<select name="platform">${platformList.map(([pid,name]) => `<option value="${pid}" ${pid === account.platform ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label class="field">Account label<input name="label" maxlength="200" required placeholder="e.g. LinkedIn · Personal" value="${esc(account.label)}"></label></div><label class="field">Platform address<input name="url" type="url" required maxlength="2048" value="${esc(account.url)}"><span class="hint">For Mastodon, use the address of your own server.</span></label><label class="field">Username or email<input name="username" maxlength="500" autocomplete="off" value="${esc(account.username)}"></label><label class="field">Password <span class="hint">Optional · encrypted in the vault</span><span class="password-row"><input name="secret" type="password" autocomplete="off" maxlength="10000" value="${esc(account.password)}"><button type="button" class="button" data-action="secret-toggle">Show</button><button type="button" class="button" data-action="secret-copy">Copy</button></span></label><label class="field">Private notes<textarea name="notes" maxlength="100000" placeholder="Account reminders or other private details">${esc(account.notes)}</textarea></label><p class="hint">Sign in on the platform itself. Saving a password here does not log you in.</p>`, async form => {
    const item = { id: id || crypto.randomUUID(), platform: form.elements.platform.value, label: form.elements.label.value.trim(), username: form.elements.username.value.trim(), password: form.elements.secret.value, notes: form.elements.notes.value, url: safeURL(form.elements.url.value.trim()) };
    if (!item.label) throw new Error('Give this account a label.');
    const index = db.accounts.findIndex(a => a.id === id);
    if (index < 0) db.accounts.push(item); else db.accounts[index] = item;
    await persist(); render(); toast('Account details saved in your encrypted vault.');
  }, 'Save account', id ? `<button class="button quiet danger" type="button" data-action="account-delete" data-id="${esc(id)}">Remove</button>` : '');
  dialog.querySelector('[name="platform"]').addEventListener('change', event => {
    const p = platforms[event.target.value];
    dialog.querySelector('[name="url"]').value = p.url;
    if (!id || !dialog.querySelector('[name="label"]').value) dialog.querySelector('[name="label"]').value = p.name;
  });
}
function markPosted(id) {
  const entry = db.history.find(h => h.id === id);
  if (!entry) return;
  modal('Confirm you published this post', `<div class="row">${platformIcon(entry.platform)}<div><h3>${esc(entry.label)}</h3><p class="hint">${esc(entry.title || 'Untitled post')}</p></div></div><div class="fulltext">${esc(entry.text)}</div><label class="field">Published post link <span class="hint">Optional</span><input type="url" name="url" placeholder="https://…" maxlength="2048"></label><p class="hint">This records your confirmation. Social Desk cannot check the platform.</p>`, async form => {
    entry.postUrl = form.elements.url.value.trim() ? safeURL(form.elements.url.value.trim()) : '';
    entry.status = 'posted'; entry.postedAt = new Date().toISOString();
    await persist(); render(); toast('Marked posted in your history.');
  }, 'Yes, I posted this');
}
function historyDetail(id) {
  const entry = db.history.find(h => h.id === id);
  if (!entry) return;
  modal(entry.title || 'Post details', `<div class="row">${platformIcon(entry.platform)}<div><h3>${esc(entry.label)}</h3><p class="hint">Opened ${date(entry.openedAt)}${entry.postedAt ? `<br>Marked posted ${date(entry.postedAt)}` : ''}</p></div></div><div class="fulltext">${esc(entry.text)}</div>${entry.fileNames?.length ? `<p class="hint">Media prepared: ${entry.fileNames.map(esc).join(', ')}</p>` : ''}${entry.postUrl ? `<a class="button" href="${esc(safeURL(entry.postUrl))}" target="_blank" rel="noopener noreferrer">Open published post</a>` : ''}${entry.status === 'pending' ? `<button class="button" type="button" data-action="history-skipped" data-id="${esc(id)}">I did not post this</button>` : ''}<p class="hint">History preserves the text handed off. Changes you make on the platform are not captured here.</p>`, null);
}
async function backup() {
  if (!db || !key) throw new Error('Unlock the vault before exporting.');
  if (dirty) {
    if (!composer.id) composer.id = crypto.randomUUID();
    const draft = { ...structuredClone(composer), updatedAt: new Date().toISOString() }, index = db.drafts.findIndex(d => d.id === draft.id);
    if (index < 0) db.drafts.push(draft); else db.drafts[index] = draft;
  }
  const encrypted = await seal(db, key, salt);
  download(JSON.stringify(encrypted), `social-desk-${new Date().toISOString().slice(0,10)}.socialvault`);
  toast('Encrypted backup exported. Keep its master password safe.');
}
function restoreDialog() {
  restoring = true;
  modal('Restore an encrypted backup', `<p class="hint">${envelope ? 'This replaces the current workspace. Export a backup before continuing.' : 'Choose a Social Desk backup and enter the password used when it was exported.'}</p><label class="field">Backup file<input type="file" name="file" accept=".socialvault,application/json" required></label><label class="field">Backup master password<input name="password" type="password" autocomplete="off" required maxlength="1024"></label>${envelope ? '<label class="row hint"><input class="check" type="checkbox" required>I understand this replaces my current workspace.</label>' : ''}`, async form => {
    const file = form.elements.file.files[0];
    if (file.size > 64 * 1024 * 1024) throw new Error('This backup is larger than the supported vault size.');
    const candidate = validateEnvelope(JSON.parse(await file.text()));
    const candidateKey = await deriveKey(form.elements.password.value, candidate.salt);
    let data;
    try { data = validateData(await unseal(candidate, candidateKey)); } catch (error) { throw new Error(error.name === 'OperationError' ? 'The backup password is incorrect, or the file is damaged.' : errorText(error)); }
    clearTimeout(autoSaveTimer); await queue;
    const current = await api();
    // A concurrent update is never silently replaced, even during restore.
    if (current.revision !== revision) throw new Error('The local workspace changed. Reload before restoring this backup.');
    const result = await api('PUT', { envelope: candidate, revision });
    envelope = candidate; revision = result.revision; key = candidateKey; salt = candidate.salt; db = data;
    if (desktop) { await desktopCommand('lock'); await desktopCommand('unlock'); }
    composer = emptyComposer(); dirty = false; saveFailure = ''; queue = Promise.resolve(); locked = false; restoring = false; lastActivity = Date.now(); pageEpoch++; view = 'compose'; render(); toast('Backup restored.');
  }, 'Restore workspace');
}
function changePassword() {
  modal('Change master password', '<label class="field">Current master password<input type="password" name="current" autocomplete="current-password" required maxlength="1024"></label><label class="field">New master password<input type="password" name="password" autocomplete="new-password" required minlength="12" maxlength="1024"></label><label class="field">Confirm new password<input type="password" name="confirm" autocomplete="new-password" required minlength="12" maxlength="1024"></label><p class="hint">Existing backup files still use their old master password. Export a new backup after changing it.</p>', async form => {
    if (form.elements.password.value !== form.elements.confirm.value) throw new Error('The new passwords do not match.');
    if (form.elements.password.value.trim().length < 12) throw new Error('Use at least 12 non-padding characters.');
    const oldKey = await deriveKey(form.elements.current.value, salt);
    try { await unseal(envelope, oldKey); } catch { throw new Error('The current master password is incorrect.'); }
    if (dirty) await saveDraft(false); await queue;
    if (saveFailure) throw new Error(saveFailure);
    const nextSalt = newSalt(), nextKey = await deriveKey(form.elements.password.value, nextSalt);
    const next = await seal(db, nextKey, nextSalt);
    const result = await api('PUT', { envelope: next, revision });
    salt = nextSalt; key = nextKey; envelope = next; revision = result.revision; toast('Master password changed. Export a fresh backup.');
  }, 'Change password');
}
async function lockWorkspace() {
  if (locked || busy) return;
  busy = true;
  try {
  if (desktop) { desktopRequest++; await desktopCommand('lock'); }
  clearTimeout(autoSaveTimer);
  try { if (dirty) await saveDraft(false); await queue; }
  catch { /* Locking must still remove plaintext after a disk or conflict error. */ }
  if (saveFailure) {
    // Save a recoverable encrypted copy before removing unsaved plaintext from memory.
    try { await backup(); } catch { toast('Could not export unsaved work. Keep this computer protected and try again.'); return; }
  }
  locked = true; pendingLock = false; pageEpoch++; key = null; salt = null; db = null; composer = emptyComposer(); dirty = false; searchTerm = ''; restoring = false;
  closeDialog(); clearTimeout(toastTimer); document.querySelector('#toast').textContent = ''; document.querySelector('#toast').classList.remove('show');
  renderGate(saveFailure ? 'The last save failed. An encrypted backup of your work was downloaded.' : '');
  } finally { busy = false; }
}
async function action(name, id) {
  if (busy) return;
  if (name === 'dialog-close') { restoring = false; closeDialog(); return; }
  if (name === 'restore') return restoreDialog();
  if (locked) return;
  if (name === 'nav') { desktopRequest++; if (dirty) await saveDraft(false); view = id; render(); window.scrollTo(0, 0); }
  else if (name === 'new') { if (dirty) await saveDraft(false); composer = emptyComposer(); dirty = false; view = 'compose'; render(); window.scrollTo(0, 0); document.querySelector('#draft-title').focus(); }
  else if (name === 'lock') await lockWorkspace();
  else if (name === 'save') await saveDraft();
  else if (name === 'copy') { if (!composer.text) return toast('Write your post first.'); await navigator.clipboard.writeText(composer.text); toast('Post text copied.'); }
  else if (name === 'select-all') { composer.targets = composer.targets.length === db.accounts.length ? [] : db.accounts.map(a => a.id); dirty = true; render(); }
  else if (name === 'handoff') await handoff(id);
  else if (name === 'attach') document.querySelector('#media-input').click();
  else if (name === 'file-remove') { composer.files = composer.files.filter(f => f.id !== id); dirty = true; await saveDraft(false); render(); }
  else if (name === 'file-save') { const f = composer.files.find(f => f.id === id); if (f) download(new Blob([fromBase64(f.data.split(',')[1])], { type: f.type }), f.name); }
  else if (name === 'account-add') accountDialog();
  else if (name === 'account-edit') accountDialog(id);
  else if (name === 'account-open') { const a = db.accounts.find(a => a.id === id); if (a) await openPlatform(a); }
  else if (name.startsWith('site-')) {
    const command = name.slice(5), account = db.accounts.find(a => a.id === activeAccountId);
    if (command === 'external' && account) { await desktopCommand('external', account.url); toast('Your browser has its own login session. It does not transfer back here.'); }
    else if (command === 'paste' && account && composer.text.trim()) {
      busy = true;
      try {
        if (!composer.id) composer.id = crypto.randomUUID();
        const outgoing = structuredClone(composer);
        await desktopCommand('paste', outgoing.text);
        await saveDraft(false); recordHandoff(account, outgoing); await persist();
        const status = document.querySelector('#site-status');
        if (status) status.textContent = 'Text sent to the focused field. Review it, publish yourself, then mark posted in History.';
      } finally { busy = false; }
    }
    else if (['back', 'forward', 'reload'].includes(command)) await desktopCommand(command);
  }
  else if (name === 'session-forget' && desktop) { if (await desktopCommand('forget', id)) toast('Saved browser login cleared. Sign in again when you open this account.'); }
  else if (name === 'account-delete') { const a = db.accounts.find(a => a.id === id); modal('Remove account shortcut?', `<p>Remove ${esc(a?.label)} and its saved secrets from this vault? Its existing posting history is kept. This does not delete the social account.</p>`, async () => { db.accounts = db.accounts.filter(a => a.id !== id); composer.targets = composer.targets.filter(x => x !== id); db.drafts.forEach(d => { d.targets = d.targets.filter(x => x !== id); }); await persist(); render(); }, 'Remove shortcut'); }
  else if (name === 'secret-toggle') { const input = dialog.querySelector('[name="secret"]'); input.type = input.type === 'password' ? 'text' : 'password'; dialog.querySelector('[data-action="secret-toggle"]').textContent = input.type === 'password' ? 'Show' : 'Hide'; }
  else if (name === 'secret-copy') { const value = dialog.querySelector('[name="secret"]').value; if (value) { await navigator.clipboard.writeText(value); toast('Password copied. Clipboard history may retain it.'); } }
  else if (name === 'draft-edit') { if (dirty) await saveDraft(false); const d = db.drafts.find(d => d.id === id); if (d) { composer = structuredClone(d); dirty = false; view = 'compose'; render(); } }
  else if (name === 'draft-delete') modal('Delete this draft?', '<p>This removes the draft and its media from the current vault. Posting history is kept.</p>', async () => { db.drafts = db.drafts.filter(d => d.id !== id); if (composer.id === id) { composer = emptyComposer(); dirty = false; } await persist(); render(); }, 'Delete draft');
  else if (name === 'history-posted') markPosted(id);
  else if (name === 'history-detail') historyDetail(id);
  else if (name === 'history-skipped') { const h = db.history.find(h => h.id === id); if (h) { h.status = 'skipped'; await persist(); closeDialog(); render(); } }
  else if (name === 'backup') await backup();
  else if (name === 'change-password') changePassword();
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button && !button.disabled) action(button.dataset.action, button.dataset.id).catch(error => toast(errorText(error)));
});
dialog.addEventListener('close', () => { if (!dialog.open) { dialog.innerHTML = ''; restoring = false; } });
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
for (const type of ['pointerdown', 'keydown', 'input']) document.addEventListener(type, () => { lastActivity = Date.now(); }, { passive: true });
setInterval(() => { if (!locked && (pendingLock || Date.now() - lastActivity >= 10 * 60 * 1000) && !busy) lockWorkspace().catch(() => {}); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !locked && Date.now() - lastActivity >= 10 * 60 * 1000 && !busy) lockWorkspace().catch(() => {}); });
window.addEventListener('beforeunload', event => { if (!locked && (dirty || pendingWrites || saveFailure)) { event.preventDefault(); event.returnValue = ''; } });
async function start() {
  try { const current = await api(); envelope = current.envelope; revision = current.revision; renderGate(); }
  catch (error) { app.innerHTML = `<main class="boot"><span class="brand-mark">S</span><h1>Could not open the workspace</h1><p>${esc(errorText(error))}</p><p class="hint">Restart Social Desk and reload this page.</p></main>`; }
}
if (desktop) desktop.onEvent(async data => {
  if (data.type === 'activity') lastActivity = Date.now();
  else if (data.type === 'site') updateSiteState(data);
  else if (data.type === 'lock') { pendingLock = true; if (!busy) await lockWorkspace(); }
  else if (data.type === 'close') {
    if (busy) { await desktopCommand('close-cancel'); toast('Finish the current action, then close the window.'); return; }
    try { if (!locked) await lockWorkspace(); if (locked) await desktopCommand('quit'); else await desktopCommand('close-cancel'); }
    catch (error) { await desktopCommand('close-cancel'); toast(errorText(error)); }
  }
});
start();

// Optional browser-agent navigation only. Never expose vault contents or secrets as tools.
if (document.modelContext?.registerTool) {
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'open_social_desk_composer',
      title: 'Open Social Desk composer',
      description: 'Navigate to the composer in an already unlocked workspace. Does not publish, copy, or return private workspace contents.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false },
      async execute(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('No arguments are accepted.');
        if (locked || busy) throw new Error('Unlock the workspace and wait for any current action to finish.');
        await action('nav', 'compose');
        return { view: 'compose' };
      }
    })).catch(() => {});
  } catch { /* Browsers without WebMCP use the ordinary interface. */ }
}
