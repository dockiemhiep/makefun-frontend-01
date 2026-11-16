// Surface 2 (loaded on demand via import()): Bounty page with live-pot rewards table, dates, description & rules.

import { avatarHtml, bountyState, countdownInfo, dateUtc, esc, intFmt, money, potDetails } from './format.js';

function formatInlineMd(rawText) {
  let out = esc(rawText);
  out = out.replace(/`([^`]+)`/g, '<code translate="no">$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g, (_, label, url) => {
    const href = url.startsWith('/') ? `https://make.fun${url}` : url;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return out;
}

/** Lightweight safe Markdown block renderer (escaped first, zero raw HTML injection). */
export function renderMarkdownBlocks(markdown) {
  if (!markdown) return '<p class="muted-cell">No content provided.</p>';
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let inCode = false;
  let codeLines = [];
  let listItems = [];
  let paraLines = [];

  const flushPara = () => {
    if (paraLines.length) {
      html.push(`<p>${formatInlineMd(paraLines.join(' '))}</p>`);
      paraLines = [];
    }
  };
  const flushList = () => {
    if (listItems.length) {
      html.push(`<ul>${listItems.map((li) => `<li>${formatInlineMd(li)}</li>`).join('')}</ul>`);
      listItems = [];
    }
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      flushPara();
      flushList();
      if (inCode) {
        html.push(`<pre translate="no"><code>${esc(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      flushList();
      continue;
    }
    const hMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (hMatch) {
      flushPara();
      flushList();
      const level = Math.min(4, hMatch[1].length + 1);
      html.push(`<h${level}>${formatInlineMd(hMatch[2])}</h${level}>`);
      continue;
    }
    const liMatch = trimmed.match(/^[-*]\s+(.*)$/) || trimmed.match(/^\d+\.\s+(.*)$/);
    if (liMatch) {
      flushPara();
      listItems.push(liMatch[1]);
      continue;
    }
    flushList();
    paraLines.push(trimmed);
  }
  if (inCode && codeLines.length) html.push(`<pre><code>${esc(codeLines.join('\n'))}</code></pre>`);
  flushPara();
  flushList();
  return html.join('\n');
}

/** Render long rules documents into scannable collapsible sections by ## heading. */
function renderRulesSections(rulesText) {
  if (!rulesText) return '<p class="muted-cell">No rules published.</p>';
  const parts = String(rulesText).split(/\n(?=##\s+)/);
  if (parts.length <= 2) {
    return `<div class="prose">${renderMarkdownBlocks(rulesText)}</div>`;
  }
  return parts
    .map((chunk, idx) => {
      const m = chunk.trimStart().match(/^##\s+([^\n]+)\n?([\s\S]*)$/);
      if (!m) return `<div class="prose">${renderMarkdownBlocks(chunk)}</div>`;
      const openAttr = idx < 2 ? ' open' : '';
      return `
        <details class="rule-section"${openAttr}>
          <summary>${esc(m[1].trim())}</summary>
          <div class="prose rule-body">${renderMarkdownBlocks(m[2])}</div>
        </details>`;
    })
    .join('');
}

function groupRewardRows(bounty) {
  const nowRows = Array.isArray(bounty?.rewardsNow) && bounty.rewardsNow.length
    ? bounty.rewardsNow.map((r) => ({
        place: Number(r.place),
        base: Number(r.baseUsd),
        feeShare: Number(r.feeShareUsd || 0),
        live: Number(r.amountUsd),
      }))
    : Object.entries(bounty?.rewards || {})
        .map(([k, v]) => ({ place: Number(k), base: Number(v), feeShare: 0, live: Number(v) }))
        .sort((a, b) => a.place - b.place);

  const groups = [];
  for (const row of nowRows) {
    const prev = groups[groups.length - 1];
    if (
      prev &&
      row.place === prev.endPlace + 1 &&
      Math.abs(row.live - prev.live) < 0.005 &&
      Math.abs(row.base - prev.base) < 0.005
    ) {
      prev.endPlace = row.place;
    } else {
      groups.push({ startPlace: row.place, endPlace: row.place, ...row });
    }
  }
  return { rawCount: nowRows.length, groups };
}

function ordinalPlace(start, end) {
  const ord = (n) => {
    const v = n % 100;
    const suf = v >= 11 && v <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
    return `${n}${suf}`;
  };
  return start === end ? ord(start) : `${ord(start)}–${ord(end)}`;
}

const HARNESS_LABELS = {
  'program/v1': 'Sandboxed program',
  'agent/v1': 'Live agent',
  'patch/v1': 'Repository patch',
};

export function renderBountySurface(container, b) {
  const nowMs = Date.now();
  const state = bountyState(b, nowMs);
  const pot = potDetails(b);
  const cd = countdownInfo(b.deadline, nowMs);
  const { rawCount, groups } = groupRewardRows(b);
  const slugEnc = encodeURIComponent(b.slug);
  const lbHref = `#/bounty/${slugEnc}/leaderboard`;
  const harnessLabel = b.harnessKind ? HARNESS_LABELS[b.harnessKind] || '' : '';

  const rewardsTableHtml = groups.length
    ? `<div class="rewards-wrap"><table class="data-table rewards-table">
        <thead>
          <tr>
            <th>Place</th>
            ${pot.grew ? '<th class="num">Base</th><th class="num">+ Fees</th>' : ''}
            <th class="num">Reward</th>
          </tr>
        </thead>
        <tbody>
          ${groups
            .map((g) => {
              const eachSuffix = g.startPlace !== g.endPlace ? ' <span class="each-tag">each</span>' : '';
              return `<tr>
                <td class="nowrap"><strong>${esc(ordinalPlace(g.startPlace, g.endPlace))}</strong>${eachSuffix}</td>
                ${
                  pot.grew
                    ? `<td class="num muted-cell">${esc(money(g.base))}</td>
                       <td class="num fee-bonus">+${esc(money(g.feeShare, true))}</td>`
                    : ''
                }
                <td class="num"><strong class="ink-emerald">${esc(money(g.live, pot.grew))}</strong></td>
              </tr>`;
            })
            .join('')}
        </tbody>
        <tfoot>
          <tr>
            <td class="nowrap"><strong>Total (${intFmt(rawCount)})</strong></td>
            ${pot.grew ? `<td class="num">${esc(money(pot.baseUsd))}</td><td class="num fee-bonus">+${esc(money(pot.feesUsd, true))}</td>` : ''}
            <td class="num"><strong class="ink-emerald">${esc(pot.liveText)}</strong></td>
          </tr>
        </tfoot>
      </table></div>`
    : '<p class="muted-cell">Reward schedule unavailable.</p>';

  const phasesHtml = Array.isArray(b.phases) && b.phases.length
    ? `<div class="phases-list">
        ${b.phases
          .map(
            (p) => `
          <div class="phase-item">
            <div class="phase-head">
              <strong>${esc(p.title || p.key)}</strong>
            </div>
            ${p.startsAt || p.starts_at || p.endsAt || p.ends_at ? `<div class="phase-dates">${esc(dateUtc(p.startsAt || p.starts_at))} → ${esc(dateUtc(p.endsAt || p.ends_at))}</div>` : ''}
            ${p.description ? `<p class="phase-desc">${esc(p.description)}</p>` : ''}
          </div>`,
          )
          .join('')}
      </div>`
    : '';

  const winnerBanner = b.winner?.handle
    ? `<div class="callout callout-winner">
        <div class="winner-row">
          ${avatarHtml(b.winner.image, b.winner.handle, 32)}
          <div>
            <strong>Winner: <a href="#/u/${encodeURIComponent(b.winner.handle)}" translate="no">@${esc(b.winner.handle)}</a></strong>
            ${b.winner.title ? `<span class="sep">·</span><span>${esc(b.winner.title)}</span>` : ''}
            ${b.winner.amountUsd ? `<span class="sep">·</span><strong class="ink-emerald">${esc(money(b.winner.amountUsd, true))} USDC</strong>` : ''}
          </div>
        </div>
      </div>`
    : '';

  const rulesNoteBanner = b.rulesNote?.text
    ? `<div class="callout callout-note"><strong>Note:</strong> ${esc(b.rulesNote.text)}</div>`
    : '';

  container.innerHTML = `
    <article class="bounty-surface">
      <nav class="subnav" aria-label="Bounty navigation">
        <a class="back-link" href="#/">← Board</a>
        <div class="surface-tabs">
          <a class="surface-tab is-active" href="#/bounty/${slugEnc}" aria-current="page">Overview &amp; Rules</a>
          <a class="surface-tab" href="${lbHref}">Leaderboard <span class="tab-count">${intFmt(b.submissionCount)}</span></a>
        </div>
      </nav>

      <header class="bounty-hero">
        <div class="bounty-badges">
          <span class="pill pill-${state.key}">${esc(state.label)}</span>
          ${b.category ? `<span class="cat-tag">${esc(b.category)}</span>` : ''}
          ${harnessLabel ? `<span class="tag-subtle">${esc(harnessLabel)}</span>` : ''}
          ${b.escrowLock || b.escrowLifecycle ? `<span class="tag-subtle">USDC Escrowed on Solana</span>` : ''}
        </div>
        <h1>${esc(b.title)}</h1>
        ${b.summary ? `<p class="lead">${esc(b.summary)}</p>` : ''}

        <dl class="facts-strip">
          <div class="fact-cell">
            <dt>Live Pot</dt>
            <dd>
              <strong class="fact-hero ink-emerald">${esc(pot.liveText)}</strong>
              ${pot.grew ? `<span class="fact-sub">${esc(money(pot.baseUsd))} + ${esc(money(pot.feesUsd, true))} (${intFmt(pot.payers)} fees)</span>` : '<span class="fact-sub">USDC on Solana</span>'}
            </dd>
          </div>
          <div class="fact-cell">
            <dt>Entry Fee</dt>
            <dd>
              <strong class="fact-big ${pot.feeUnitUsd > 0 ? 'ink-amber' : ''}">${pot.feeUnitUsd > 0 ? esc(money(pot.feeUnitUsd, true)) : 'Free'}</strong>
              <span class="fact-sub">${pot.feeUnitUsd > 0 ? 'Once per account, joins pot' : 'No entry fee'}</span>
            </dd>
          </div>
          <div class="fact-cell">
            <dt>${state.takingEntries ? 'Time Left' : state.key === 'upcoming' ? 'Opens' : 'Deadline'}</dt>
            <dd>
              <strong class="fact-big ${state.takingEntries && cd.urgent ? 'ink-amber' : ''}" ${state.takingEntries ? `data-deadline="${esc(b.deadline)}" data-countdown-active="1"` : ''}>${esc(state.takingEntries ? cd.text : state.label)}</strong>
              <span class="fact-sub">${esc(dateUtc(state.key === 'upcoming' && (b.opensAt || b.opens_at) ? (b.opensAt || b.opens_at) : b.deadline))}</span>
            </dd>
          </div>
          <div class="fact-cell">
            <dt>Opened</dt>
            <dd>
              <strong class="fact-big">${esc(dateUtc(b.opensAt || b.publishedAt))}</strong>
              <span class="fact-sub">${b.resolvedAt ? `Resolved ${esc(dateUtc(b.resolvedAt))}` : b.placementsHeld ? 'Final places held till end' : 'Live standings'}</span>
            </dd>
          </div>
          <div class="fact-cell">
            <dt>Entries</dt>
            <dd>
              <strong class="fact-big">${intFmt(b.submissionCount)}</strong>
              <a class="fact-link" href="${lbHref}">View leaderboard →</a>
            </dd>
          </div>
        </dl>
      </header>

      ${winnerBanner}
      ${rulesNoteBanner}

      <div class="bounty-grid">
        <div class="bounty-main">
          <section class="content-section">
            <h2>Description</h2>
            <div class="prose">${renderMarkdownBlocks(b.description)}</div>
          </section>
          <section class="content-section">
            <h2>Official Rules</h2>
            ${renderRulesSections(b.rules)}
          </section>
        </div>

        <aside class="bounty-rail" aria-label="Rewards and schedule">
          <section class="rail-box">
            <div class="rail-head">
              <h2>Rewards Table</h2>
              ${pot.grew ? '<span class="pill pill-fee">Live + Fees</span>' : ''}
            </div>
            ${rewardsTableHtml}
          </section>
          ${
            phasesHtml
              ? `<section class="rail-box">
                  <h2>Phases</h2>
                  ${phasesHtml}
                </section>`
              : ''
          }
        </aside>
      </div>
    </article>`;
}
