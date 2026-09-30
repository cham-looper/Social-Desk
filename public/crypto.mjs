const encoder = new TextEncoder();
const decoder = new TextDecoder();
const AAD = encoder.encode('social-desk:v1');
export const ITERATIONS = 600000;
export function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export function fromBase64(text) {
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}
export function newSalt() { return toBase64(crypto.getRandomValues(new Uint8Array(32))); }
export function validateEnvelope(value) {
  if (!value || value.version !== 1 || value.kdf !== 'PBKDF2-SHA256' || value.iterations !== ITERATIONS) throw new Error('Unsupported vault format.');
  for (const field of ['salt', 'iv', 'ciphertext']) {
    if (typeof value[field] !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value[field])) throw new Error('Invalid vault file.');
  }
  if (fromBase64(value.salt).length !== 32 || fromBase64(value.iv).length !== 12 || fromBase64(value.ciphertext).length < 16) throw new Error('Invalid vault file.');
  return value;
}
export async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: fromBase64(salt), iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function seal(data, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = encoder.encode(JSON.stringify(data));
  try {
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, bytes);
    return { version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(encrypted)) };
  } finally { bytes.fill(0); }
}
export async function unseal(envelope, key) {
  validateEnvelope(envelope);
  const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv), additionalData: AAD }, key, fromBase64(envelope.ciphertext)));
  try { return JSON.parse(decoder.decode(bytes)); } finally { bytes.fill(0); }
}
