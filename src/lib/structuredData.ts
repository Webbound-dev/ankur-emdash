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

/** Shared by the sitewide Organization and the contact page's details, so
 * search engines read them as one organization. */
function organizationId(site: URL | undefined): string {
  return new URL('/#organization', site).toString();
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
    '@id': organizationId(site),
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

/** The trail from the homepage to this page — shown by search engines in
 * place of the raw URL. `path` values are site-relative (e.g. "/blog/"). */
export function buildBreadcrumbSchema(trail: { name: string; path: string }[], site: URL | undefined) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', path: '/' }, ...trail].map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: new URL(crumb.path, site).toString(),
    })),
  };
}

interface ListedItemForSchema {
  name: string;
  slug: string;
}

/** For a listing page (e.g. /products/) whose primary content is "here is our
 * full set of X" — lets search engines see the complete list, not just
 * whichever items happen to be in the crawled HTML. */
export function buildItemListSchema(items: ListedItemForSchema[], basePath: string, site: URL | undefined) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      url: new URL(`${basePath}${item.slug}/`, site).toString(),
    })),
  };
}

interface ContactInfoForSchema {
  email: string;
  /** Free text as it appears in the CMS (the office is given as a Plus Code),
   * so not split into PostalAddress's individual fields. */
  address: string;
}

/** No `telephone`: the CMS has no real phone number for the business itself,
 * and a made-up one would be incorrect structured data. */
export function buildContactPageSchema(contact: ContactInfoForSchema, site: URL | undefined) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': organizationId(site),
    name: BRAND_NAME,
    url: new URL('/', site).toString(),
    contactPoint: { '@type': 'ContactPoint', email: contact.email, contactType: 'customer service' },
    address: { '@type': 'PostalAddress', streetAddress: contact.address, addressCountry: 'IN' },
  };
}

interface FaqItemForSchema {
  question: string;
  answer: string;
}

/** FAQPage — makes a page's on-page Q&A eligible for an expandable rich
 * result directly in search. Only build this from FAQ content the page
 * actually renders (Google's own guidance): every `answer` here must be
 * user-visible text, not something invented for the schema alone. */
export function buildFaqSchema(faqs: FaqItemForSchema[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

interface ArticleForSchema {
  title: string;
  excerpt: string;
  metaDescription?: string;
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
    description: post.metaDescription ?? post.excerpt,
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
