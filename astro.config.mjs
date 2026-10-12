import cloudflare from "@astrojs/cloudflare";
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
	integrations: [
		react(),
		emdash({
			database: d1({ binding: "DB", session: "auto" }),
			storage: r2({ binding: "MEDIA" }),
			plugins: [{
				...smtpPlugin,
				adminPages: [...smtpPlugin.adminPages, FORM_RECIPIENTS_PAGE],
				entrypoint: fileURLToPath(new URL("./src/plugins/smtp-cloudflare.mjs", import.meta.url)),
				allowedHosts: collectAllowedHosts("marketplace"),
			}],
		}),
	],
	vite: {
		// Dependency reinstalls must not remove files served by a running dev server.
		cacheDir: ".astro/vite",
		plugins: [tailwindcss()],
	},
	// Astro 5 (which the live site was built with) collapsed whitespace to a
	// single space and kept whitespace-only gaps between elements; Astro 7's
	// compiler drops those gaps entirely, which can change inline spacing.
	// Leaving the markup uncompressed keeps rendering identical to the old site.
	compressHTML: true,
	devToolbar: { enabled: false },
});
