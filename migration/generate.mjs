// One-time migration: original Ankur JSON (migration/source) -> EmDash
//   seed/seed.json          schema (block types, collections) + all content
//   src/content/specs.json  codec specs the site uses to rebuild the exact JSON
//
//   node migration/generate.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeEntry, encodePage, BLOCK_VERSION } from "../src/lib/content/codec.mjs";
import { humanize, inferRecord, toSlug } from "./infer.mjs";
import { mediaFieldType } from "../src/lib/content/media.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "migration/source");
const read = (p) => JSON.parse(readFileSync(join(SRC, p), "utf8"));
const previousSeed = existsSync(join(root, "seed/seed.json")) ? JSON.parse(readFileSync(join(root, "seed/seed.json"), "utf8")) : null;
const previousSpecs = existsSync(join(root, "src/content/specs.json")) ? JSON.parse(readFileSync(join(root, "src/content/specs.json"), "utf8")) : null;

function hasFileAsset(items) {
	const leaves = new Map();
	const walk = (obj, path = []) => {
		for (const [key, value] of Object.entries(obj)) {
			if (isObj(value)) walk(value, [...path, key]);
			else if (typeof value === "string") {
				const p = [...path, key]; const k = p.join(".");
				if (!leaves.has(k)) leaves.set(k, { path: p, values: [] });
				leaves.get(k).values.push(value);
			}
		}
	};
	items.forEach((item) => walk(item));
	return [...leaves.values()].some((leaf) => mediaFieldType(leaf.path, leaf.values) === "file");
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const blockTypes = new Map();

const titleCase = (s) =>
	s
		.split(/[-_ ]+/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");

// ───────────────────────── pages ─────────────────────────
const pageFiles = readdirSync(join(SRC, "pages")).filter((f) => f.endsWith(".json")).sort();
const pageSpecs = {};
const pageEntries = {};
// D1 allows ~100 bound parameters per query, and EmDash resolves a blocks
// field's allowedTypes in one query, so pages are split across collections.
// This also keeps each editor's block picker limited to relevant sections.
const PAGE_COLLECTIONS = {
	pages: {
		label: "Pages",
		singular: "Page",
		pages: ["home", "about", "champalal-group", "quality-certificates", "career", "gallery", "contact", "404"],
	},
	business_pages: {
		label: "Business pages",
		singular: "Business page",
		pages: ["products", "blog", "industrial-salt", "export", "network"],
	},
	legal_pages: {
		label: "Legal pages",
		singular: "Legal page",
		pages: ["privacy-policy", "terms-of-service"],
	},
	site_chrome: {
		label: "Branding & footer copy",
		singular: "Branding or footer copy",
		pages: ["navbar", "footer"],
	},
};
const collectionOfPage = Object.fromEntries(
	Object.entries(PAGE_COLLECTIONS).flatMap(([c, v]) => v.pages.map((p) => [p, c])),
);
const blockSlugsByCollection = Object.fromEntries(Object.keys(PAGE_COLLECTIONS).map((c) => [c, []]));

for (const file of pageFiles) {
	const name = basename(file, ".json");
	const json = read(`pages/${file}`);
	const pageLabel = titleCase(name);
	const pageCollection = collectionOfPage[name];
	if (!pageCollection) throw new Error(`Page "${name}" is not assigned to a collection`);
	const pageBlockSlugs = blockSlugsByCollection[pageCollection];
	const spec = { name, collection: pageCollection, keyOrder: Object.keys(json), order: [], parts: {} };
	const scalarKeys = [];

	for (const [key, value] of Object.entries(json)) {
		if (!isObj(value) && !Array.isArray(value)) {
			scalarKeys.push(key);
			continue;
		}
		const blockType = toSlug(`${name}_${key}`);
		let mode;
		let inferred;
		const lists = [];
		if (isObj(value)) {
			mode = "object";
			const baseValue = { ...value };
			for (const [listKey, items] of Object.entries(value)) {
				if (!Array.isArray(items) || !items.length || !items.every(isObj) || !hasFileAsset(items)) continue;
				delete baseValue[listKey];
				const itemType = toSlug(`${blockType}_${listKey}_item`);
				const inner = inferRecord(items, { level: "root", blockPrefix: itemType, blockTypes });
				blockTypes.set(itemType, { slug: itemType, label: `${humanize([key])} item`, category: pageLabel,
					currentVersion: 1, versions: [{ version: 1, fields: inner.defs }] });
				pageBlockSlugs.push(itemType);
				lists.push({ path: [listKey], blockType: itemType, spec: inner.spec });
			}
			inferred = inferRecord([baseValue], { level: "root", blockPrefix: blockType, blockTypes, blockCategory: pageLabel });
		} else {
			mode = "wrap";
			inferred = inferRecord([{ value }], { level: "root", blockPrefix: blockType, blockTypes, blockCategory: pageLabel });
		}
		spec.order.push(key);
		spec.parts[key] = { mode, blockType, spec: inferred.spec };
		if (lists.length) {
			spec.parts[key].lists = lists;
			const old = previousSpecs?.pages[name]?.parts[key];
			if (old) spec.parts[key].legacySpec = old.legacySpec ?? old.spec;
		}
		blockTypes.set(blockType, {
			slug: blockType,
			label: humanize([key]),
			category: pageLabel,
			currentVersion: 1,
			versions: [{ version: 1, fields: inferred.defs }],
		});
		pageBlockSlugs.push(blockType);
	}

	if (scalarKeys.length) {
		const main = Object.fromEntries(scalarKeys.map((k) => [k, json[k]]));
		const blockType = toSlug(`${name}_page`);
		const inferred = inferRecord([main], { level: "root", blockPrefix: blockType, blockTypes });
		spec.order.unshift("__page");
		spec.parts.__page = { mode: "main", keys: scalarKeys, blockType, spec: inferred.spec };
		blockTypes.set(blockType, {
			slug: blockType,
			label: "Page details",
			category: pageLabel,
			currentVersion: 1,
			versions: [{ version: 1, fields: inferred.defs }],
		});
		pageBlockSlugs.push(blockType);
	}

	pageSpecs[name] = spec;
	// encodePage reads json[key] by the order key; the synthetic "__page" part gathers scalars itself
	(pageEntries[pageCollection] ??= []).push({
		id: `page-${name}`,
		slug: name,
		status: "published",
		data: { title: pageLabel, sections: encodePage(spec, json) },
	});
}

// ───────────────────── collections ─────────────────────
const collectionConfigs = {
	products: {
		label: "Products",
		singular: "Product",
		slugKey: "slug",
		typedLists: { "detail.sections": "type" },
		rename: { name: "title" },
		supports: ["drafts", "revisions", "preview", "seo"],
		fieldLabel: { name: "Name" },
	},
	blogs: {
		label: "Blog posts",
		singular: "Blog post",
		slugKey: "slug",
		typedLists: { content: "type" },
		rename: {},
		supports: ["drafts", "revisions", "preview", "search", "seo"],
	},
	distributors: {
		label: "Distributor states",
		singular: "Distributor state",
		slugKey: "id",
		typedLists: {},
		rename: { state: "title" },
		fieldLabel: { state: "State" },
		includePosition: false,
		supports: ["drafts", "revisions"],
	},
};

const collectionSpecs = {};
const collectionDefs = [];
const collectionContent = {};

for (const [slug, cfg] of Object.entries(collectionConfigs)) {
	const items = read(`collections/${slug}.json`);
	const prefix = toSlug(cfg.singular);
	const samples = items.map(({ [cfg.slugKey]: _s, ...rest }) => rest);
	const inferred = inferRecord(samples, {
		level: "root",
		typedLists: cfg.typedLists,
		rename: cfg.rename,
		fieldLabel: cfg.fieldLabel,
		blockPrefix: prefix,
		blockTypes,
		blockCategory: cfg.singular,
	});
	if (slug === "blogs") {
		// A blog is one rich-text document, not a page composition picker.
		const field = inferred.defs.find((f) => f.slug === "content");
		field.type = "portableText";
		field.label = "Article";
		field.searchable = true;
		delete field.validation;
		const index = inferred.spec.fields.findIndex((f) => f.slug === "content");
		inferred.spec.fields[index] = { kind: "portableText", path: ["content"], slug: "content" };
	}
	collectionSpecs[slug] = { slugKey: cfg.slugKey, slugIndex: Object.keys(items[0]).indexOf(cfg.slugKey), spec: inferred.spec,
		...(cfg.includePosition === false ? { includePosition: false } : {}) };
	const fields = [...inferred.defs, ...(cfg.includePosition === false ? [] : [{ slug: "position", label: "Display order", type: "integer" }])];
	// `title` first so the admin lists entries by it
	fields.sort((a, b) => (a.slug === "title" ? -1 : b.slug === "title" ? 1 : 0));
	for (const f of fields) if (f.slug === "title") f.required = true;
	collectionDefs.push({ slug, label: cfg.label, labelSingular: cfg.singular, supports: cfg.supports, fields });
	collectionContent[slug] = items.map((item, i) => {
		const { slug: entrySlug, data } = encodeEntry(collectionSpecs[slug], item, i + 1);
		return { id: `${prefix}-${entrySlug}`, slug: entrySlug, status: "published", data };
	});
}

// ───────────────────────── seed ─────────────────────────
const pageCollectionDefs = Object.entries(PAGE_COLLECTIONS).map(([slug, c]) => ({
	slug,
	label: c.label,
	labelSingular: c.singular,
	// The SEO panel overrides each page's own SEO section (site chrome has no page).
	supports: slug === "site_chrome" ? ["drafts", "revisions", "preview"] : ["drafts", "revisions", "preview", "seo"],
	fields: [
		{ slug: "title", label: "Title", type: "string", required: true },
		{
			slug: "sections",
			label: "Page sections",
			type: "blocks",
			validation: { allowedTypes: blockSlugsByCollection[slug] },
		},
	],
}));

// Breaking media changes get a new version; retain the former block contracts.
// Removed page sections remain available to historical data, but are excluded
// from the collection's allowedTypes and the current page codec.
for (const previous of previousSeed?.blockTypes ?? []) if (!blockTypes.has(previous.slug)) blockTypes.set(previous.slug, previous);
for (const block of blockTypes.values()) {
	const previous = previousSeed?.blockTypes.find((b) => b.slug === block.slug);
	if (!previous) continue;
	const nextFields = block.versions[0].fields;
	const active = previous.versions.find((v) => v.version === previous.currentVersion);
	block.versions = previous.versions;
	if (JSON.stringify(active.fields) === JSON.stringify(nextFields)) block.currentVersion = previous.currentVersion;
	else {
		block.currentVersion = Math.max(...previous.versions.map((v) => v.version)) + 1;
		block.versions = [...previous.versions, { version: block.currentVersion, fields: nextFields }];
	}
}
function applyVersions(spec) {
	for (const f of spec.fields) {
		if (f.kind === "repeater") applyVersions(f.item);
		if (f.kind === "blocks") for (const type of Object.values(f.types)) {
			type.version = blockTypes.get(type.blockType).currentVersion;
			applyVersions(type.spec);
		}
	}
}
for (const page of Object.values(pageSpecs)) for (const part of Object.values(page.parts)) {
	part.version = blockTypes.get(part.blockType).currentVersion;
	applyVersions(part.spec);
	for (const list of part.lists ?? []) { list.version = blockTypes.get(list.blockType).currentVersion; applyVersions(list.spec); }
}
for (const spec of Object.values(collectionSpecs)) applyVersions(spec.spec);
// Re-encode now that the versioned contracts have been settled.
for (const entries of Object.values(pageEntries)) for (const entry of entries) entry.data.sections = encodePage(pageSpecs[entry.slug], read(`pages/${entry.slug}.json`));
for (const [slug, entries] of Object.entries(collectionContent)) {
	const items = read(`collections/${slug}.json`);
	entries.forEach((entry, i) => { entry.data = encodeEntry(collectionSpecs[slug], items[i], i + 1).data; });
}

const seed = {
	$schema: "https://emdashcms.com/seed.schema.json",
	version: "1",
	meta: { name: "Ankur Salt", description: "Ankur Salt website content", author: "Ankur Chemfood Limited" },
	settings: { title: "Ankur Salt", tagline: "Real salt. Nothing hidden." },
	menus: read("menus.json"),
	blockTypes: [...blockTypes.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
	// Legacy *.html redirects (ANKURSALT-61) live in public/_redirects, enforced at the Cloudflare edge:
	// EmDash's redirect middleware skips any path with a file extension, so rules for them would never fire.
	collections: [...pageCollectionDefs, ...collectionDefs],
	content: { ...pageEntries, ...collectionContent },
};

mkdirSync(join(root, "seed"), { recursive: true });
mkdirSync(join(root, "src/content"), { recursive: true });
writeFileSync(join(root, "seed/seed.json"), JSON.stringify(seed, null, "\t") + "\n");
writeFileSync(join(root, "src/content/specs.json"), JSON.stringify({ pages: pageSpecs, collections: collectionSpecs }) + "\n");

console.log(
	`block types: ${blockTypes.size} | pages: ${Object.values(pageEntries).flat().length} | ` +
		Object.entries(collectionContent).map(([k, v]) => `${k}: ${v.length}`).join(" | "),
);
void BLOCK_VERSION;
