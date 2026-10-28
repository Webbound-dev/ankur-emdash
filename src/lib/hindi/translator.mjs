// English -> Hindi translation of site content, shared by the bulk script
// (migration/hindi/translate.mjs) and the plugin that keeps Hindi up to date
// after each publish (src/plugins/hindi-translate.mjs).
//
// An entry is decoded back to its original JSON (../content/codec.mjs) and
// only its visible text is sent to Claude through OpenRouter, a page at a
// time, with style-guide.md. URLs, images, ids and structure never leave
// this module, so a Hindi entry is the English one with its text swapped. A
// second pass re-reads the Hindi against the English and fixes meaning,
// numbers and unnatural phrasing.
//
// Pure ESM; network access comes in as a `fetch`, so it runs in Node and in
// the Worker.
import { decodeEntry, decodePage, encodeEntry, encodePage } from "../content/codec.mjs";

export const LOCALE = "hi";
export const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
/** Collections translated; distributors (names, addresses) stay English. */
export const COLLECTIONS = new Set(["pages", "business_pages", "legal_pages", "site_chrome", "products", "blogs"]);

// ---------------------------------------------------------------------------
// Which strings are text. Keys holding paths, media, ids and markup are left
// alone, as are id-like values ("plants", "video") under any key.

// Blog categories (which key their colours) and export countries (which the
// world map looks up by name) are fixed lists the code matches on, so they
// stay English in the content and are translated where they're shown
// (src/lib/ui-strings.ts).
const SKIP_KEY = /^(_.*|category|countries|style|listItem|marks|href|src|image|poster|logo|file|website|url|slug|id|icon|handle|variant|code|level)$|(Href|Url|Src)$/;

