# Social Desk

A local workspace for manual social publishing. No social APIs, automatic posting, browser-session extraction, or cloud sync.

## Open the desktop app (platforms inside one window)

Double-click **Start Social Desk Desktop.cmd**. The desktop runtime has its own browser sessions; it does not import Chrome or Edge logins. The existing encrypted vault is reused. Close the browser version before editing the same vault in the desktop app to avoid save conflicts.

For a fresh installation: install Node.js 22.12 or newer, run `npm ci`, then `npm run setup-desktop`. Start with `npm run desktop` or the desktop launcher. This version uses Electron 44.4.5. Keep Electron updated for Chromium security fixes; no automatic updater is included.

1. Create or unlock your vault. The master password is chosen in the app, never in a source-code file.
2. Click a platform in the left sidebar. Sign in on its page and complete 2FA yourself. Each account shortcut gets its own persistent session.
3. Use Compose to prepare text and media. Select a destination and click **Copy & open**.
4. Click the platform's post field, then **Paste prepared text**, or press Ctrl+V. Upload media using the platform's file picker. **Post & media** returns to your prepared draft; its Download buttons let you save attachments when needed.
5. Publish yourself, then open History and mark the handoff posted. **Copy & open** and **Paste prepared text** record a pending handoff; merely visiting a platform from the sidebar does not create a history entry.

The app keeps a platform's page while you switch destinations. Locking closes the live platform pages and clears the unlocked workspace; cookies remain for next time. Use **Accounts → Forget saved login** to clear one account's cookies and website storage. Use this before removing a shortcut if you also want to remove its retained browser session. Restoring a vault does not restore browser sessions.

### Google login and 2FA

There is no Google OAuth setup required for Social Desk. Your own Google OAuth client would authorize your app; it would not sign you into third-party social accounts or bypass Google's embedded-browser restriction. See [Google's OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies).

Complete passwords, authenticator codes, device approvals and QR logins yourself on the actual service. Sessions can expire or be revoked, and a service can require 2FA again. No service is guaranteed to accept this embedded Chromium browser. Where supported by the platform, its own direct sign-in may work; otherwise **Open in browser** keeps the manual browser workflow available. A login completed in your normal browser **does not transfer into Social Desk**. No cookies are copied, no user-agent spoofing is used, and no security checks are bypassed.

Login popups open within the current account's page; flows that require a separate popup/opener may fail. Camera/microphone, screen sharing, notifications, device access and downloads from social pages are denied in this version. File uploads through the normal file picker remain available. Use the normal browser for features that require denied permissions. Platform terms and anti-abuse rules still apply.

### Where the password is changed

Unlock the app, then **Vault & settings → Change master password**. Enter the current password, the new password, and confirm it. Export a new encrypted backup afterward; older backups still require the old password. If you forget the master password, editing the project cannot recover the encrypted data. Do not put your password in source code, `.env`, or README files.

`data/vault.json` holds the encrypted workspace, not a readable master password. `public/crypto.mjs` implements encryption and `changePassword()` in `public/app.mjs` implements re-encryption; those are implementation files, not password settings.

### Desktop session storage is separate from vault encryption

