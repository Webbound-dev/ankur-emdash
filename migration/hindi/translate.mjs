// Hindi translation of the site content, from the English in seed/seed.json.
//
//   node migration/hindi/translate.mjs         # translate + review what's new or changed, then write the seed
//   node migration/hindi/translate.mjs --only home,about   # just these pages/entries (slugs) and/or "menus"
//   node migration/hindi/translate.mjs --seed-only         # rebuild the seed from translations.json, no API calls
//   node migration/hindi/translate.mjs --retranslate       # ignore earlier translations and do everything again
//
// Every page, product and blog post is decoded back to its original JSON
// (src/lib/content/codec.mjs), and only its visible text is sent to Claude
// (through OpenRouter), a page at a time, with style-guide.md. URLs, images, ids and structure never
// leave the script, so the Hindi entry is the English one with its text
// swapped. A second pass re-reads each page's Hindi against the English and
// fixes meaning, numbers and unnatural phrasing.
//
// Results are kept per field in translations.json next to the English they
// came from; a later run only translates fields whose English has changed.
// The Hindi entries are written to seed/seed.json as translations of the
// English ones (locale "hi"), as drafts unless --status published: review
// them in the admin, then publish. Distributors (names, addresses) stay
// English. Requires OPENROUTER_API_KEY, in the environment or in
// migration/hindi/.env (git-ignored): OPENROUTER_API_KEY=sk-or-...
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { decodeEntry, decodePage, encodeEntry, encodePage } from "../../src/lib/content/codec.mjs";

const { values: args } = parseArgs({ options: {
	only: { type: "string" },
	"seed-only": { type: "boolean", default: false },
	retranslate: { type: "boolean", default: false },
	"no-review": { type: "boolean", default: false },
	status: { type: "string", default: "draft" },
	concurrency: { type: "string", default: "4" },
	model: { type: "string" },
	// For testing the pipeline: --fake marks text "हिं:" instead of calling
	// Claude; --seed-file/--cache-file point at copies.
	fake: { type: "boolean", default: false },
	"seed-file": { type: "string" },
	"cache-file": { type: "string" },
} });

const LOCALE = "hi";
// Any OpenRouter model id; --model overrides it for one run.
const MODEL = args.model ?? "anthropic/claude-haiku-5.5";
const SKIP_COLLECTIONS = new Set(["distributors"]);
const file = (path) => new URL(path, import.meta.url);
const seedPath = args["seed-file"] ?? file("../../seed/seed.json");
const cachePath = args["cache-file"] ?? file("translations.json");
const seed = JSON.parse(readFileSync(seedPath, "utf8"));
const specs = JSON.parse(readFileSync(file("../../src/content/specs.json"), "utf8"));
const styleGuide = readFileSync(file("style-guide.md"), "utf8");
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
const only = args.only ? new Set(args.only.split(",")) : null;

// ---------------------------------------------------------------------------
// Which strings are text. Keys holding paths, media, ids and markup are left
// alone, as are id-like values ("plants", "video") under any key.

