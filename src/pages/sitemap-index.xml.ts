import type { APIRoute } from 'astro';

// Sitemap index listing the 3 category sitemaps below, per the SEO audit's
// request for a split structure instead of one flat file. robots.txt
// already points here.
export const GET: APIRoute = ({ site }) => {
  const files = ['sitemap-pages.xml', 'sitemap-products.xml', 'sitemap-blog.xml'];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${files.map((f) => `  <sitemap><loc>${new URL(f, site)}</loc></sitemap>`).join('\n')}
</sitemapindex>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
