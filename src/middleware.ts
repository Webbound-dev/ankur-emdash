import { defineMiddleware } from "astro:middleware";
import { getRequestContext, runWithContext } from "emdash";
import { LANG_PARAMS } from "./lib/i18n";

// The old site was served by Cloudflare static assets, which 308-redirect
// `/about` to `/about/`; every internal link and canonical URL uses the
// trailing-slash form (ANKURSALT-61). Keep that for page routes only: the
// EmDash admin/API (`/_emdash/*`), our own `/api/*`, and anything that looks
// like a file (has an extension) are left alone.
export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname, search } = context.url;
	const isPageRoute =
		!pathname.endsWith("/") &&
		!pathname.startsWith("/_emdash") &&
		!pathname.startsWith("/_astro") &&
		!pathname.startsWith("/api/") &&
		!/\.[a-z0-9]+$/i.test(pathname) &&
		(context.request.method === "GET" || context.request.method === "HEAD");

	if (isPageRoute) {
		return context.redirect(`${pathname}/${search}`, 308);
	}
	// Pages live under src/pages/[...lang]/, so the param also matches paths
	// that aren't a language (`/foo/` would render the homepage): only none
	// (English) or a configured language prefix is a real page.
	if ("lang" in context.params && !LANG_PARAMS.has(context.params.lang)) {
		return context.rewrite("/404/");
	}
	// EmDash only records the page's language for editors and previews; give
	// it to every request, so content, collection and menu queries on a /hi/
	// page read the Hindi translations (falling back to English).
	const ctx = getRequestContext();
	if (context.currentLocale && ctx?.locale !== context.currentLocale) {
		return runWithContext({ ...ctx, editMode: ctx?.editMode ?? false, locale: context.currentLocale }, () => next());
	}
	return next();
});