// Blog categories (which key their colours) and export countries (which the
// world map looks up by name) are fixed lists the code matches on, so they
// stay English in the content and are translated where they're shown
// (src/lib/ui-strings.ts).
const SKIP_KEY = /^(_.*|category|countries|style|listItem|marks|href|src|image|poster|logo|file|website|url|slug|id|icon|handle|variant|code|level)$|(Href|Url|Src)$/;
// Values that pick a block's type ("specTable", "faq") are ids too.
const BLOCK_TYPES = new Set();
JSON.stringify(specs, (key, value) => {
	if (value?.discriminator && value.types) for (const t of Object.keys(value.types)) BLOCK_TYPES.add(t);
	return value;
});
const isText = (key, value) =>
	!SKIP_KEY.test(key) &&
	!BLOCK_TYPES.has(value) &&
	/\p{L}{2}/u.test(value) &&
	!/^[a-z][a-zA-Z0-9]*(?:[_-][a-zA-Z0-9]+)*$/.test(value) &&
	!/^(https?:|mailto:|tel:|\/|#|@)/.test(value) &&
	!/^\S+@\S+\.\S+$/.test(value);

/**
 * A rich-text block with several spans (a sentence with a link or bold word)
 * is translated as one string, `<n>…</n>` marking span n, so the sentence can
 * be reordered naturally; the spans are rebuilt from it afterwards.
 */
const isRichBlock = (node) => node?._type === "block" && Array.isArray(node.children) && node.children.length > 1;

function richToTagged(block) {
	return block.children.map((span, i) => (span.marks?.length ? `<${i}>${span.text}</${i}>` : span.text)).join("");
}

function taggedToRich(block, tagged) {
	const children = [];
	// Unmarked runs reuse the English plain spans' keys, in order.
	const plain = block.children.filter((s) => !s.marks?.length);
	let n = 0;
	const plainSpan = (text) => {
		const key = plain[n]?._key ?? `${block._key}-hi-${n}`;
		n++;
		return { ...(plain[0] ?? block.children[0]), _key: key, marks: [], text };
	};
	const re = /<(\d+)>([\s\S]*?)<\/\1>/g;
	let at = 0;
	for (let m; (m = re.exec(tagged));) {
		if (m.index > at) children.push(plainSpan(tagged.slice(at, m.index)));
		children.push({ ...block.children[Number(m[1])], text: m[2] });
		at = m.index + m[0].length;
	}
	if (at < tagged.length) children.push(plainSpan(tagged.slice(at)));
	return { ...block, children };
}

const tagsOf = (text) => [...text.matchAll(/<(\d+)>/g)].map((m) => m[1]).sort().join(",");

/** All text in a value, as [path, text] with paths like ["hero", "slides", 0, "title"]. */
function extract(node, path = [], out = []) {
	if (isRichBlock(node)) {
		if (node.children.some((s) => isText("text", s.text ?? ""))) out.push([[...path, "#rich"], richToTagged(node)]);
		return out;
	}
	if (Array.isArray(node)) node.forEach((v, i) => extract(v, [...path, i], out));
	else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) {
		if (typeof v === "string") { if (isText(k, v)) out.push([[...path, k], v]); }
		else extract(v, [...path, k], out);
	}
	return out;
}

function applyText(root, path, text) {
	const last = path[path.length - 1];
	const parentPath = last === "#rich" ? path.slice(0, -2) : path.slice(0, -1);
	let parent = root;
	for (const k of parentPath) parent = parent[k];
	if (last === "#rich") { const k = path[path.length - 2]; parent[k] = taggedToRich(parent[k], text); }
	else parent[last] = text;
}

// Values that group items (grade tiers, job types) must read the same
// everywhere, so each is translated once as a shared term and used wherever
// it appears.
const TERM_KEYS = new Set(["tier", "type"]);
const isTerm = (path) => TERM_KEYS.has(path[path.length - 1]);
const termPath = (en) => ["term", en];

// ---------------------------------------------------------------------------
// Units of translation: one per page or entry, plus the menus and terms.

const isSource = (e) => !e.locale || e.locale === "en";
const units = [];
for (const [collection, entries] of Object.entries(seed.content)) {
	if (SKIP_COLLECTIONS.has(collection)) continue;
	for (const entry of entries.filter(isSource)) {
		const pageSpec = specs.pages[entry.slug]?.collection === collection ? specs.pages[entry.slug] : null;
		const collSpec = specs.collections[collection];
		const json = pageSpec ? decodePage(pageSpec, entry.data.sections) : decodeEntry(collSpec, entry);
		const encode = (j) => pageSpec
			? { ...entry.data, sections: encodePage(pageSpec, j) }
			: { ...entry.data, ...encodeEntry(collSpec, j, entry.data.position).data };
		// The codec is lossless; if an entry doesn't round-trip, its Hindi
		// version would silently differ from the English beyond the text.
		if (!isDeepStrictEqual(JSON.parse(JSON.stringify(encode(json))), entry.data)) {
			console.warn(`skip ${collection}/${entry.slug}: does not round-trip through the codec`);
			continue;
		}
		const strings = extract(json);
		// Pages keep their admin title outside the decoded JSON (entries map
		// it to one of their fields).
		const titleInJson = !pageSpec && "title" in encodeEntry(collSpec, json, 0).data;
		if (typeof entry.data.title === "string" && !titleInJson) strings.push([["@title"], entry.data.title]);
		units.push({ key: `${collection}/${entry.slug}`, collection, entry, json, encode, strings: strings.filter(([path]) => !isTerm(path)), terms: strings.filter(([path]) => isTerm(path)) });
	}
}

