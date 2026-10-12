// Round-trip guarantee: for every original page / collection item,
//   decode(encode(original)) must deep-equal original
// and every encoded block must satisfy the generated schema the way EmDash's
// strict block validator would (no unknown keys, right scalar types,
// repeater rows only use declared sub-fields).
//
//   node migration/roundtrip.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeEntry, decodePage, encodeEntry, encodePage } from "../src/lib/content/codec.mjs";
import { toBlogRichText } from "../src/lib/content/blog-rich-text.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specs = JSON.parse(readFileSync(join(root, "src/content/specs.json"), "utf8"));
const seed = JSON.parse(readFileSync(join(root, "seed/seed.json"), "utf8"));
const blockDefs = new Map(seed.blockTypes.map((b) => [b.slug, b]));
const collDefs = new Map(seed.collections.map((c) => [c.slug, c]));
const src = (p) => JSON.parse(readFileSync(join(root, "migration/source", p), "utf8"));

let checked = 0;
const failures = [];

function scalarOk(type, v) {
	if (v === null || v === undefined) return true;
	if (type === "string" || type === "text" || type === "slug" || type === "url") return typeof v === "string";
	if (type === "number") return typeof v === "number";
	if (type === "integer") return Number.isInteger(v);
	if (type === "boolean") return typeof v === "boolean";
	return true;
}

function validateFields(defs, data, where) {
	const bySlug = new Map(defs.map((d) => [d.slug, d]));
	for (const [k, v] of Object.entries(data)) {
		if (k.startsWith("_")) continue;
		const d = bySlug.get(k);
		if (!d) throw new Error(`${where}: unknown field "${k}"`);
		if (d.type === "repeater") {
			if (!Array.isArray(v)) throw new Error(`${where}.${k}: repeater must be an array`);
			const subs = d.validation?.subFields ?? [];
			v.forEach((row, i) => validateFields(subs, row, `${where}.${k}[${i}]`));
		} else if (d.type === "blocks") {
			const allowed = new Set(d.validation?.allowedTypes ?? []);
			v.forEach((b, i) => validateBlock(b, `${where}.${k}[${i}]`, allowed));
		} else if (!scalarOk(d.type, v)) {
			throw new Error(`${where}.${k}: ${JSON.stringify(v)} is not a ${d.type}`);
		}
	}
}

function validateBlock(b, where, allowed) {
	const def = blockDefs.get(b._type);
	if (!def) throw new Error(`${where}: unknown block type ${b._type}`);
	if (allowed && !allowed.has(b._type)) throw new Error(`${where}: block type ${b._type} not allowed here`);
	if (!b._key) throw new Error(`${where}: missing _key`);
	const version = def.versions.find((v) => v.version === b._version);
	if (!version) throw new Error(`${where}: missing version ${b._version}`);
	validateFields(version.fields, b, `${where}<${b._type}>`);
}

function check(label, fn) {
	try {
		fn();
		checked++;
	} catch (e) {
		failures.push(`${label}: ${e.message.split("\n")[0]}`);
	}
}

// pages
for (const f of readdirSync(join(root, "migration/source/pages")).filter((f) => f.endsWith(".json"))) {
	const name = basename(f, ".json");
	const original = src(`pages/${f}`);
	check(`page ${name}`, () => {
		const sections = JSON.parse(JSON.stringify(encodePage(specs.pages[name], original)));
		const pages = collDefs.get(specs.pages[name].collection);
		validateFields(pages.fields, { title: name, sections }, `${specs.pages[name].collection}/${name}`);
		assert.deepStrictEqual(decodePage(specs.pages[name], sections), original);
	});
}

// collections
for (const [slug, cs] of Object.entries(specs.collections)) {
	const items = src(`collections/${slug}.json`);
	const def = collDefs.get(slug);
	items.forEach((item, i) => {
		check(`${slug}[${i}] ${item[cs.slugKey]}`, () => {
			const { slug: entrySlug, data } = encodeEntry(cs, item, i + 1);
			const wire = JSON.parse(JSON.stringify(data));
			validateFields(def.fields, wire, `${slug}/${entrySlug}`);
			const expected = slug === "blogs" ? { ...item, content: toBlogRichText(item.content) } : item;
			assert.deepStrictEqual(decodeEntry(cs, { slug: entrySlug, data: wire }), expected);
		});
	});
}

if (failures.length) {
	console.error(`FAILED ${failures.length} of ${checked + failures.length}`);
	for (const f of failures.slice(0, 25)) console.error("  -", f);
	process.exit(1);
}
console.log(`OK  ${checked} pages/entries preserve content and satisfy the schema (blogs use native rich text)`);
