// Bulk Hindi translation of the site content, from the English in seed/seed.json.
//
//   node migration/hindi/translate.mjs         # translate + review what's new or changed, then write the seed
//   node migration/hindi/translate.mjs --only home,about   # just these pages/entries (slugs), "menus" and/or "terms"
//   node migration/hindi/translate.mjs --seed-only         # rebuild the seed from translations.json, no API calls
//   node migration/hindi/translate.mjs --retranslate       # ignore earlier translations and do everything again
//   node migration/hindi/translate.mjs --model anthropic/claude-sonnet-5.5   # another OpenRouter model for this run
//
// The translation itself lives in src/lib/hindi/translator.mjs, shared with
// the plugin that keeps Hindi up to date after each publish in the admin
// (src/plugins/hindi-translate.mjs). Use this script for the initial bulk
// translation and for menus; day-to-day content edits are handled by the
// plugin.
//
// Results are kept per field in src/lib/hindi/translations.json next to the
// English they came from; a later run only translates fields whose English
// has changed. The Hindi entries are written to seed/seed.json as
// translations of the English ones (locale "hi"), published (--status draft
// to hold them back). Requires
// OPENROUTER_API_KEY, in the environment or in migration/hindi/.env
// (git-ignored): OPENROUTER_API_KEY=sk-or-...
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual, parseArgs } from "node:util";
import {
	COLLECTIONS, DEFAULT_MODEL, LOCALE, applyText, createOpenRouterAsk, createTextRules,
	entryUnit, pathKey, termPath, translateItems,
} from "../../src/lib/hindi/translator.mjs";

const { values: args } = parseArgs({ options: {
	only: { type: "string" },
	"seed-only": { type: "boolean", default: false },
	retranslate: { type: "boolean", default: false },
	"no-review": { type: "boolean", default: false },
	status: { type: "string", default: "published" },
	concurrency: { type: "string", default: "4" },
	model: { type: "string", default: DEFAULT_MODEL },
	// For testing the pipeline: --fake marks text "हिं:" instead of calling
	// Claude; --seed-file/--cache-file point at copies.
	fake: { type: "boolean", default: false },
	"seed-file": { type: "string" },
	"cache-file": { type: "string" },
} });

const file = (path) => new URL(path, import.meta.url);
const seedPath = args["seed-file"] ?? file("../../seed/seed.json");
const cachePath = args["cache-file"] ?? file("../../src/lib/hindi/translations.json");
const seed = JSON.parse(readFileSync(seedPath, "utf8"));
const specs = JSON.parse(readFileSync(file("../../src/content/specs.json"), "utf8"));
const styleGuide = readFileSync(file("../../src/lib/hindi/style-guide.md"), "utf8");
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
const only = args.only ? new Set(args.only.split(",")) : null;
const rules = createTextRules(specs);

// ---------------------------------------------------------------------------
// Units of translation: one per page or entry, plus the menus and terms.

const isSource = (e) => !e.locale || e.locale === "en";
const units = [];
for (const [collection, entries] of Object.entries(seed.content)) {
	if (!COLLECTIONS.has(collection)) continue;
	for (const entry of entries.filter(isSource)) {
		const unit = entryUnit(specs, rules, collection, entry);
		// The codec is lossless; if an entry doesn't round-trip, its Hindi
		// version would silently differ from the English beyond the text.
		if (!unit || !isDeepStrictEqual(JSON.parse(JSON.stringify(unit.encode(unit.json))), entry.data)) {
			console.warn(`skip ${collection}/${entry.slug}: does not round-trip through the codec`);
			continue;
		}
		units.push(unit);
	}
}

const menuSource = seed.menus.filter(isSource);
{
	const strings = [];
	const walk = (items, path) => items.forEach((item, i) => {
		if (item.label && rules.isText("label", item.label)) strings.push([[...path, i, "label"], item.label]);
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
// Translate what is new or changed.

if (existsSync(file(".env"))) process.loadEnvFile(file(".env"));
const ask = args.fake
	? async (prompt) => {
		const items = JSON.parse(prompt.slice(prompt.lastIndexOf("\n\n[") + 2));
		return prompt.startsWith("You are reviewing") ? [] : items.map(({ id, en }) => ({ id, hi: `हिं: ${en}` }));
	}
	: createOpenRouterAsk({ fetch, apiKey: process.env.OPENROUTER_API_KEY, model: args.model, styleGuide });

const saveCache = () => writeFileSync(cachePath, `${JSON.stringify(cache, null, "\t")}\n`);

async function runUnit(unit) {
	const stored = (cache[unit.key] ??= {});
	const items = unit.strings.map(([path, en], i) => ({ id: `t${i + 1}`, path, en, key: pathKey(path) }));
	const todo = items.filter((i) => args.retranslate || stored[i.key]?.en !== i.en);
	if (!todo.length) return;
	console.log(`${unit.key}: translating ${todo.length} of ${items.length} fields`);
	const hi = await translateItems(ask, unit.key, todo, { review: !args["no-review"], log: (m) => console.log(`  ${m}`) });
	for (const item of todo) stored[item.key] = { en: item.en, hi: hi.get(item.id) };
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
	// Set only for pages, whose admin title lives outside the decoded JSON.
	let title, complete = true;
	for (const [path, en] of unit.strings) {
		const hi = hiOf(unit, path, en);
		if (hi === undefined) { complete = false; continue; }
		if (path[0] === "@title") title = hi; else applyText(json, path, hi);
	}
	for (const [path, en] of unit.terms) {
		const hi = termHi(en);
		if (hi === undefined) complete = false; else applyText(json, path, hi);
	}
	// Not fully translated yet (a failed run): keep the Hindi entry the seed has.
	if (!complete) { untranslated++; continue; }
	const entries = seed.content[unit.collection].filter((e) => !(e.locale === LOCALE && e.translationOf === unit.entry.id));
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
console.log(`seed: ${written} Hindi entries (${args.status}), ${menusComplete ? menuSource.length : 0} Hindi menus${untranslated ? `, ${untranslated} not fully translated yet (their previous Hindi kept)` : ""}`);
