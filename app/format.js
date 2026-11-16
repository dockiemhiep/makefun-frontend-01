// Formatting, deadline state, pagination, and CORP-safe avatar helpers.

const ORIGIN = 'https://make.fun';

export function resolveMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  if (rawUrl.startsWith('/')) return ORIGIN + rawUrl;
  if (rawUrl.startsWith('https://') || rawUrl.startsWith('http://')) return rawUrl;
  return '';
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function intFmt(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0';
}

export function money(value, forceCents = false) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const hasCents = forceCents || Math.abs(n - Math.round(n)) > 0.0001;
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

export function microUsd(micro) {
  if (micro === null || micro === undefined || micro === '') return '—';
  const usd = Number(micro) / 1e6;
  if (!Number.isFinite(usd)) return '—';
  return usd < 0.01 && usd > 0 ? '<$0.01' : money(usd, true);
}

export function microRate(micro) {
  const n = Number(micro);
  if (!Number.isFinite(n)) return '—';
  return `${(n / 10000).toFixed(2)}%`;
}

export function microExact(micro) {
  const n = Number(micro);
  if (!Number.isFinite(n)) return '—';
  return (n / 1e6).toFixed(6);
}

export function bytesHuman(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

export function durationHuman(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const s = Math.round(n / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return remS ? `${m}m ${remS}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function dateUtc(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })} UTC`;
}

export function shortDateUtc(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Determine whether a bounty actually takes entries by its deadline (and opensAt), NEVER status alone:
 * API status remains "open" past the deadline until final results are published.
 */
export function bountyState(bounty, nowMs = Date.now()) {
  const status = bounty?.status || 'open';
  if (status === 'resolved') {
    return { key: 'resolved', label: 'Resolved', takingEntries: false };
  }
  const deadlineMs = bounty?.deadline ? Date.parse(bounty.deadline) : NaN;
  const opensMs = bounty?.opensAt ? Date.parse(bounty.opensAt) : NaN;

  if (Number.isFinite(opensMs) && opensMs > nowMs) {
    return { key: 'upcoming', label: 'Opens soon', takingEntries: false };
  }
  if (status === 'open' && (!Number.isFinite(deadlineMs) || deadlineMs > nowMs) && bounty?.acceptingSubmissions !== false) {
    return { key: 'open', label: 'Open', takingEntries: true };
  }
  return { key: 'judging', label: 'Judging · Closed', takingEntries: false };
}

export function countdownInfo(iso, nowMs = Date.now()) {
  if (!iso) return { text: 'No deadline', urgent: false, ended: false };
  const diff = Date.parse(iso) - nowMs;
  if (!Number.isFinite(diff)) return { text: '—', urgent: false, ended: false };
  if (diff <= 0) {
    const agoMin = Math.floor(Math.abs(diff) / 60000);
    if (agoMin < 60) return { text: `Closed ${agoMin}m ago`, urgent: false, ended: true };
    const agoH = Math.floor(agoMin / 60);
    if (agoH < 48) return { text: `Closed ${agoH}h ago`, urgent: false, ended: true };
    return { text: `Closed ${Math.floor(agoH / 24)}d ago`, urgent: false, ended: true };
  }
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const urgent = diff < 6 * 3600000;
  if (days > 0) return { text: `${days}d ${hours}h left`, urgent, ended: false };
  if (hours > 0) return { text: `${hours}h ${mins}m left`, urgent, ended: false };
  if (mins > 0) return { text: `${mins}m ${secs}s left`, urgent: true, ended: false };
  return { text: `${secs}s left`, urgent: true, ended: false };
}

export function potDetails(bounty) {
  const base = Number(bounty?.rewardAmount ?? bounty?.reward_usd ?? 0);
  const live = Number(bounty?.potUsd ?? base);
  const fees = Number(bounty?.entryFeesUsd ?? Math.max(0, live - base));
  const feeUnit = bounty?.entryFeeUsd ? Number(bounty.entryFeeUsd) : 0;
  const payers = Number(bounty?.entryFeePayers ?? 0);
  const grew = fees > 0.001 || live > base + 0.001;
  return {
    liveUsd: live,
    baseUsd: base,
    feesUsd: fees,
    feeUnitUsd: feeUnit,
    payers,
    grew,
    liveText: money(live, grew && !Number.isInteger(live)),
    feeText: feeUnit > 0 ? `${money(feeUnit, true)} entry fee` : 'Free entry',
  };
}

/** Paginate large arrays (e.g. 5,000+ leaderboard rows) for fast constant-size DOM updates. */
export function paginateRows(items, page = 1, pageSize = 50) {
  const total = Array.isArray(items) ? items.length : 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (safePage - 1) * pageSize;
  const end = Math.min(total, start + pageSize);
  return {
    slice: total ? items.slice(start, end) : [],
    page: safePage,
    pageSize,
    totalPages,
    total,
    start: total ? start + 1 : 0,
    end,
  };
}

/** Render avatar with crossorigin="anonymous" strictly before src, plus clean monogram fallback. */
export function avatarHtml(rawUrl, handle, size = 28) {
  const cleanHandle = String(handle || '?').replace(/^@/, '');
  const initials = esc(cleanHandle.slice(0, 2).toUpperCase() || '?');
  const fullUrl = resolveMediaUrl(rawUrl);
  if (!fullUrl) {
    return `<span class="avatar-fallback" style="width:${size}px;height:${size}px" aria-hidden="true">${initials}</span>`;
  }
  return `<span class="avatar-wrap" style="width:${size}px;height:${size}px"><img class="avatar-img" crossorigin="anonymous" loading="lazy" width="${size}" height="${size}" alt="${esc(cleanHandle)}" data-avatar="${initials}" src="${esc(fullUrl)}"></span>`;
}
