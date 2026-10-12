// Infers an EmDash block/field schema (+ the codec spec) from the original
// Ankur JSON. One-time migration tooling; the output is committed
// (seed/seed.json, src/content/specs.json) so this never runs in production.

import { mediaFieldType } from "../src/lib/content/media.mjs";

export function toSlug(s) {
	let out = String(s)
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[^A-Za-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toLowerCase();
	if (!out) out = "field";
	if (/^[0-9]/.test(out)) out = "n_" + out;
	return out;
}

const RESERVED = new Set([
	"id", "slug", "status", "author_id", "primary_byline_id", "created_at", "updated_at",
	"published_at", "scheduled_at", "deleted_at", "version", "live_revision_id",
	"draft_revision_id", "terms", "bylines", "byline", "position", "type", "locale",
]);

function uniqueSlug(base, used) {
	let slug = base.length > 56 ? base.slice(0, 56).replace(/_+$/, "") : base;
	if (RESERVED.has(slug)) slug = slug === "id" ? "item_id" : `${slug}_field`;
	let n = 2;
	let cand = slug;
	while (used.has(cand)) cand = `${slug}_${n++}`;
	used.add(cand);
	return cand;
}

export function humanize(parts) {
	const words = parts
		.flatMap((p) => String(p).replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_\-]+/))
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Collect every leaf (scalar or array) reachable through plain objects. */
function collectLeaves(samples) {
	/** @type {Map<string,{path:string[],values:any[],count:number,isArray:boolean}>} */
	const leaves = new Map();
	const walk = (obj, path, total) => {
		for (const [k, v] of Object.entries(obj)) {
			const p = [...path, k];
			if (isObj(v)) {
				walk(v, p, total);
				continue;
			}
			const id = JSON.stringify(p);
			let leaf = leaves.get(id);
			if (!leaf) {
				leaf = { path: p, values: [], count: 0, isArray: Array.isArray(v) };
				leaves.set(id, leaf);
			}
			leaf.count++;
			leaf.values.push(v);
		}
	};
	for (const s of samples) walk(s, [], samples.length);
	return [...leaves.values()];
}

function scalarType(values) {
	const vs = values.filter((v) => v !== undefined && v !== null);
	if (vs.every((v) => typeof v === "boolean")) return "boolean";
	if (vs.every((v) => typeof v === "number")) return vs.every(Number.isInteger) ? "integer" : "number";
	if (vs.every((v) => typeof v === "string")) {
		const long = vs.some((v) => v.length > 100 || v.includes("\n"));
		return long ? "text" : "string";
	}
	throw new Error(`Mixed scalar types: ${JSON.stringify(vs.slice(0, 5))}`);
}

/**
 * @param samples  objects of the same shape (all section instances / all items)
 * @param opts.level   'root' (blocks + repeaters allowed) | 'row' (inside a repeater)
 * @param opts.typedLists  { 'dot.path': discriminatorKey } -> becomes a `blocks` field
 * @param opts.blockPrefix prefix for generated block type slugs
 * @param opts.rename { 'dot.path': 'slug' } to force a field slug
 * @param opts.blockTypes  collector: Map<slug, blockTypeDef> for generated block types
 */
