// Site languages. English is served unprefixed (/about/), Hindi under /hi/
// (/hi/about/); the same page files serve both (src/pages/[...lang]/). Keep in
// step with `i18n` in astro.config.mjs.
export const LOCALES = ['en', 'hi'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Value of the `[...lang]` route param for a locale: none for English. */
export const LANG_PARAMS = new Set<string | undefined>([undefined, ...LOCALES.filter((l) => l !== DEFAULT_LOCALE)]);

export function toLocale(value: string | undefined): Locale {
  return (LOCALES as readonly string[]).includes(value ?? '') ? (value as Locale) : DEFAULT_LOCALE;
}

/** The locale a path belongs to, from its first segment. */
export function localeOfPath(pathname: string): Locale {
  return toLocale(pathname.split('/')[1]);
}

/** A path without its locale prefix: `/hi/about/` -> `/about/`. */
export function stripLocale(pathname: string): string {
  const locale = localeOfPath(pathname);
  if (locale === DEFAULT_LOCALE) return pathname;
  return pathname.slice(locale.length + 1) || '/';
}

/**
 * A site path in the given locale: `/about/` -> `/hi/about/`. Leaves anything
 * that isn't a page (external links, anchors, files, the API and admin) as is.
 */
export function localePath(href: string, locale: Locale): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  if (/^\/(_emdash|_astro|api|images|videos|audio|documents)(\/|$)/.test(href)) return href;
  if (/\.[a-z0-9]+(?:[?#].*)?$/i.test(href)) return href;
  const path = stripLocale(href);
  return locale === DEFAULT_LOCALE ? path : `/${locale}${path === '/' ? '/' : path}`;
}

/** The same page in the other language, for the language switcher. */
export function alternateLocale(locale: Locale): Locale {
  return locale === 'hi' ? 'en' : 'hi';
}
