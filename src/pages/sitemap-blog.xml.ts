import type { APIRoute } from 'astro';
import { getBlogs } from '../lib/content';

// Sourced from the same blogs collection blog/[slug].astro
// reads — this list grows on its own as posts are
// published, per the audit's note that this one "will keep growing".

export const GET: APIRoute = async ({ site }) => {
  const posts = await getBlogs();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${posts.map((p) => `  <url><loc>${new URL(`/blog/${p.slug}/`, site)}</loc></url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
