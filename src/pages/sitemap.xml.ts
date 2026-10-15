// EmDash serves its own /sitemap.xml, built from each collection's URL
// pattern, so it lists paths such as /404/ and /home/ and points at its own
// per-collection sitemaps. Search engines check /sitemap.xml by default, so
// serve the site's sitemap index here as well.
export { GET } from './sitemap-index.xml';
