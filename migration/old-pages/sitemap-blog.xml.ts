import type { APIRoute } from 'astro';
import postsData from '../../content/collections/blogs.json';

// Sourced from the same blogs collection blog/[slug].astro's
// getStaticPaths reads — this list grows on its own as posts are
// published, per the audit's note that this one "will keep growing".
const posts = postsData as { slug: string }[];

export const GET: APIRoute = ({ site }) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${posts.map((p) => `  <url><loc>${new URL(`/blog/${p.slug}/`, site)}</loc></url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
