import { defineMiddleware } from "astro:middleware";

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
	return next();
});
