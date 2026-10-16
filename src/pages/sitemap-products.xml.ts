import type { APIRoute } from 'astro';
import { getProducts, lastModified } from '../lib/content';
import { lastmod } from '../lib/sitemap';

// Sourced from the same products collection products/[slug].astro
// reads — a new product shows up here automatically on the
// next request, no separate list to maintain.

export const GET: APIRoute = async ({ site }) => {
  const products = await getProducts();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${products.map((p) => `  <url><loc>${new URL(`/products/${p.slug}/`, site)}</loc>${lastmod(lastModified(p))}</url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' } });
};
