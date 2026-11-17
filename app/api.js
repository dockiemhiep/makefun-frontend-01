const ORIGIN = 'https://make.fun/api';
const cache = new Map();
const pending = new Map();
const CACHE_KEY = 'makefun-fieldwork-v1';
const FRESH_MS = 30000;
try {
  for (const [key, value] of JSON.parse(sessionStorage.getItem(CACHE_KEY) || '[]')) {
    if (value && Date.now() - value.checked < 3600000) cache.set(key, value);
  }
} catch { /* Storage is optional, including in private browsing. */ }

function save(key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > 24) cache.delete(cache.keys().next().value);
  try {
    const small = [...cache].filter(([, item]) => JSON.stringify(item).length < 300000);
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(small.slice(-16)));
  } catch { /* Memory caching still works when storage is full. */ }
}

export async function get(path, { force = false } = {}) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid public API path');
  const saved = cache.get(path);
  if (!force && saved && Date.now() - saved.checked < FRESH_MS) return saved.data;
  if (pending.has(path)) return pending.get(path);
  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
      const headers = { Accept: 'application/json' };
      if (saved?.etag) headers['If-None-Match'] = saved.etag;
      const response = await fetch(ORIGIN + path, { method: 'GET', credentials: 'omit', headers, signal: controller.signal });
      if (response.status === 304 && saved) {
        save(path, { ...saved, checked: Date.now() });
        globalThis.dispatchEvent?.(new CustomEvent('api-state', { detail: 'online' }));
        return saved.data;
      }
      if (!response.ok) {
        const error = new Error(response.status === 404 ? 'This page could not be found.' : `make.fun answered ${response.status}. Please try again.`);
        error.status = response.status;
        throw error;
      }
      const data = await response.json();
      save(path, { data, checked: Date.now(), etag: response.headers.get('ETag') });
      globalThis.dispatchEvent?.(new CustomEvent('api-state', { detail: 'online' }));
      return data;
    } catch (error) {
      if (saved && !error.status) {
        globalThis.dispatchEvent?.(new CustomEvent('api-state', { detail: 'saved' }));
        return saved.data;
      }
      if (error.name === 'AbortError') throw new Error('The request took too long. Please try again.');
      throw error;
    } finally {
      clearTimeout(timeout);
      pending.delete(path);
    }
  })();
  pending.set(path, request);
  return request;
}

export function apiPath(path, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') query.set(key, value);
  return path + (query.size ? `?${query}` : '');
}

export function nextCursor(data) {
  return data.next_cursor ?? data.pagination?.next_cursor ?? null;
}

export function items(data) {
  return Array.isArray(data) ? data : data.items ?? data.rows ?? data.entries ?? [];
}
