import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { decodeEntry, decodePage } from "../src/lib/content/codec.mjs";

const { values } = parseArgs({ options: { database: { type: "string" }, before: { type: "string" } } });
if (!values.database || !values.before) throw new Error("Use --database <migrated SQLite> --before <backup SQLite>");
const db = new DatabaseSync(values.database, { readOnly: true });
const before = new DatabaseSync(values.before, { readOnly: true });
const specs = JSON.parse(readFileSync(new URL("../src/content/specs.json", import.meta.url), "utf8"));
try {
	const oldRows = before.prepare("SELECT * FROM ec_distributors WHERE deleted_at IS NULL AND status='published'").all();
	const newRows = db.prepare("SELECT * FROM ec_distributors WHERE deleted_at IS NULL AND status='published'").all();
	const states = (rows, field) => [...new Set(rows.map((r) => r[field]))].sort();
	assert.deepEqual(states(newRows, "title"), states(oldRows, "state"), "Map coverage changed");
	assert.equal(newRows.length, states(newRows, "title").length, "Duplicate states remain");
	for (const row of newRows) {
		const decoded = decodeEntry(specs.collections.distributors, { slug: row.slug, data: row });
		assert.deepEqual(Object.keys(decoded).sort(), ["id", "state"]);
		assert.equal(decoded.state, row.title);
	}
	const fields = db.prepare("SELECT f.slug,f.label FROM _emdash_fields f JOIN _emdash_collections c ON c.id=f.collection_id WHERE c.slug='distributors'").all();
	assert.deepEqual(fields.map((f) => ({ ...f })), [{ slug: "title", label: "State" }]);
	const columns = db.prepare("PRAGMA table_info(ec_distributors)").all().map((c) => c.name);
	for (const key of ["state", "region", "city", "address", "phone", "position"]) assert.ok(!columns.includes(key));
	for (const row of before.prepare("SELECT * FROM ec_distributors").all()) {
		const current = db.prepare("SELECT * FROM ec_distributors WHERE id=?").get(row.id);
		for (const key of ["id", "slug", "status", "created_at", "published_at", "live_revision_id", "draft_revision_id", "locale"]) assert.equal(current[key], row[key]);
	}
	const oldNetwork = before.prepare("SELECT * FROM ec_business_pages WHERE slug='network'").get();
	const newNetwork = db.prepare("SELECT * FROM ec_business_pages WHERE slug='network'").get();
	const expected = JSON.parse(oldNetwork.sections).filter((b) => b._type !== "network_directory").map((block) => {
		if (block._type !== "network_hero") return block;
		const next = { ...block, _version: specs.pages.network.parts.hero.version };
		delete next.search_placeholder; delete next.search_button_label;
		return next;
	});
	assert.deepEqual(JSON.parse(newNetwork.sections), expected, "Network form or SEO content changed");
	const content = decodePage(specs.pages.network, JSON.parse(newNetwork.sections));
	assert.ok(!("directory" in content));
	assert.deepEqual(Object.keys(content.hero).sort(), ["eyebrow", "heading", "intro"]);
	for (const collection of before.prepare("SELECT slug FROM _emdash_collections").all()) {
		if (collection.slug === "distributors") continue;
		for (const row of before.prepare(`SELECT * FROM "ec_${collection.slug}"`).all()) {
			const current = db.prepare(`SELECT * FROM "ec_${collection.slug}" WHERE id=?`).get(row.id);
			if (collection.slug === "business_pages" && row.slug === "network") {
				for (const key of ["sections", "version", "updated_at"]) { delete row[key]; delete current[key]; }
			}
			assert.deepEqual(current, row, `Other content changed: ${collection.slug}/${row.slug}`);
		}
	}
	const revisions = before.prepare("SELECT * FROM revisions").all();
	assert.equal(db.prepare("SELECT count(*) AS n FROM revisions").get().n, revisions.length);
	for (const row of revisions) {
		const current = db.prepare("SELECT * FROM revisions WHERE id=?").get(row.id);
		if (row.collection === "distributors") {
			const original = JSON.parse(row.data), data = JSON.parse(current.data);
			assert.deepEqual(data, { title: original.state.trim() });
		} else if (row.collection === "business_pages" && row.entry_id === oldNetwork.id) {
			const original = JSON.parse(row.data), data = JSON.parse(current.data);
			assert.ok(!data.sections.some((b) => b._type === "network_directory"));
			for (const b of data.sections.filter((b) => b._type === "network_hero")) assert.ok(!("search_placeholder" in b) && !("search_button_label" in b));
			delete original.sections; delete data.sections; assert.deepEqual(data, original);
		} else assert.equal(current.data, row.data);
		delete current.data; delete row.data; assert.deepEqual(current, row);
	}
	assert.deepEqual(db.prepare("SELECT * FROM media ORDER BY id").all(), before.prepare("SELECT * FROM media ORDER BY id").all(), "Media library changed");
	for (const row of before.prepare("SELECT * FROM _emdash_block_type_versions").all()) assert.deepEqual(db.prepare("SELECT * FROM _emdash_block_type_versions WHERE id=?").get(row.id), row, "Historical block contract changed");
	const validation = db.prepare("SELECT f.validation FROM _emdash_fields f JOIN _emdash_collections c ON c.id=f.collection_id WHERE c.slug='business_pages' AND f.slug='sections'").get();
	assert.ok(!JSON.parse(validation.validation).allowedTypes.includes("network_directory"));
	console.log(`Verified ${newRows.length} unique states preserve map coverage; Network forms/SEO, other content, media, revision metadata and historical contracts preserved.`);
} finally { db.close(); before.close(); }
