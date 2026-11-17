export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
export const encoded = value => encodeURIComponent(String(value ?? ''));
export const number = value => value === null || value === undefined ? '—' : new Intl.NumberFormat('en-US').format(Number(value));
export function dollars(value, cents = false) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents || Number(value) % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(Number(value));
}
export const pot = bounty => Number(bounty.potUsd ?? bounty.rewardAmount ?? 0);
export const opening = bounty => Date.parse(bounty.opensAt ?? bounty.opens_at ?? '');
export const deadline = bounty => Date.parse(bounty.deadline ?? '');
export function lifecycle(bounty, now = Date.now()) {
  if (['cancelled', 'canceled'].includes(bounty.status)) return 'cancelled';
  if (['closed', 'completed', 'resolved', 'finalized', 'finished'].includes(bounty.status)) return 'finished';
  if (Number.isFinite(deadline(bounty)) && now >= deadline(bounty)) return 'judging';
  if (Number.isFinite(opening(bounty)) && now < opening(bounty)) return 'upcoming';
  return bounty.status === 'open' ? 'open' : bounty.status === 'draft' ? 'upcoming' : 'judging';
}
export const stateLabel = state => ({ open: 'Open now', upcoming: 'Upcoming', judging: 'Entries closed', finished: 'Finished', cancelled: 'Cancelled' }[state] ?? state);
export function badge(bounty) {
  const state = lifecycle(bounty);
  return `<span class="badge ${state}">${state === 'open' ? '<i></i>' : ''}${stateLabel(state)}</span>`;
}
export function date(value, includeTime = true) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not announced';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) }).format(new Date(value)) + (includeTime ? ' UTC' : '');
}
export function remaining(target, now = Date.now()) {
  if (!Number.isFinite(target)) return 'Deadline not announced';
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  if (!seconds) return 'Entries closed';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  if (days) return `${days}d ${hours}h left`;
  if (hours) return `${hours}h ${minutes}m left`;
  return `${minutes}m ${seconds % 60}s left`;
}
export function countdown(bounty) {
  const state = lifecycle(bounty);
  const target = state === 'upcoming' ? opening(bounty) : deadline(bounty);
  const text = state === 'upcoming' ? `Opens in ${remaining(target).replace(' left', '')}` : state === 'open' ? remaining(target) : stateLabel(state);
  const timestamp = Number.isFinite(target) ? new Date(target).toISOString() : '';
  return `<span class="countdown ${state === 'open' && target - Date.now() < 86400000 ? 'urgent' : ''}" ${['open', 'upcoming'].includes(state) && timestamp ? `data-until="${target}" data-kind="${state}"` : ''} title="${escapeHTML(date(timestamp))}">${escapeHTML(text)}</span>`;
}
export const bountyURL = slug => `#/bounty/${encoded(slug)}`;
export const profileURL = handle => `#/u/${encoded(handle)}`;
export const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
export function title(text) { document.title = `${text} — make.fun`; }
export function empty(heading, description = '', action = '') {
  return `<div class="empty"><span class="empty-symbol" aria-hidden="true">✳</span><h2>${escapeHTML(heading)}</h2>${description ? `<p>${escapeHTML(description)}</p>` : ''}${action}</div>`;
}
export function paging(page, count, size, hasMore = false) {
  const pages = Math.max(1, Math.ceil(count / size));
  return `<div class="pagination"><span>${count ? `${number((page - 1) * size + 1)}–${number(Math.min(page * size, count))} of ${number(count)}${hasMore ? '+' : ''}` : '0 results'}</span><div><button type="button" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${page}</span><button type="button" data-page="${page + 1}" ${page >= pages && !hasMore ? 'disabled' : ''}>Next ${arrow}</button></div></div>`;
}
export function safeURL(value) {
  try { const parsed = new URL(value, 'https://make.fun'); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : ''; } catch { return ''; }
}
export function avatar(person, size = 36) {
  const name = person.displayName || person.display_name || person.name || person.handle || person.username || '?';
  const url = safeURL(person.avatar?.url_small ?? person.avatar?.url ?? person.image ?? person.avatarUrl ?? person.avatar_url ?? '');
  return `<span class="avatar" style="--avatar-size:${size}px">${url && url !== 'https://make.fun/' ? `<img crossorigin="anonymous" src="${escapeHTML(url)}" alt="" width="${size}" height="${size}" loading="lazy">` : escapeHTML(name.slice(0, 2).toUpperCase())}</span>`;
}
export function inline(text) {
  return escapeHTML(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (_, label, url) => `<a href="${escapeHTML(safeURL(url.replaceAll('&amp;', '&')))}" target="_blank" rel="noopener">${label}</a>`);
}
export function markdown(source = '') {
  const lines = String(source).replace(/\r/g, '').split('\n');
  let output = '', list = '', code = null, paragraph = [];
  const flush = () => { if (paragraph.length) { output += `<p>${inline(paragraph.join(' '))}</p>`; paragraph = []; } if (list) { output += `</${list}>`; list = ''; } };
  for (const line of lines) {
    if (/^\s*```/.test(line)) { flush(); if (code !== null) { output += `<pre><code>${escapeHTML(code.join('\n'))}</code></pre>`; code = null; } else code = []; continue; }
    if (code !== null) { code.push(line); continue; }
    if (!line.trim()) { flush(); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { flush(); const level = Math.min(4, heading[1].length + 1); output += `<h${level}>${inline(heading[2])}</h${level}>`; continue; }
    const bullet = /^\s*(?:([-*])|\d+[.)])\s+(.+)$/.exec(line);
    if (bullet) { if (paragraph.length) { output += `<p>${inline(paragraph.join(' '))}</p>`; paragraph = []; } const type = bullet[1] ? 'ul' : 'ol'; if (list !== type) { if (list) output += `</${list}>`; output += `<${type}>`; list = type; } output += `<li>${inline(bullet[2])}</li>`; continue; }
    if (list) { output += `</${list}>`; list = ''; }
    paragraph.push(line);
  }
  flush();
  if (code !== null) output += `<pre><code>${escapeHTML(code.join('\n'))}</code></pre>`;
  return output;
}
