import type { APIRoute } from 'astro';
import { getPage, lastModified } from '../lib/content';
import { lastmod } from '../lib/sitemap';

// The site's core static pages — every top-level route under src/pages/
// that isn't a products/[slug] or blog/[slug] detail page (those get their
// own sitemap-products.xml / sitemap-blog.xml). Add new ones here when a
// new top-level page is added, same as sitePages.ts in ankur-admin. Each
// route is paired with the EmDash page it renders, whose last save is its
// <lastmod>.
const PAGES: [path: string, page: string][] = [
  ['/', 'home'],
  ['/about/', 'about'],
  ['/products/', 'products'],
  ['/industrial-salt/', 'industrial-salt'],
  ['/export/', 'export'],
  ['/quality-certificates/', 'quality-certificates'],
  ['/network/', 'network'],
  ['/contact/', 'contact'],
  ['/career/', 'career'],
  ['/champalal-group/', 'champalal-group'],
  ['/gallery/', 'gallery'],
  ['/blog/', 'blog'],
  ['/privacy-policy/', 'privacy-policy'],
  ['/terms-of-service/', 'terms-of-service'],
];

export const GET: APIRoute = async ({ site }) => {
  const updated = await Promise.all(PAGES.map(([, page]) => getPage(page).then(lastModified)));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map(([p], i) => `  <url><loc>${new URL(p, site)}</loc>${lastmod(updated[i])}</url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
