// sellbonds.now — dynamic Open Graph card per bond.
//
// GET /og/bond/0x….png (rewritten to /api/og-bond?market=0x…) → 1200×630 PNG:
// bond name, APR, raised/cap, status, progress bar. Referenced from the
// server-rendered bond pages (api/bond-page.ts) so every bond shared on
// X/Farcaster/Discord unfurls as a branded card.
//
// Hand-built SVG (mono layout math is exact) rendered to PNG with resvg.
// Fonts are bundled from api/_fonts (JetBrains Mono, OFL) via the
// functions.includeFiles setting in vercel.json.

import { join } from 'node:path';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resvg } from '@resvg/resvg-js';
import { isAddress, getAddress } from 'viem';
import { getBondLite } from './bond.js';

const INK = '#0a0a0a';
const INK_SOFT = '#404040';
const INK_MUTED = '#737373';
const PAPER = '#ffffff';
const LINE = '#e5e5e5';
const ACCENT = '#1e3a8a';

// cwd is the repo root locally and /var/task on Vercel — both contain api/_fonts.
const FONT_FILES = [
  join(process.cwd(), 'api/_fonts/JetBrainsMono-Regular.ttf'),
  join(process.cwd(), 'api/_fonts/JetBrainsMono-Bold.ttf'),
];

const escXml = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

const usd = (n: number) => {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1) + 'M';
  const cents = Math.round(v * 100) / 100;
  const d = Number.isInteger(cents) ? 0 : 2;
  return '$' + cents.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const aprFmt = (n: number) => (Number.isFinite(n) ? `${(+n).toFixed(n % 1 === 0 ? 0 : 1)}%` : '—');

// JetBrains Mono advance width is 0.6em — line-length math is exact.
const CHAR = 0.6;
const W = 1200;
const H = 630;
const M = 72; // margin
const CONTENT_W = W - 2 * M;

function fitLines(text: string, fontSize: number, maxLines: number): { lines: string[]; fontSize: number } {
  const perLine = Math.floor(CONTENT_W / (fontSize * CHAR));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= perLine) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w.length > perLine ? w.slice(0, perLine - 1) + '…' : w;
      if (lines.length === maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length > maxLines || (lines.length === maxLines && words.join(' ').length > maxLines * perLine)) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].slice(0, perLine - 1) + '…';
    return { lines: kept, fontSize };
  }
  return { lines, fontSize };
}

function svgCard(b: any): string {
  const title = b.label || b.name || b.symbol || 'Untitled bond';
  const open = b.status === 'open';
  const pct = Math.max(0, Math.min(100, Math.round(b.filledPct || 0)));

  // Title: try 68px/2 lines, drop to 54px if it doesn't fit.
  let t = fitLines(title, 68, 2);
  if (t.lines.length > 1 || title.length > Math.floor(CONTENT_W / (68 * CHAR))) t = fitLines(title, 54, 2);
  const titleLines = t.lines.length ? t.lines : ['Untitled bond'];
  const titleSize = t.fontSize;
  const titleY = 250;
  const lineGap = Math.round(titleSize * 1.18);

  const desc = b.description
    ? fitLines(b.description, 26, 1).lines[0] ?? ''
    : `Uncollateralized on-chain bond · USDC on Base`;
  const descY = titleY + lineGap * (titleLines.length - 1) + 64;

  const statLabelY = 468;
  const statValueY = 516;
  const raisedText = `${usd(b.raisedUsdc)} / ${usd(b.capacityUsdc)}`;
  const barY = 566;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${PAPER}"/>
  <rect width="${W}" height="10" fill="${INK}"/>
  <text x="${M}" y="104" font-family="JetBrains Mono" font-weight="700" font-size="30" fill="${INK}">sellbonds.now</text>
  <g>
    <circle cx="${W - M - 232 + 8}" cy="${96}" r="8" fill="${open ? ACCENT : 'none'}" stroke="${open ? 'none' : INK_MUTED}" stroke-width="2"/>
    <text x="${W - M - 232 + 30}" y="104" font-family="JetBrains Mono" font-size="24" letter-spacing="2" fill="${INK_MUTED}">${open ? 'OPEN' : 'CLOSED'} · BASE</text>
  </g>
  <line x1="${M}" y1="140" x2="${W - M}" y2="140" stroke="${LINE}" stroke-width="2"/>
  ${titleLines
    .map(
      (ln, i) =>
        `<text x="${M}" y="${titleY + i * lineGap}" font-family="JetBrains Mono" font-weight="700" font-size="${titleSize}" fill="${INK}">${escXml(ln)}</text>`,
    )
    .join('\n  ')}
  <text x="${M}" y="${descY}" font-family="JetBrains Mono" font-size="26" fill="${INK_SOFT}">${escXml(desc)}</text>

  <text x="${M}" y="${statLabelY}" font-family="JetBrains Mono" font-size="18" letter-spacing="3" fill="${INK_MUTED}">INTEREST RATE</text>
  <text x="${M}" y="${statValueY}" font-family="JetBrains Mono" font-weight="700" font-size="44" fill="${INK}">${escXml(aprFmt(b.aprPct))} <tspan font-size="24" font-weight="400" fill="${INK_MUTED}">APR</tspan></text>

  <text x="${M + 420}" y="${statLabelY}" font-family="JetBrains Mono" font-size="18" letter-spacing="3" fill="${INK_MUTED}">RAISED / CAP</text>
  <text x="${M + 420}" y="${statValueY}" font-family="JetBrains Mono" font-weight="700" font-size="44" fill="${INK}">${escXml(raisedText)}</text>

  <text x="${W - M}" y="${statLabelY}" text-anchor="end" font-family="JetBrains Mono" font-size="18" letter-spacing="3" fill="${INK_MUTED}">FILLED</text>
  <text x="${W - M}" y="${statValueY}" text-anchor="end" font-family="JetBrains Mono" font-weight="700" font-size="44" fill="${INK}">${pct}%</text>

  <rect x="${M}" y="${barY}" width="${CONTENT_W}" height="8" fill="${LINE}"/>
  <rect x="${M}" y="${barY}" width="${Math.round((CONTENT_W * pct) / 100)}" height="8" fill="${ACCENT}"/>
</svg>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).send('GET only');
  const raw = Array.isArray(req.query.market) ? req.query.market[0] : req.query.market;
  if (!raw || !isAddress(raw)) return res.status(400).send('invalid market address');

  try {
    const bond = await getBondLite(getAddress(raw));
    if (!bond) return res.status(404).send('no sellbonds bond at that address');

    const svg = svgCard(bond);
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: W },
      font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'JetBrains Mono' },
    });
    const png = resvg.render().asPng();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
    return res.status(200).send(png);
  } catch (err) {
    console.error('og-bond error:', err);
    return res.status(502).send('failed to render bond card');
  }
}
