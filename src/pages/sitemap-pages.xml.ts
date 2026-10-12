import type { APIRoute } from 'astro';

// The site's core static pages — every top-level route under src/pages/
// that isn't a products/[slug] or blog/[slug] detail page (those get their
// own sitemap-products.xml / sitemap-blog.xml). Add new ones here when a
// new top-level page is added, same as sitePages.ts in ankur-admin.
const PAGES = [
  '/',
  '/about/',
  '/products/',
  '/industrial-salt/',
  '/export/',
  '/quality-certificates/',
  '/network/',
  '/contact/',
  '/career/',
  '/champalal-group/',
  '/gallery/',
  '/blog/',
  '/privacy-policy/',
  '/terms-of-service/',
];

export const GET: APIRoute = ({ site }) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map((p) => `  <url><loc>${new URL(p, site)}</loc></url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
