// Audits inline editing on the rendered site: every text, link and image a
// component marks as editable must resolve, through the page's cmsScope(), to
// a value stored in an EmDash entry, and editable text must be shown exactly
// as stored (otherwise the editor refuses it and points to the admin).
//
// Needs a running dev server with the dev admin bypass:
//   node migration/check-inline-paths.mjs [http://localhost:4321]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "parse5";
import { decodeScoped, getPath, parsePath } from "../src/lib/content/edit.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specs = JSON.parse(readFileSync(join(root, "src/content/specs.json"), "utf8"));
const base = process.argv[2] ?? "http://localhost:4321";

const login = await fetch(`${base}/_emdash/api/setup/dev-bypass`, { redirect: "manual" });
const session = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const headers = { cookie: `${session}; emdash-edit-mode=true`, "X-EmDash-Request": "1" };
const get = async (path) => {
	const res = await fetch(`${base}${path}`, { headers });
	if (!res.ok) throw new Error(`${path}: ${res.status}`);
	return res;
};

const slugs = async (collection) => (await (await get(`/_emdash/api/content/${collection}?limit=100`)).json()).data.items.map((i) => i.slug);
const urls = [
	"/", "/about/", "/career/", "/champalal-group/", "/contact/", "/export/", "/gallery/", "/industrial-salt/",
	"/network/", "/privacy-policy/", "/quality-certificates/", "/terms-of-service/", "/products/", "/blog/", "/missing-page-check/",
	...(await slugs("products")).map((s) => `/products/${s}/`),
	...(await slugs("blogs")).map((s) => `/blog/${s}/`),
];

const entries = new Map();
async function stored(entry) {
	const key = `${entry.collection}/${entry.id}`;
	if (!entries.has(key)) {
		const { item } = (await (await get(`/_emdash/api/content/${entry.collection}/${entry.id}`)).json()).data;
		const scope = entry.kind === "page" ? { kind: "page", spec: specs.pages[entry.name] } : { kind: "entry", spec: specs.collections[entry.collection], slug: item.slug };
		entries.set(key, decodeScoped(scope, item.data));
	}
	return entries.get(key);
}

// Same resolution as src/ui/lib/inlineEditor.ts.
function resolve(scopeStack, path) {
	for (let i = scopeStack.length - 1; i >= 0; i--) {
		const scopes = scopeStack[i];
		for (const scope of scopes) {
			if (scope.kind !== "list" || !path.startsWith(`${scope.prefix}[`)) continue;
			const m = path.slice(scope.prefix.length).match(/^\[(\d+)\]\.?(.*)$/);
			const entry = m ? scope.items[Number(m[1])] : undefined;
			if (m && entry) return { entry, path: parsePath(m[2]) };
		}
		const own = scopes.find((s) => s.kind !== "list");
		if (own) return { entry: own, path: parsePath(path) };
	}
	return null;
}

const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value;
const text = (node) => (node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join(""));
const norm = (s) => s.replace(/\s+/g, " ").trim();
const MARKERS = ["data-cms-field", "data-cms-link", "data-cms-image"];
const hasMarkedChild = (node) => (node.childNodes ?? []).some((c) => MARKERS.some((m) => attr(c, m) !== undefined) || hasMarkedChild(c));

const problems = new Map();
const note = (kind, url, path, detail = "") => {
	const key = `${kind}  ${path}${detail ? `  (${detail})` : ""}`;
	(problems.get(key) ?? problems.set(key, new Set()).get(key)).add(url);
};
let checked = 0;

for (const url of urls) {
	const res = await fetch(`${base}${url}`, { headers });
	const html = await res.text();
	if (!html.includes('data-edit-mode="true"')) note("no edit toolbar", url, "-");
	const found = [];
	(function walk(node, stack) {
		const scope = attr(node, "data-cms-scope");
		const next = scope ? [...stack, JSON.parse(scope)] : stack;
		for (const marker of MARKERS) {
			const path = attr(node, marker);
			if (path !== undefined) found.push({ node, marker, path, stack: next });
		}
		for (const child of node.childNodes ?? []) walk(child, next);
		if (node.content) walk(node.content, next);
	})(parse(html), []);

	for (const { node, marker, path, stack } of found) {
		checked++;
		const target = resolve(stack, path);
		if (!target) { note("no scope", url, path); continue; }
		const value = getPath(await stored(target.entry), target.path);
		if (value === undefined) { note("not stored", url, path, `${target.entry.collection}/${target.entry.name ?? target.entry.slug}`); continue; }
		// Inputs show their stored text as the placeholder.
		const shown = ["input", "textarea"].includes(node.nodeName) ? attr(node, "placeholder") ?? "" : text(node);
		if (marker === "data-cms-field" && !hasMarkedChild(node) && (typeof value === "object" || norm(String(value)) !== norm(shown))) {
			note("shown differently", url, path, `stored ${JSON.stringify(typeof value === "object" ? "[object]" : String(value).slice(0, 40))}, shown ${JSON.stringify(norm(shown).slice(0, 40))}`);
		}
		if (marker === "data-cms-image" && typeof value !== "string") note("image not a URL", url, path);
	}
}

console.log(`pages: ${urls.length}, marked values: ${checked}, problems: ${problems.size}`);
for (const [key, where] of [...problems].sort()) console.log(`${key}\n    on ${[...where].slice(0, 3).join(", ")}${where.size > 3 ? ` +${where.size - 3}` : ""}`);
process.exit(problems.size ? 1 : 0);
