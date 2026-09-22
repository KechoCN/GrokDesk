export const GROK_HOME = 'https://grok.com/';
export const WEB_PROFILES_FILE = 'grok-web-profiles.json';
const GROK_HOSTS = new Set(['grok.com', 'www.grok.com']);
const AUTH_HOSTS = new Set(['accounts.x.ai', 'auth.x.ai', 'accounts.google.com', 'appleid.apple.com', 'account.apple.com', 'x.com', 'www.x.com', 'api.x.com', 'twitter.com', 'api.twitter.com']);

export function safeUrl(value) {
  try { const url = new URL(value); return url.username || url.password ? null : url; } catch { return null; }
}
export function isGrokUrl(value) {
  const url = safeUrl(value); return !!url && url.protocol === 'https:' && GROK_HOSTS.has(url.hostname) && !url.port;
}
export function isAuthUrl(value) {
  const url = safeUrl(value); return !!url && url.protocol === 'https:' && AUTH_HOSTS.has(url.hostname) && !url.port;
}
export function isWebUrl(value) { return isGrokUrl(value) || isAuthUrl(value); }
export function isExternalUrl(value) {
  const url = safeUrl(value); return !!url && ['https:', 'http:', 'mailto:'].includes(url.protocol);
}
export function isGrokBlob(value) {
  return typeof value === 'string' && value.startsWith('blob:') && isGrokUrl(value.slice(5));
}
export function callbackFromAuthUrl(value) {
  const url = safeUrl(value);
  if (!isAuthUrl(value)) return null;
  const callback = safeUrl(url.searchParams.get('redirect_uri'));
  if (callback?.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(callback.hostname) || !callback.port) return null;
  return callback.origin + callback.pathname;
}
export function isAuthCallback(value, callback) {
  const url = safeUrl(value); return !!callback && !!url && url.origin + url.pathname === callback;
}
export function webBounds(input, size) {
  if (!input || typeof input !== 'object') throw new Error('Invalid web view bounds');
  for (const key of ['x', 'y', 'width', 'height']) if (!Number.isFinite(input[key])) throw new Error('Invalid web view bounds');
  const left = Math.max(0, Math.min(Math.round(input.x), size[0]));
  const top = Math.max(0, Math.min(Math.round(input.y), size[1]));
  const right = Math.max(left, Math.min(Math.round(input.x + Math.max(0, input.width)), size[0]));
  const bottom = Math.max(top, Math.min(Math.round(input.y + Math.max(0, input.height)), size[1]));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function normalizeWebProfiles(input) {
  const profiles = Array.isArray(input?.profiles) ? input.profiles.filter(item => /^[a-z0-9-]{1,60}$/.test(item?.id) && typeof item?.label === 'string').slice(0, 20).map(item => ({ id: item.id, label: item.label.trim().slice(0, 50) || 'Grok' })) : [];
  const unique = profiles.filter((item, index) => profiles.findIndex(other => other.id === item.id) === index);
  if (!unique.length) unique.push({ id: 'default', label: 'Grok 1' });
  return { profiles: unique, activeProfileId: unique.some(item => item.id === input?.activeProfileId) ? input.activeProfileId : unique[0].id };
}