export function inferRecord(samples, opts) {
	const { level = "root", typedLists = {}, rename = {}, blockPrefix = "block", blockTypes, fieldLabel = {} } = opts;
	const used = new Set();
	const fields = []; // codec spec fields
	const defs = []; // EmDash field definitions (parallel)
	const total = samples.length;

	for (const leaf of collectLeaves(samples)) {
		const dot = leaf.path.join(".");
		const optional = leaf.count < total;
		const base = rename[dot] ?? toSlug(leaf.path.join("_"));
		const slug = uniqueSlug(base, used);
		const label = fieldLabel[dot] ?? humanize(leaf.path);

		if (!leaf.isArray) {
			const mediaType = mediaFieldType(leaf.path, leaf.values);
			if (mediaType) {
				if (level === "row" && mediaType === "file") throw new Error(`File ${dot} requires a separate item block`);
				const altPath = leaf.path.at(-1) === "src" ? [...leaf.path.slice(0, -1), "alt"] : [...leaf.path.slice(0, -1), `${leaf.path.at(-1)}Alt`];
				fields.push({ kind: "media", path: leaf.path, slug, type: mediaType, altPath, ...(optional ? { optional } : {}) });
				defs.push({ slug, label, type: mediaType });
				continue;
			}
			const type = scalarType(leaf.values);
			fields.push({ kind: "scalar", path: leaf.path, slug, type, ...(optional ? { optional } : {}) });
			defs.push({ slug, label, type });
			continue;
		}

		const items = leaf.values.flat();

		// Typed list -> blocks field (root level only)
		if (typedLists[dot]) {
			if (level !== "root") throw new Error(`Typed list ${dot} inside a repeater row`);
			const disc = typedLists[dot];
			const groups = new Map();
			const discIndexes = new Map();
			for (const it of items) {
				const key = it[disc];
				if (!groups.has(key)) {
					groups.set(key, []);
					discIndexes.set(key, Object.keys(it).indexOf(disc));
				}
				const { [disc]: _d, ...rest } = it;
				groups.get(key).push(rest);
			}
			const types = {};
			const allowed = [];
			for (const [typeKey, group] of groups) {
				const blockSlug = toSlug(`${blockPrefix}_${typeKey}`);
				const inner = inferRecord(group, { level: "root", blockPrefix, rename: {}, blockTypes });
				types[typeKey] = { blockType: blockSlug, discIndex: discIndexes.get(typeKey), spec: inner.spec };
				allowed.push(blockSlug);
				blockTypes.set(blockSlug, {
					slug: blockSlug,
					label: humanize([typeKey]),
					category: opts.blockCategory ?? humanize([blockPrefix]),
					currentVersion: 1,
					versions: [{ version: 1, fields: inner.defs }],
				});
			}
			fields.push({ kind: "blocks", path: leaf.path, slug, discriminator: disc, types, ...(optional ? { optional } : {}) });
			defs.push({ slug, label, type: "blocks", validation: { allowedTypes: allowed } });
			continue;
		}

		if (items.length === 0 || items.every((v) => typeof v === "string")) {
			if (level === "root") {
				fields.push({ kind: "strlist", path: leaf.path, slug, ...(optional ? { optional } : {}) });
				defs.push({
					slug,
					label,
					type: "repeater",
					validation: { subFields: [{ slug: "value", label: "Value", type: scalarType(items.length ? items : ["x"]) }] },
				});
			} else {
				const longest = items.reduce((m, s) => Math.max(m, s.length), 0);
				const sep = longest > 60 ? "\n\n" : "\n";
				if (items.some((s) => s.includes(sep) || s === "")) throw new Error(`strlines unsafe at ${dot}`);
				fields.push({ kind: "strlines", path: leaf.path, slug, sep, ...(optional ? { optional } : {}) });
				defs.push({ slug, label: `${label} (one per ${sep === "\n\n" ? "paragraph, blank line between" : "line"})`, type: "text" });
			}
			continue;
		}

		if (items.every(isObj)) {
			if (level === "root") {
				const inner = inferRecord(items, { level: "row", blockPrefix, blockTypes });
				fields.push({ kind: "repeater", path: leaf.path, slug, item: inner.spec, ...(optional ? { optional } : {}) });
				defs.push({ slug, label, type: "repeater", validation: { subFields: inner.defs } });
			} else {
				// list of flat objects inside a repeater row -> "a | b" lines
				const keys = [];
				for (const it of items) for (const k of Object.keys(it)) if (!keys.includes(k)) keys.push(k);
				const sep = " | ";
				const lineSep = "\n";
				for (const it of items) {
					for (const k of keys) {
						const v = it[k];
						if (typeof v !== "string" || v.includes(sep) || v.includes(lineSep)) {
							throw new Error(`objlines unsafe at ${dot}.${k}: ${JSON.stringify(v)}`);
						}
					}
				}
				fields.push({ kind: "objlines", path: leaf.path, slug, keys, sep, lineSep, ...(optional ? { optional } : {}) });
				defs.push({ slug, label: `${label} (one per line: ${keys.join(" | ")})`, type: "text" });
			}
			continue;
		}

		throw new Error(`Unsupported array at ${dot}: ${JSON.stringify(items.slice(0, 2))}`);
	}
	// Alt text belongs to the native image reference. Keep the source path in
	// the codec so existing templates still receive their original alt props.
	const redundant = new Set();
	for (const media of fields.filter((f) => f.kind === "media" && f.type === "image")) {
		const alt = fields.find((f) => f.kind === "scalar" && JSON.stringify(f.path) === JSON.stringify(media.altPath));
		if (!alt) continue;
		media.renderAlt = true;
		media.legacyAltSlug = alt.slug;
		redundant.add(alt.slug);
	}
	return { spec: { fields: fields.filter((f) => !redundant.has(f.slug)) }, defs: defs.filter((f) => !redundant.has(f.slug)) };
}
