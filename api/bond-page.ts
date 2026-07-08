// sellbonds.now — server-rendered per-bond page.
//
// GET /bond/0x… (rewritten to /api/bond-page?market=0x…) → the static /bond shell
// with bond-specific <head> meta (title, description, OG/Twitter cards, canonical,
// JSON-LD) and a server-rendered summary injected into the [data-bond] container.
// Crawlers and link unfurlers get unique, indexable content per bond; humans get
// the exact same page as before — the client script re-renders live data on load.
//
// The shell is fetched from this same deployment (only /bond/:address is rewritten
// here; bare /bond stays static), so Astro asset hashes are always current.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAddress, getAddress } from 'viem';
import { getBondLite } from './bond.js';

const SITE = 'https://sellbonds.now';

const SHELL_TTL_MS = 5 * 60_000;
let shellCache: { at: number; html: string } | null = null;

async function getShell(): Promise<string | null> {
  if (shellCache && Date.now() - shellCache.at < SHELL_TTL_MS) return shellCache.html;
  const host = process.env.VERCEL_URL?.trim() || 'sellbonds.now';
  try {
    const res = await fetch(`https://${host}/bond`);
    if (!res.ok) throw new Error(`shell fetch ${res.status}`);
    const html = await res.text();
    shellCache = { at: Date.now(), html };
    return html;
  } catch (err) {
    console.error('bond-page shell fetch failed:', err);
    return shellCache?.html ?? null;
  }
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const usd = (n: number) => {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1) + 'M';
  const cents = Math.round(v * 100) / 100;
  const d = Number.isInteger(cents) ? 0 : 2;
  return '$' + cents.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const apr = (n: number) => (Number.isFinite(n) ? `${(+n).toFixed(n % 1 === 0 ? 0 : 1)}%` : '—');

function replaceTag(html: string, pattern: RegExp, replacement: string): string {
  return pattern.test(html) ? html.replace(pattern, replacement) : html;
}

function setMeta(html: string, attr: 'property' | 'name', key: string, value: string): string {
  const re = new RegExp(`(<meta ${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" content=")[^"]*(")`);
  return replaceTag(html, re, `$1${esc(value)}$2`);
}

// Same stat block markup as the client render in bond.astro.
function stat(label: string, value: string, sub = '') {
  return `<div class="border-t border-[var(--color-line)] pt-3">
    <dt class="text-[11px] font-bold uppercase tracking-widest text-[var(--color-ink-muted)]">${label}</dt>
    <dd class="mt-1 font-mono text-lg tabular-nums text-[var(--color-ink)]">${value}${sub ? ` <span class="text-sm text-[var(--color-ink-muted)]">${sub}</span>` : ''}</dd>
  </div>`;
}

// Server-rendered from the lite (no-events) read — unfurlers need this page fast.
// The client script fetches the full detail (incl. the activity feed) and
// re-renders on load, so events are intentionally not rendered here.
function summaryHtml(b: any, title: string): string {
  const open = b.status === 'open';
  const pct = Math.max(0, Math.min(100, Math.round(b.filledPct || 0)));

  return `
    <p class="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--color-ink-muted)]">
      <span class="h-2 w-2 rounded-full ${open ? 'bg-[var(--color-accent)]' : 'border border-[var(--color-ink-muted)]'}"></span>
      ${open ? 'Open' : 'Closed'} · Base mainnet
    </p>
    <h1 class="mt-3 text-balance text-4xl font-bold tracking-tight text-[var(--color-ink)] md:text-5xl">${esc(title)}</h1>
    <p class="mt-2 font-mono text-sm text-[var(--color-ink-muted)]">${esc(b.symbol || '')}</p>
    ${b.description ? `<p class="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-soft)]">${esc(b.description)}</p>` : ''}

    <dl class="mt-10 grid grid-cols-2 gap-x-8 gap-y-5 md:grid-cols-4">
      ${stat('Interest rate', apr(b.aprPct), 'APR')}
      ${stat('Raised', usd(b.raisedUsdc), `/ ${usd(b.capacityUsdc)} cap`)}
      ${stat('In market', usd(b.inMarketUsdc))}
      ${stat('Drawn down', usd(b.drawnDownUsdc))}
      ${stat('Available to lend', usd(Math.max(0, b.capacityUsdc - b.raisedUsdc)))}
      ${stat('Borrowable now', usd(b.borrowableUsdc))}
      ${stat('Reserve', apr(b.reservePct))}
      ${stat('Penalty APR', apr(b.penaltyAprPct))}
    </dl>

    <div class="mt-5 h-1 w-full bg-[var(--color-line)]"><div class="h-full bg-[var(--color-accent)]" style="width:${pct}%"></div></div>
    <p class="mt-2 font-mono text-xs text-[var(--color-ink-muted)]">${pct}% of cap raised</p>

    <div class="mt-10 grid grid-cols-1 gap-4 border-t border-[var(--color-ink)] pt-6 md:grid-cols-2">
      <div>
        <p class="text-[11px] font-bold uppercase tracking-widest text-[var(--color-ink-muted)]">Contract</p>
        <a href="${esc(b.explorerUrl)}" target="_blank" rel="noopener" class="mt-1 inline-flex items-center gap-1 break-all font-mono text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline">${esc(b.market)} ↗</a>
      </div>
      <div>
        <p class="text-[11px] font-bold uppercase tracking-widest text-[var(--color-ink-muted)]">Issuer</p>
        <a href="${esc(b.issuerExplorerUrl)}" target="_blank" rel="noopener" class="mt-1 inline-flex items-center gap-1 break-all font-mono text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:underline">${esc(b.issuer)} ↗</a>
      </div>
    </div>`;
}

function jsonLd(b: any, title: string, url: string): string {
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'FinancialProduct',
      name: title,
      description:
        b.description ||
        `An on-chain bond issued on sellbonds.now — ${apr(b.aprPct)} APR, settled in USDC on Base.`,
      url,
      annualPercentageRate: b.aprPct,
      amount: { '@type': 'MonetaryAmount', currency: 'USD', value: b.raisedUsdc },
      provider: {
        '@type': 'Organization',
        name: 'sellbonds.now',
        url: SITE,
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Bonds', item: `${SITE}/#bonds-live` },
        { '@type': 'ListItem', position: 2, name: title, item: url },
      ],
    },
  ];
  // Escape < so bond names/descriptions can never break out of the script tag.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function inject(shell: string, b: any): string {
  const title = b.label || b.name || b.symbol || 'Untitled bond';
  const url = `${SITE}/bond/${String(b.market).toLowerCase()}`;
  const desc = [
    `${title} — a ${apr(b.aprPct)} APR on-chain bond on sellbonds.now.`,
    `${usd(b.raisedUsdc)} raised of ${usd(b.capacityUsdc)} cap, ${b.status}.`,
    b.description || '',
  ]
    .join(' ')
    .trim()
    .slice(0, 300);
  const ogImage = `${SITE}/og/bond/${String(b.market).toLowerCase()}.png`;
  const ogAlt = `${title} — ${apr(b.aprPct)} APR bond on sellbonds.now`;
  const fullTitle = `${title} — ${apr(b.aprPct)} APR bond — sellbonds.now`;

  let html = shell;
  html = replaceTag(html, /<title>[^<]*<\/title>/, `<title>${esc(fullTitle)}</title>`);
  html = replaceTag(html, /(<meta name="description" content=")[^"]*(")/, `$1${esc(desc)}$2`);
  html = replaceTag(html, /(<link rel="canonical" href=")[^"]*(")/, `$1${esc(url)}$2`);
  html = setMeta(html, 'property', 'og:title', fullTitle);
  html = setMeta(html, 'property', 'og:description', desc);
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'property', 'og:image', ogImage);
  html = setMeta(html, 'property', 'og:image:alt', ogAlt);
  html = setMeta(html, 'name', 'twitter:title', fullTitle);
  html = setMeta(html, 'name', 'twitter:description', desc);
  html = setMeta(html, 'name', 'twitter:image', ogImage);
  html = setMeta(html, 'name', 'twitter:image:alt', ogAlt);
  html = html.replace('</head>', `${jsonLd(b, title, url)}</head>`);

  // Server-rendered summary into the (empty) [data-bond] container; fall back to
  // inserting after the opening tag if the shell still carries skeleton children.
  const emptyContainer = /(<div data-bond[^>]*>)(<\/div>)/;
  if (emptyContainer.test(html)) {
    html = html.replace(emptyContainer, `$1${summaryHtml(b, title)}$2`);
  } else {
    html = html.replace(/(<div data-bond[^>]*>)/, `$1${summaryHtml(b, title)}`);
  }
  return html;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).send('GET only');

  const raw = Array.isArray(req.query.market) ? req.query.market[0] : req.query.market;
  if (!raw || !isAddress(raw)) {
    res.setHeader('Location', '/#bonds-live');
    return res.status(302).end();
  }
  const market = getAddress(raw);

  const shell = await getShell();
  try {
    const bond = await getBondLite(market);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!bond) {
      // Serve the shell (its client script shows the not-found state) but as a 404
      // so crawlers don't index dead bond URLs.
      res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
      if (!shell) return res.status(404).send('No sellbonds bond at that address.');
      return res.status(404).send(shell.replace('</head>', '<meta name="robots" content="noindex"></head>'));
    }
    if (!shell) {
      // Shell unavailable (should be rare): fall back to the query-param page.
      res.setHeader('Location', `/bond?market=${market}`);
      return res.status(302).end();
    }
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).send(inject(shell, bond));
  } catch (err) {
    console.error('bond-page error:', err);
    if (shell) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(shell); // client script still renders live data
    }
    res.setHeader('Location', `/bond?market=${market}`);
    return res.status(302).end();
  }
}