const menuSource = seed.menus.filter(isSource);
{
	const strings = [];
	const walk = (items, path) => items.forEach((item, i) => {
		if (item.label && isText("label", item.label)) strings.push([[...path, i, "label"], item.label]);
		if (item.children) walk(item.children, [...path, i, "children"]);
	});
	for (const menu of menuSource) {
		strings.push([[menu.name, "@label"], menu.label]);
		walk(menu.items, [menu.name, "items"]);
	}
	units.push({ key: "menus", strings });
}
units.push({ key: "terms", strings: [...new Set(units.flatMap((u) => (u.terms ?? []).map(([, en]) => en)))].map((en) => [termPath(en), en]) });

// ---------------------------------------------------------------------------
// Claude, through OpenRouter

if (existsSync(file(".env"))) process.loadEnvFile(file(".env"));

const ITEMS_SCHEMA = {
	type: "object",
	properties: { items: { type: "array", items: {
		type: "object",
		properties: { id: { type: "string" }, hi: { type: "string" }, note: { type: "string" } },
		required: ["id", "hi"],
		additionalProperties: false,
	} } },
	required: ["items"],
	additionalProperties: false,
};

async function ask(prompt) {
	if (args.fake) {
		const items = JSON.parse(prompt.slice(prompt.lastIndexOf("\n\n[") + 2));
		return prompt.startsWith("You are reviewing") ? [] : items.map(({ id, en }) => ({ id, hi: `हिं: ${en}` }));
	}
	const key = process.env.OPENROUTER_API_KEY;
	if (!key) throw new Error("OPENROUTER_API_KEY is not set (see the top of this file)");
	for (let attempt = 1; ; attempt++) {
		const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Ankur Hindi translation" },
			body: JSON.stringify({
				model: MODEL,
				// OpenRouter holds credit for the full max_tokens up front, so
				// ask for what this batch needs: its Hindi plus reasoning.
				max_tokens: Math.min(32000, 8000 + prompt.length * 2),
				// Quality matters more than speed here: translation is a one-off.
				reasoning: { effort: "high" },
				response_format: { type: "json_schema", json_schema: { name: "translations", strict: true, schema: ITEMS_SCHEMA } },
				// Only route to providers that honour the JSON schema.
				provider: { require_parameters: true },
				messages: [{ role: "system", content: styleGuide }, { role: "user", content: prompt }],
			}),
		});
		// Rate limits and provider hiccups: wait and try again.
		if ((res.status === 429 || res.status >= 500) && attempt < 5) {
			await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
			continue;
		}
		const body = await res.json().catch(() => ({}));
		if (!res.ok || body.error) throw new Error(`OpenRouter ${res.status}: ${body.error?.message ?? JSON.stringify(body).slice(0, 300)}`);
		const choice = body.choices?.[0];
		if (choice?.finish_reason === "length") throw new Error("response hit max_tokens");
		return JSON.parse(choice.message.content).items;
	}
}

const where = (path) => path.filter((p) => typeof p === "string").join(" › ").replace("#rich", "paragraph");
const digits = (s) => (s.match(/\d+/g) ?? []).sort().join(",");