/** Text rules for a site's specs: values that pick a block's type ("specTable", "faq") are ids too. */
export function createTextRules(specs) {
	const blockTypes = new Set();
	JSON.stringify(specs, (key, value) => {
		if (value?.discriminator && value.types) for (const t of Object.keys(value.types)) blockTypes.add(t);
		return value;
	});
	const isText = (key, value) =>
		!SKIP_KEY.test(key) &&
		!blockTypes.has(value) &&
		/\p{L}{2}/u.test(value) &&
		!/^[a-z][a-zA-Z0-9]*(?:[_-][a-zA-Z0-9]+)*$/.test(value) &&
		!/^(https?:|mailto:|tel:|\/|#|@)/.test(value) &&
		!/^\S+@\S+\.\S+$/.test(value);

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

	return { isText, extract };
}

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

/** The text at a path from extract(), or undefined. */
export function textAt(root, path) {
	const last = path[path.length - 1];
	let node = root;
	for (const k of last === "#rich" ? path.slice(0, -1) : path) {
		if (node == null || typeof node !== "object") return undefined;
		node = node[k];
	}
	if (last === "#rich") return isRichBlock(node) ? richToTagged(node) : undefined;
	return typeof node === "string" ? node : undefined;
}

export function applyText(root, path, text) {
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
export const isTerm = (path) => TERM_KEYS.has(path[path.length - 1]);
export const termPath = (en) => ["term", en];
export const pathKey = (path) => JSON.stringify(path);
export const where = (path) => path.filter((p) => typeof p === "string").join(" › ").replace("#rich", "paragraph");

/**
 * An entry as a unit of translation: its decoded JSON, how to encode a
 * (translated) copy back into the entry's data, its text, and its shared
 * terms. Pages keep their admin title outside the decoded JSON, so it is
 * included as the "@title" path.
 */
export function entryUnit(specs, rules, collection, entry) {
	const pageSpec = specs.pages[entry.slug]?.collection === collection ? specs.pages[entry.slug] : null;
	const collSpec = specs.collections[collection];
	if (!pageSpec && !collSpec) return null;
	const json = pageSpec ? decodePage(pageSpec, entry.data.sections) : decodeEntry(collSpec, entry);
	const encode = (j) => pageSpec
		? { ...entry.data, sections: encodePage(pageSpec, j) }
		: { ...entry.data, ...encodeEntry(collSpec, j, entry.data.position).data };
	const strings = rules.extract(json);
	if (pageSpec && typeof entry.data.title === "string" && rules.isText("title", entry.data.title)) strings.push([["@title"], entry.data.title]);
	return {
		key: `${collection}/${entry.slug}`, collection, entry, json, encode, pageSpec,
		strings: strings.filter(([path]) => !isTerm(path)),
		terms: strings.filter(([path]) => isTerm(path)),
	};
}

/** Decode another entry (the Hindi one) the way `unit` decodes its English. */
export function decodeLike(unit, specs, entry) {
	return unit.pageSpec ? decodePage(unit.pageSpec, entry.data.sections) : decodeEntry(specs.collections[unit.collection], entry);
}

// ---------------------------------------------------------------------------
// Claude, through OpenRouter

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

/** ask(prompt) -> [{ id, hi, note? }], with retries on rate limits and provider errors. */
export function createOpenRouterAsk({ fetch, apiKey, model = DEFAULT_MODEL, styleGuide }) {
	return async function ask(prompt) {
		if (!apiKey) throw new Error("No OpenRouter API key is set");
		for (let attempt = 1; ; attempt++) {
			const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "Ankur Hindi translation" },
				body: JSON.stringify({
					model,
					// OpenRouter holds credit for the full max_tokens up front, so
					// ask for what this batch needs: its Hindi plus reasoning.
					max_tokens: Math.min(32000, 8000 + prompt.length * 2),
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
	};
}

const digits = (s) => (s.match(/\d+/g) ?? []).sort().join(",");

/** Problems with a translation, or "" when it looks right. */
export function check(en, hi) {
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

/**
 * Translate items ({ id, path, en }) of the page `unitKey`, then review them.
 * Returns Map(id -> hi). `log(message)` gets warnings and review notes.
 */
export async function translateItems(ask, unitKey, items, { review = true, log = () => {} } = {}) {
	const results = new Map();
	for (const batch of batches(items)) {
		let pending = batch;
		for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
			const prompt = [
				`Translate this content from the website page "${unitKey}" into Hindi.`,
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
				else { results.set(item.id, hi ?? item.en); if (problem) log(`! ${unitKey} ${where(item.path)}: ${problem}`); }
			}
			pending = retry;
		}
	}
	if (!review) return results;
	for (const batch of batches(items, 12000)) {
		const prompt = [
			`You are reviewing the Hindi translation of the website page "${unitKey}". For each item, compare the Hindi with the English.`,
			`Return only the items that need a change, with the corrected Hindi in "hi" and a short reason in "note". Change an item when its meaning differs from the English, a fact or number is wrong or missing, it breaks the style guide (tone, names, digits, tags), or it sounds unnatural to an everyday Hindi reader. Leave good translations out. An empty list is a fine answer.`,
			JSON.stringify(batch.map(({ id, path, en }) => ({ id, where: where(path), en, hi: results.get(id) })), null, 1),
		].join("\n\n");
		for (const fix of await ask(prompt)) {
			const item = batch.find((i) => i.id === fix.id);
			if (!item || fix.hi === results.get(item.id)) continue;
			const problem = check(item.en, fix.hi);
			if (problem) log(`! review of ${unitKey} ${where(item.path)} rejected: ${problem}`);
			else { results.set(item.id, fix.hi); log(`~ ${where(item.path)}: ${fix.note ?? ""}`); }
		}
	}
	return results;
}

// ---------------------------------------------------------------------------

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The Hindi entry's data, keeping everything the translation didn't change in
 * the form it is stored in the English entry. `stored` is the English data,
 * `english` is it decoded and encoded again, `hindi` is the translated copy
 * encoded: wherever `english` and `hindi` agree, the stored value is kept
 * (a media-library image keeps its id; only its translated alt text changes).
 */
export function keepStored(stored, english, hindi) {
	if (same(english, hindi)) return stored === undefined ? hindi : stored;
	if (Array.isArray(hindi) && Array.isArray(english) && Array.isArray(stored) && english.length === hindi.length && stored.length === hindi.length) {
		return hindi.map((h, i) => keepStored(stored[i], english[i], h));
	}
	if (isObject(hindi) && isObject(english) && isObject(stored)) {
		const out = { ...stored };
		for (const [k, h] of Object.entries(hindi)) out[k] = keepStored(stored[k], english[k], h);
		return out;
	}
	return hindi;
}
