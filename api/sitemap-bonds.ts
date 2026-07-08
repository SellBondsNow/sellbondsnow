// sellbonds.now — dynamic sitemap of per-bond pages.
//
// GET /sitemap-bonds.xml (rewritten to /api/sitemap-bonds) → sitemap.org XML with
// one <url> per issued bond, read live from the on-chain registry. Static pages
// are covered by the build-time /sitemap-index.xml (@astrojs/sitemap); both are
// referenced from robots.txt.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getIndex } from './markets.js';

const SITE = 'https://sellbonds.now';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).send('GET only');
  try {
    const index = await getIndex();
    const urls = (index.bonds as { address: string }[])
      .map(
        (b) =>
          `  <url><loc>${SITE}/bond/${b.address.toLowerCase()}</loc><changefreq>hourly</changefreq></url>`,
      )
      .join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('sitemap-bonds error:', err);
    return res.status(502).send('failed to build bond sitemap');
  }
}