/** Problems with a translation, or "" when it looks right. */
function check(en, hi) {
	if (typeof hi !== "string" || !hi.trim()) return "empty";
	if (/[०-९]/.test(hi)) return "uses Devanagari digits";
	if (digits(en) !== digits(hi)) return `numbers differ (English has ${digits(en) || "none"}, Hindi has ${digits(hi) || "none"})`;
	if (tagsOf(en) !== tagsOf(hi)) return `markup tags differ (English has ${tagsOf(en) || "none"})`;
	if (en.trim().split(/\s+/).length >= 3 && !/[ऀ-ॿ]/.test(hi)) return "not in Hindi";
	return "";
}

function batches(items, maxChars = 9000) {
	const out = [];
	let cur = [], size = 0;
	for (const item of items) {
		if (cur.length && (size + item.en.length > maxChars || cur.length >= 120)) { out.push(cur); cur = []; size = 0; }
		cur.push(item); size += item.en.length;
	}
	if (cur.length) out.push(cur);
	return out;
}

async function translate(unit, items) {
	const results = new Map();
	for (const batch of batches(items)) {
		let pending = batch;
		for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
			const prompt = [
				`Translate this content from the website page "${unit.key}" into Hindi.`,
				`Each item has an id, where it appears on the page, and the English text. Return every id with its Hindi in "hi".`,
				attempt ? `These were translated before but failed a check (see "problem"); fix them.` : "",
				JSON.stringify(pending.map(({ id, path, en, problem }) => ({ id, where: where(path), en, ...(problem ? { problem } : {}) })), null, 1),
			].filter(Boolean).join("\n\n");
			const answers = new Map((await ask(prompt)).map((a) => [a.id, a.hi]));
			const retry = [];
			for (const item of pending) {
				const hi = answers.get(item.id);
				const problem = hi === undefined ? "missing from the answer" : check(item.en, hi);
				if (problem && attempt === 0) retry.push({ ...item, problem });
				else { results.set(item.id, hi ?? item.en); if (problem) console.warn(`  ! ${unit.key} ${where(item.path)}: ${problem}`); }
			}
			pending = retry;
		}
	}
	return results;
}

async function review(unit, items) {
	const fixes = new Map();
	for (const batch of batches(items, 12000)) {
		const prompt = [
			`You are reviewing the Hindi translation of the website page "${unit.key}". For each item, compare the Hindi with the English.`,
			`Return only the items that need a change, with the corrected Hindi in "hi" and a short reason in "note". Change an item when its meaning differs from the English, a fact or number is wrong or missing, it breaks the style guide (tone, names, digits, tags), or it sounds unnatural to an everyday Hindi reader. Leave good translations out. An empty list is a fine answer.`,
			JSON.stringify(batch.map(({ id, path, en, hi }) => ({ id, where: where(path), en, hi })), null, 1),
		].join("\n\n");
		for (const fix of await ask(prompt)) {
			const item = batch.find((i) => i.id === fix.id);
			if (!item || fix.hi === item.hi) continue;
			const problem = check(item.en, fix.hi);
			if (problem) console.warn(`  ! review of ${unit.key} ${where(item.path)} rejected: ${problem}`);
			else fixes.set(item.id, { hi: fix.hi, note: fix.note });
		}
	}
	return fixes;
}

// ---------------------------------------------------------------------------
// Translate what is new or changed.

const saveCache = () => writeFileSync(cachePath, `${JSON.stringify(cache, null, "\t")}\n`);
const pathKey = (path) => JSON.stringify(path);

async function runUnit(unit) {
	const stored = (cache[unit.key] ??= {});
	const items = unit.strings.map(([path, en], i) => ({ id: `t${i + 1}`, path, en, key: pathKey(path) }));
	const todo = items.filter((i) => args.retranslate || stored[i.key]?.en !== i.en);
	if (!todo.length) return;
	console.log(`${unit.key}: translating ${todo.length} of ${items.length} fields`);
	const translated = await translate(unit, todo);
	for (const item of todo) item.hi = translated.get(item.id);
	if (!args["no-review"]) {
		const fixes = await review(unit, todo);
		for (const item of todo) if (fixes.has(item.id)) {
			console.log(`  ~ ${where(item.path)}: ${fixes.get(item.id).note ?? ""}`);
			item.hi = fixes.get(item.id).hi;
		}
	}
	for (const item of todo) stored[item.key] = { en: item.en, hi: item.hi };
	// Fields that no longer exist in the English.
	const live = new Set(items.map((i) => i.key));
	for (const key of Object.keys(stored)) if (!live.has(key)) delete stored[key];
	saveCache();
}

