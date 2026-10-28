import cloudflare from "@astrojs/cloudflare";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { d1, r2 } from "@emdash-cms/cloudflare";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";
import { emdashSmtp } from "emdash-smtp";
import { collectAllowedHosts } from "emdash-smtp-core";
import { fileURLToPath } from "node:url";
import { FORM_RECIPIENTS_PAGE } from "./src/lib/formRecipientSettings.mjs";

const smtpPlugin = emdashSmtp();

export default defineConfig({
	site: "https://ankurgroup.in",
	// EmDash needs server rendering: content is read from D1 per request.
	output: "server",
	adapter: cloudflare(),
	// English is served unprefixed (/about/), Hindi under /hi/ (/hi/about/).
	// EmDash reads this for its locales: each page, product, post and menu can
	// have a Hindi translation, and a page without one falls back to English.
	// Prefixing English too would break the admin (EmDash docs: i18n).
	i18n: {
		defaultLocale: "en",
		locales: ["en", "hi"],
		fallback: { hi: "en" },
	},
	// Workers Cache in front of the Worker: public pages are served from the
	// nearest Cloudflare location without rendering or querying D1. Pages set
	// their lifetime and tags in BaseLayout; EmDash purges the tags whenever
	// content, menus or settings change.
	cache: { provider: cacheCloudflare() },
	integrations: [
		react(),
		emdash({
			// coalesce: a page's reads go to D1 as one batch instead of one
			// round trip each (EmDash docs: Database → Read replicas).
			database: d1({ binding: "DB", session: "auto", coalesce: true }),
			storage: r2({ binding: "MEDIA" }),
			// Cached pages are the same for everyone: editors get an "Edit" pill
			// that reloads the page with ?_edit, which is always rendered fresh.
			toolbar: "client",
			plugins: [{
				...smtpPlugin,
				adminPages: [...smtpPlugin.adminPages, FORM_RECIPIENTS_PAGE],
				entrypoint: fileURLToPath(new URL("./src/plugins/smtp-cloudflare.mjs", import.meta.url)),
				allowedHosts: collectAllowedHosts("marketplace"),
			}, {
				// Translates and publishes Hindi when English content is
				// published (src/plugins/hindi-translate.mjs); the API key is
				// set in its settings in the admin.
				id: "hindi-translate",
				version: "1.0.0",
				format: "native",
				entrypoint: fileURLToPath(new URL("./src/plugins/hindi-translate.mjs", import.meta.url)),
				capabilities: ["content:write", "content:publish", "content:revisions:read", "network:request"],
				allowedHosts: ["openrouter.ai"],
				settingsSchema: {
					enabled: { type: "boolean", label: "Translate and publish Hindi when English content is published", default: true },
					openrouterApiKey: { type: "secret", label: "OpenRouter API key", description: "From openrouter.ai/keys. Stored encrypted." },
					model: { type: "string", label: "Model", description: "OpenRouter model id", default: "anthropic/claude-haiku-5.5" },
				},
			}],
		}),
	],
	vite: {
		// Dependency reinstalls must not remove files served by a running dev server.
		cacheDir: ".astro/vite",
		plugins: [tailwindcss()],
		// Pre-bundle dependencies the dev server would otherwise discover late
		// (EmDash's inline editors, the map data). A late discovery re-bundles
		// everything, and already-open pages then fail to load their islands.
		optimizeDeps: {
			include: [
				"@svg-maps/india",
				"@svg-maps/world",
				"use-sync-external-store/shim/index.js",
				"use-sync-external-store/shim/with-selector.js",
				"@emdash-cms/admin/html-block",
				"astro/virtual-modules/transitions-events.js",
				"astro/virtual-modules/transitions-router.js",
				"astro/virtual-modules/transitions-swap-functions.js",
				"astro/virtual-modules/transitions-types.js",
			],
		},
	},
	// Astro 5 (which the live site was built with) collapsed whitespace to a
	// single space and kept whitespace-only gaps between elements; Astro 7's
	// compiler drops those gaps entirely, which can change inline spacing.
	// Leaving the markup uncompressed keeps rendering identical to the old site.
	compressHTML: true,
	devToolbar: { enabled: false },
	// Pages are rendered per request (~0.7 s away for visitors served far from
	// the Worker), so start loading a link's page as soon as it is hovered or
	// focused; by the click it is usually there.
	prefetch: { prefetchAll: true, defaultStrategy: "hover" },
});
