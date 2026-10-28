import { defineMiddleware } from "astro:middleware";
import { getRequestContext, runWithContext } from "emdash";
import { LANG_PARAMS, localeOfPath } from "./lib/i18n";

// Fixes for the EmDash admin's layout, added to its pages below:
// - The wrappers around the content editor hide their overflow, but the
//   browser can still scroll them to bring a focused field into view, and
//   nothing scrolls them back: the editor toolbar (with Publish) ends up
//   hidden above the header. `clip` looks the same and can't be scrolled;
//   unlike `hidden` it lets a flex item grow to its content, hence min sizes.
// - A page-sections block's one-line summary sets the block's minimum width,
//   so a long summary widens the whole editor beyond the page (fields run
//   under the side panel); let the blocks shrink to the column instead.
const ADMIN_CSS = `<style data-ankur-admin-fixes>
.overflow-hidden:has(main), main.overflow-hidden { overflow: clip; min-height: 0; min-width: 0; }
.emdash-editor-page .grid > * { min-width: 0; }
</style>`;

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
	if (pathname.startsWith("/_emdash/admin")) {
		const response = await next();
		if (!response.headers.get("content-type")?.includes("text/html")) return response;
		const html = (await response.text()).replace("</head>", `${ADMIN_CSS}</head>`);
		const headers = new Headers(response.headers);
		headers.delete("content-length");
		return new Response(html, { status: response.status, statusText: response.statusText, headers });
	}
	// The admin and its API pick their own language.
	if (pathname.startsWith("/_emdash")) return next();
	// EmDash only records the page's language for editors and previews; give
	// it to every request, so content, collection and menu queries on a /hi/
	// page read the Hindi translations (falling back to English). A missing
	// page is rewritten to the 404 page: it takes the language of the path
	// that was asked for (/hi/... -> Hindi).
	const locale = context.routePattern === "/404" ? localeOfPath(context.originPathname) : context.currentLocale;
	const ctx = getRequestContext();
	if (locale && ctx?.locale !== locale) {
		return runWithContext({ ...ctx, editMode: ctx?.editMode ?? false, locale }, () => next());
	}
	return next();
});
