// Schema.org / JSON-LD structured data — the machine-readable facts search
// engines read about a page (as opposed to meta tags, which target search
// snippets/social previews). Each builder returns a plain object; render it
// with `<script type="application/ld+json" set:html={toJsonLd(...)} />`.

// "Ankur Chemfood Limited" is the form the site's own About/Careers/Champalal
// Group pages consistently spell out (13x vs 4x on /about/ alone) — the
// abbreviated "Ltd." only shows up in the footer copyright and meta titles.
// Structured data should match the dominant, authoritative name; "Ltd." is
// kept as alternateName on the Organization node so both forms are captured.
const BRAND_NAME = 'Ankur Chemfood Limited';
const BRAND_ALTERNATE_NAME = 'Ankur Chemfood Ltd.';
const SOCIAL_DOMAINS = /instagram\.com|facebook\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com/i;

/** Serializes a schema object for `set:html` injection into a JSON-LD
 * `<script>` tag. `set:html` writes the string as raw, unescaped HTML, and
 * `JSON.stringify` never escapes `<` — so free-text CMS content (a product
 * description, blog excerpt, etc.) containing the literal substring
 * "</script>" would otherwise prematurely close the tag and corrupt both the
 * structured data and the surrounding page markup. Escaping `<` to `<`
 * (invisible to JSON parsers, since it's just a different encoding of the
 * same character) neutralizes that without changing the parsed data. */
export function toJsonLd(schema: unknown): string {
  return JSON.stringify(schema).replace(/</g, '\\u003c');
}

/** Shared identifier so the sitewide Organization node (every page) and the
 * contact page's extra Organization node (with contactPoint/address) are
 * recognized as the same entity rather than two distinct, conflicting ones. */
function organizationId(site: URL | undefined): string {
  return new URL('/#organization', site).toString();
}

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
    '@id': organizationId(site),
    name: BRAND_NAME,
    alternateName: BRAND_ALTERNATE_NAME,
    url: new URL('/', site).toString(),
    logo: new URL('/images/logo.png', site).toString(),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

interface ProductForSchema {
  name: string;
  metaDescription: string;
  image?: { src: string };
  heroImage?: { src: string };
}

/** No `offers`/price — the CMS doesn't hold real pricing data, and fabricating
 * one would be incorrect structured data (penalized, not rewarded, by search engines). */
export function buildProductSchema(product: ProductForSchema, site: URL | undefined) {
  // Same heroImage-first fallback as the page's own hero (ProductDetail.astro)
  // and its LCP preload ([slug].astro) — `image` is only ever a grid/thumbnail
  // shot that doesn't actually appear on the product page itself.
  const imageSrc = product.heroImage?.src ?? product.image?.src;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.metaDescription,
    image: imageSrc ? new URL(imageSrc, site).toString() : undefined,
    brand: { '@type': 'Brand', name: BRAND_NAME },
  };
}

interface ListedItemForSchema {
  name: string;
  slug: string;
}

/** For a listing page (e.g. /products/) whose primary content is "here is our
 * full set of X" — lets search engines see the complete list, not just
 * whichever items happen to be in the crawled HTML. */
export function buildItemListSchema(
  items: ListedItemForSchema[],
  basePath: string,
  site: URL | undefined
) {
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
  /** Free-text as it appears in the CMS (e.g. "349P+GWP, Ward 12B, Gandhidham,
   * Gujarat 370201") — not split into PostalAddress's individual fields, since
   * guessing at that split (the office is given as a Plus Code, not a
   * conventional street address) risks getting it wrong; schema.org allows a
   * partial PostalAddress. */
  address: string;
}

/** No `telephone` — the CMS has no real phone number for the business itself
 * (only "+91 98765 43210" placeholder text inside form field hints), and
 * fabricating one would be incorrect structured data, same reasoning as
 * `buildProductSchema` omitting `offers`. */
export function buildContactPageSchema(contact: ContactInfoForSchema, site: URL | undefined) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': organizationId(site),
    name: BRAND_NAME,
    url: new URL('/', site).toString(),
    contactPoint: {
      '@type': 'ContactPoint',
      email: contact.email,
      contactType: 'customer service',
    },
    address: {
      '@type': 'PostalAddress',
      streetAddress: contact.address,
      addressCountry: 'IN',
    },
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

interface BreadcrumbItemForSchema {
  label: string;
  href?: string;
}

/** Only rendered when a page passes `breadcrumbs` to BaseLayout. The final item (the
 * current page) has no href — same as <Breadcrumbs> rendering it as plain text — so it
 * falls back to the page's own canonical URL, since every ListItem needs a URL. */
export function buildBreadcrumbSchema(
  items: BreadcrumbItemForSchema[],
  site: URL | undefined,
  currentUrl: URL
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.label,
      item: new URL(item.href ?? currentUrl.pathname, site).toString(),
    })),
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