The encrypted vault contains optional saved passwords, account details, drafts, attachments and history. The Chromium profile at **data/desktop-profile/** contains website cookies, caches and storage. **The vault master password does not encrypt that entire profile.** Treat the profile as sensitive signed-in access, protect your Windows account and disk, and never upload or commit the data folder. Vault backups do not contain browser profiles. Account sessions do not automatically fill their saved password from the vault; copy it manually if needed.

Social pages run in sandboxed, isolated views without Node.js, a preload script, or access to the workspace's desktop commands. The local app validates the sender of every desktop command. It restricts social-page navigation to public HTTPS addresses and keeps local-server requests blocked. This is defense in depth, not a full security audit or a universal network firewall.

## Open the browser version

Double-click **Start Social Desk.cmd**. It starts a background local server and opens `http://127.0.0.1:4318/` in your default browser. Node.js 22 or newer must be installed. Alternatively, run `npm start` in this folder.

Use your usual Chrome, Edge, or Firefox browser so platform tabs use that browser's saved logins. A preview inside another app has a different browser session.

1. Create a strong master password. There is no reset or recovery service.
2. In Accounts, open each platform and log in manually. Your browser/password manager can remember those logins. Optional passwords and private account notes can also be saved inside this encrypted vault.
3. Compose a draft and select destinations. Click **Copy & open** for one destination at a time.
4. Check the signed-in account, paste, attach media, and publish on the platform.
5. Return to History and **Mark posted**. Add a published post link if useful.

## What is saved

Accounts, optional passwords and notes, drafts and media, and manually confirmed posting history are encrypted together in `data/vault.json`. The filesystem stores ciphertext; the master password and derived key are never sent to the local server. No plaintext database, browser localStorage, or browser-session export is used.

Draft text autosaves after a short pause. Attachments support PNG, JPEG, WebP, GIF, MP4, and WebM: 10 MB per file, 25 MB total across saved drafts. Larger videos should remain outside the vault and be attached directly on the platform. Media downloads are ordinary unencrypted files. Clipboard text/passwords may remain in clipboard history.

Saved history captures the draft at handoff and your later confirmation. It cannot verify that a platform accepted a post, capture changes made there, or determine which account was actually signed in. In the browser version, multiple shortcuts for the same platform use the current browser login; switch accounts or browser profiles yourself. Desktop shortcuts have separate sessions.

## Backups and recovery

Use **Vault & settings → Export encrypted backup** regularly and copy the `.socialvault` file somewhere safe. Backups include everything in the vault and use the master password current at export. Changing the master password does not update older backup files. Restore decrypts and validates a backup before replacing the current vault. Export the current workspace before restoring another backup.

The app locks after 10 minutes of inactivity in its own tab, or immediately with **Lock workspace**. Locking clears the app UI and releases its references to plaintext and keys; JavaScript cannot guarantee immediate physical memory erasure. It does not lock other tabs, sign out of social sites, or clear the clipboard. On a save conflict/disk failure, the lock flow attempts an encrypted recovery download before clearing unsaved work.

## Security scope

- Web Crypto AES-256-GCM, fresh 96-bit IV per save, authenticated format label.
- PBKDF2-HMAC-SHA256, 600,000 iterations, random 256-bit salt; derived keys are non-exportable.
- All sensitive workspace data is encrypted; format/version, salt, IV, ciphertext length, and file timestamps remain observable.
- Server binds only to IPv4 loopback. It validates Host, Origin, Fetch Metadata and a random process-lifetime request token; it does not allow CORS. No API returns plaintext vault contents.
- Strict content security policy, no remote scripts/fonts/analytics, no framing, and no caching.
- Atomic ciphertext replacement and revision checks prevent ordinary partial writes and silent overwrites by stale tabs.
- Old backups/filesystem snapshots may retain deleted records. Encrypt your disk and protect your OS login.
- The app is not independently audited and is not a substitute for a mature password manager. Malware, an unlocked workstation, privileged browser extensions, weak master passwords, or modified local app files can compromise it. Prefer your established browser/password manager for primary credentials.

## Development

The browser version needs no third-party runtime dependencies. The desktop version requires the Electron runtime. Run `npm test` for encryption, tamper/wrong-password rejection, loopback request protection, persistence, write conflicts, desktop URL restrictions, account isolation and desktop command sender checks.

The data directory is excluded from version control. Never commit `data/`, backup files, or real secrets. Optional environment variables: `SOCIAL_DESK_PORT`, `SOCIAL_DESK_DATA_DIR`. The included launcher uses the default port.

The browser dashboard opens normal platform tabs. The desktop dashboard opens isolated platform views and offers a user-triggered paste action. Neither version clicks Publish, reads platform page contents to track posts, or automates authentication. Continue following each platform's rules.
