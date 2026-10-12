// Schema.org / JSON-LD structured data — the machine-readable facts search
// engines read about a page (as opposed to meta tags, which target search
// snippets/social previews). Each builder returns a plain object; render it
// with `<script type="application/ld+json" set:html={JSON.stringify(...)} />`.

const BRAND_NAME = 'Ankur Chemfood Ltd.';
const SOCIAL_DOMAINS = /instagram\.com|facebook\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com/i;

interface FooterLink {
  label: string;
  href: string;
}

interface FooterColumn {
  title: string;
  links: FooterLink[];
}

/** Sitewide brand identity — same on every page, since every page belongs to the same company. */
export function buildOrganizationSchema(footerColumns: FooterColumn[], site: URL | undefined) {
  // Social links are pulled from the footer's own columns (matched by
  // domain) rather than hardcoded, so this stays correct if they ever
  // change in the CMS.
  const sameAs = footerColumns
    .flatMap((col) => col.links)
    .filter((link) => SOCIAL_DOMAINS.test(link.href))
    .map((link) => link.href);

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: BRAND_NAME,
    url: new URL('/', site).toString(),
    logo: new URL('/images/logo.png', site).toString(),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

interface ProductForSchema {
  name: string;
  metaDescription: string;
  image?: { src: string };
}

/** No `offers`/price — the CMS doesn't hold real pricing data, and fabricating
 * one would be incorrect structured data (penalized, not rewarded, by search engines). */
export function buildProductSchema(product: ProductForSchema, site: URL | undefined) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.metaDescription,
    image: product.image?.src ? new URL(product.image.src, site).toString() : undefined,
    brand: { '@type': 'Brand', name: BRAND_NAME },
  };
}

interface ArticleForSchema {
  title: string;
  excerpt: string;
  image?: string;
  /** Human date string, e.g. "12 June 2026" — no time component. */
  publishedAt?: string;
}

export function buildArticleSchema(post: ArticleForSchema, site: URL | undefined) {
  // Date parses "12 June 2026" as local midnight — its own
  // getFullYear/getMonth/getDate are read back directly for a plain
  // YYYY-MM-DD rather than going through toISOString(), which converts to
  // UTC and can shift the date to the previous day depending on the
  // server's timezone offset.
  const publishedDate = post.publishedAt ? new Date(post.publishedAt) : null;
  const datePublished = publishedDate && !isNaN(publishedDate.getTime())
    ? `${publishedDate.getFullYear()}-${String(publishedDate.getMonth() + 1).padStart(2, '0')}-${String(publishedDate.getDate()).padStart(2, '0')}`
    : null;

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt,
    image: post.image ? new URL(post.image, site).toString() : undefined,
    ...(datePublished ? { datePublished } : {}),
    author: { '@type': 'Organization', name: BRAND_NAME },
    publisher: {
      '@type': 'Organization',
      name: BRAND_NAME,
      logo: { '@type': 'ImageObject', url: new URL('/images/logo.png', site).toString() },
    },
  };
}
