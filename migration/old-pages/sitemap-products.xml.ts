import type { APIRoute } from 'astro';
import productsData from '../../content/collections/products.json';

// Sourced from the same products collection products/[slug].astro's
// getStaticPaths reads — a new product shows up here automatically on the
// next build, no separate list to maintain.
const products = productsData as { slug: string }[];

export const GET: APIRoute = ({ site }) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${products.map((p) => `  <url><loc>${new URL(`/products/${p.slug}/`, site)}</loc></url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