if (!args["seed-only"]) {
	const queue = units.filter((u) => !only || only.has(u.key) || only.has(u.key.split("/")[1]));
	let failed = 0;
	await Promise.all(Array.from({ length: Number(args.concurrency) }, async () => {
		for (let unit; (unit = queue.shift());) {
			try { await runUnit(unit); } catch (error) { failed++; console.error(`${unit.key}: ${error.message}`); }
		}
	}));
	if (failed) console.error(`${failed} page(s) failed; run again to retry them.`);
}

// ---------------------------------------------------------------------------
// Write the Hindi entries and menus into the seed.

const hiOf = (unit, path, en) => {
	const hit = cache[unit.key ?? unit]?.[pathKey(path)];
	return hit?.en === en ? hit.hi : undefined;
};
const termHi = (en) => hiOf("terms", termPath(en), en);

let written = 0, untranslated = 0;
for (const unit of units.filter((u) => u.entry)) {
	const json = structuredClone(unit.json);
	let title = unit.entry.data.title, complete = true;
	for (const [path, en] of unit.strings) {
		const hi = hiOf(unit, path, en);
		if (hi === undefined) { complete = false; continue; }
		if (path[0] === "@title") title = hi; else applyText(json, path, hi);
	}
	for (const [path, en] of unit.terms) {
		const hi = termHi(en);
		if (hi === undefined) complete = false; else applyText(json, path, hi);
	}
	const entries = seed.content[unit.collection].filter((e) => !(e.locale === LOCALE && e.translationOf === unit.entry.id));
	if (!complete) { untranslated++; seed.content[unit.collection] = entries; continue; }
	const translation = {
		id: `${unit.entry.id}-${LOCALE}`,
		slug: unit.entry.slug,
		locale: LOCALE,
		translationOf: unit.entry.id,
		status: args.status,
		data: { ...unit.encode(json), ...(typeof title === "string" ? { title } : {}) },
	};
	// A translation must come after its source entry in the seed.
	entries.splice(entries.indexOf(unit.entry) + 1, 0, translation);
	seed.content[unit.collection] = entries;
	written++;
}

const menuUnit = units.find((u) => u.key === "menus");
const menuHi = (path, en) => hiOf(menuUnit, path, en);
const menusComplete = menuUnit.strings.every(([path, en]) => menuHi(path, en) !== undefined);
seed.menus = seed.menus.filter((m) => m.locale !== LOCALE);
for (const menu of menusComplete ? menuSource : []) {
	menu.id ??= `menu-${menu.name}`;
	const items = (list, path) => list.map((item, i) => ({
		...item,
		...(item.label ? { label: menuHi([...path, i, "label"], item.label) } : {}),
		...(item.children ? { children: items(item.children, [...path, i, "children"]) } : {}),
	}));
	seed.menus.splice(seed.menus.indexOf(menu) + 1, 0, {
		id: `${menu.id}-${LOCALE}`,
		name: menu.name,
		label: menuHi([menu.name, "@label"], menu.label),
		locale: LOCALE,
		translationOf: menu.id,
		items: items(menu.items, [menu.name, "items"]),
	});
}

writeFileSync(seedPath, `${JSON.stringify(seed, null, "\t")}\n`);
console.log(`seed: ${written} Hindi entries (${args.status}), ${menusComplete ? menuSource.length : 0} Hindi menus${untranslated ? `, ${untranslated} entries not fully translated yet (left out)` : ""}`);
