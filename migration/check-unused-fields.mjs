// Compare all rendered content before/after cleanup, allowing only audited
// removals; also verify revision metadata, uploaded media and old contracts.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { decodeEntry, decodePage } from "../src/lib/content/codec.mjs";

const { values } = parseArgs({ options: { database: { type: "string" }, before: { type: "string" }, "before-specs": { type: "string" } } });
if (!values.database || !values.before || !values["before-specs"]) throw new Error("Use --database <migrated SQLite> --before <backup> --before-specs <original specs.json>");
const db = new DatabaseSync(values.database, { readOnly: true });
const before = new DatabaseSync(values.before, { readOnly: true });
const specs = JSON.parse(readFileSync(new URL("../src/content/specs.json", import.meta.url), "utf8"));
const oldSpecs = JSON.parse(readFileSync(values["before-specs"], "utf8"));
const seed = JSON.parse(readFileSync(new URL("../seed/seed.json", import.meta.url), "utf8"));
function expected(name, content) {
	const next = structuredClone(content);
	if (name === "home") {
		delete next.quote.image;
		for (const row of next.distributionMap.states) delete row.value;
	} else if (name === "about") for (const row of next.leadership.people) delete row.photo;
	else if (name === "industrial-salt") {
		delete next.trustedBy; delete next.grades.columns;
		for (const row of next.grades.items) { delete row.nacl; delete row.moisture; }
		delete next.dataSheets.gate.resendLabel;
	}
	return next;
}
function fields(connection, collection) {
	return connection.prepare("SELECT f.* FROM _emdash_fields f JOIN _emdash_collections c ON c.id=f.collection_id WHERE c.slug=?").all(collection);
}
function dataFor(row, defs) {
	const data = {};
	for (const field of defs) {
		const value = row[field.slug];
		data[field.slug] = value != null && ["image", "file", "blocks", "repeater", "portableText", "json"].includes(field.type) ? JSON.parse(value) : value;
	}
	return data;
}
try {
	let documents = 0;
	for (const [name, spec] of Object.entries(specs.pages)) {
		const original = before.prepare(`SELECT * FROM "ec_${spec.collection}" WHERE slug=?`).get(name);
		const current = db.prepare(`SELECT * FROM "ec_${spec.collection}" WHERE id=?`).get(original.id);
		assert.deepEqual(decodePage(spec, JSON.parse(current.sections)), expected(name, decodePage(oldSpecs.pages[name], JSON.parse(original.sections))), `Rendered page changed: ${name}`);
		documents++;
	}
	for (const [collection, spec] of Object.entries(specs.collections)) {
		for (const original of before.prepare(`SELECT * FROM "ec_${collection}"`).all()) {
			const current = db.prepare(`SELECT * FROM "ec_${collection}" WHERE id=?`).get(original.id);
			assert.deepEqual(decodeEntry(spec, { slug: current.slug, data: dataFor(current, fields(db, collection)) }), decodeEntry(oldSpecs.collections[collection], { slug: original.slug, data: dataFor(original, fields(before, collection)) }), `Rendered collection content changed: ${collection}/${original.slug}`);
			documents++;
		}
	}
	for (const collection of before.prepare("SELECT slug FROM _emdash_collections").all()) {
		const originals = before.prepare(`SELECT * FROM "ec_${collection.slug}"`).all();
		assert.equal(db.prepare(`SELECT count(*) AS n FROM "ec_${collection.slug}"`).get().n, originals.length);
		for (const original of originals) {
			const current = db.prepare(`SELECT * FROM "ec_${collection.slug}" WHERE id=?`).get(original.id);
			for (const key of ["id", "slug", "status", "deleted_at", "author_id", "primary_byline_id", "created_at", "published_at", "scheduled_at", "live_revision_id", "draft_revision_id", "locale", "translation_group"]) assert.equal(current[key], original[key], `${collection.slug}.${key}`);
		}
	}
	const originals = before.prepare("SELECT * FROM revisions").all();
	assert.equal(db.prepare("SELECT count(*) AS n FROM revisions").get().n, originals.length);
	for (const original of originals) {
		const current = db.prepare("SELECT * FROM revisions WHERE id=?").get(original.id);
		const oldData = JSON.parse(original.data), newData = JSON.parse(current.data);
		const entry = before.prepare(`SELECT slug FROM "ec_${original.collection}" WHERE id=?`).get(original.entry_id);
		if (specs.pages[entry?.slug]?.collection === original.collection) {
			const page = entry.slug;
			assert.deepEqual(decodePage(specs.pages[page], newData.sections), expected(page, decodePage(oldSpecs.pages[page], oldData.sections)), `Revision content changed: ${page}`);
			delete newData.sections; delete oldData.sections; assert.deepEqual(newData, oldData);
		} else if (specs.collections[original.collection]) assert.deepEqual(decodeEntry(specs.collections[original.collection], { slug: entry.slug, data: newData }), decodeEntry(oldSpecs.collections[original.collection], { slug: entry.slug, data: oldData }));
		else assert.deepEqual(newData, oldData);
		delete original.data; delete current.data; assert.deepEqual(current, original);
	}
	assert.deepEqual(db.prepare("SELECT * FROM media ORDER BY id").all(), before.prepare("SELECT * FROM media ORDER BY id").all());
	for (const row of before.prepare("SELECT * FROM _emdash_block_type_versions").all()) assert.deepEqual(db.prepare("SELECT * FROM _emdash_block_type_versions WHERE id=?").get(row.id), row);
	// Validate the migrated current entries and revisions against exact schemas,
	// including unknown-key rejection in blocks/repeater rows.
	const blocks = new Map(seed.blockTypes.map((b) => [b.slug, b]));
	function validateRecord(defs, data, block = false) {
		for (const key of Object.keys(data)) assert.ok(defs.some((f) => f.slug === key) || (block && ["_key", "_type", "_version"].includes(key)), `Undeclared key ${key}`);
		for (const field of defs) {
			const value = data[field.slug];
			if (!value) continue;
			if (field.type === "repeater") for (const row of value) validateRecord(field.validation.subFields, row);
			if (field.type === "blocks") for (const row of value) {
				assert.ok(field.validation.allowedTypes.includes(row._type));
				const type = blocks.get(row._type), version = type.versions.find((v) => v.version === row._version);
				assert.ok(version); validateRecord(version.fields, row, true);
			}
			if (field.type === "image") assert.equal(typeof value.alt, "string");
		}
	}
	for (const collection of seed.collections) {
		for (const row of db.prepare(`SELECT * FROM "ec_${collection.slug}"`).all()) validateRecord(collection.fields, dataFor(row, collection.fields));
		for (const row of db.prepare("SELECT data FROM revisions WHERE collection=?").all(collection.slug)) validateRecord(collection.fields, JSON.parse(row.data));
	}
	console.log(`Verified ${documents} documents (including trashed states) and ${originals.length} revisions: rendered content/alt text, map coverage, forms, metadata, media library and historical contracts preserved.`);
} finally { db.close(); before.close(); }
