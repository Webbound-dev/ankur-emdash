import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { decodePage } from "../src/lib/content/codec.mjs";
import { menusFromChrome, withNavigation } from "../src/lib/content/navigation.mjs";

const { values } = parseArgs({ options: { database: { type: "string" }, before: { type: "string" }, "before-specs": { type: "string" } } });
if (!values.database || !values.before || !values["before-specs"]) throw new Error("Use --database <migrated SQLite> --before <backup> --before-specs <original specs.json>");
const db = new DatabaseSync(values.database, { readOnly: true }), before = new DatabaseSync(values.before, { readOnly: true });
const specs = JSON.parse(readFileSync(new URL("../src/content/specs.json", import.meta.url), "utf8"));
const oldSpecs = JSON.parse(readFileSync(values["before-specs"], "utf8"));
const seed = JSON.parse(readFileSync(new URL("../seed/seed.json", import.meta.url), "utf8"));
const oldRows = before.prepare("SELECT * FROM ec_site_chrome ORDER BY id").all();
const original = Object.fromEntries(oldRows.map((row) => [row.slug, decodePage(oldSpecs.pages[row.slug], JSON.parse(row.sections))]));
const expected = menusFromChrome(original.navbar, original.footer);
const resolved = {};
let links = 0;
for (const menu of expected) {
	const stored = db.prepare("SELECT * FROM _emdash_menus WHERE name=?").get(menu.name);
	assert(stored, `Missing menu ${menu.name}`);
	assert.equal(stored.label, menu.label);
	const rows = db.prepare("SELECT * FROM _emdash_menu_items WHERE menu_id=? ORDER BY sort_order").all(stored.id);
	function tree(parent = null) {
		return rows.filter((r) => r.parent_id === parent).map((row) => {
			links++; assert.equal(row.type, "custom"); assert.equal(row.locale, stored.locale);
			const children = tree(row.id);
			return { type: row.type, label: row.label, url: row.custom_url, ...(children.length ? { children } : {}) };
		});
	}
	const items = tree(); assert.deepEqual(items, menu.items, `${menu.name}: labels/URLs/order/children changed`);
	resolved[menu.name] = { items };
}
for (const row of oldRows) {
	const next = db.prepare("SELECT * FROM ec_site_chrome WHERE id=?").get(row.id);
	const content = withNavigation(row.slug, decodePage(specs.pages[row.slug], JSON.parse(next.sections)), resolved);
	const old = structuredClone(original[row.slug]);
	if (row.slug === "navbar") for (const key of ["leftLinksHidden", "rightLinksHidden", "_hiddenLinks_note"]) delete old[key];
	assert.deepEqual(content, old, `${row.slug}: rendered content changed`);
	const remaining = JSON.parse(next.sections);
	const allowed = seed.collections.find((c) => c.slug === "site_chrome").fields.find((f) => f.slug === "sections").validation.allowedTypes;
	assert(remaining.every((block) => allowed.includes(block._type)));
	for (const [key, value] of Object.entries(row)) if (!["sections", "version", "updated_at"].includes(key)) assert.deepEqual(next[key], value, `Chrome metadata ${key}`);
}
const oldAllowed = JSON.parse(before.prepare("SELECT f.validation FROM _emdash_fields f JOIN _emdash_collections c ON c.id=f.collection_id WHERE c.slug='site_chrome' AND f.slug='sections'").get().validation).allowedTypes;
const newAllowed = seed.collections.find((c) => c.slug === "site_chrome").fields.find((f) => f.slug === "sections").validation.allowedTypes;
const removed = oldAllowed.filter((type) => !newAllowed.includes(type));
const revisions = before.prepare("SELECT * FROM revisions ORDER BY id").all();
for (const row of revisions) {
	const next = db.prepare("SELECT * FROM revisions WHERE id=?").get(row.id);
	const expectedRow = { ...row };
	if (row.collection === "site_chrome") {
		const data = JSON.parse(row.data);
		expectedRow.data = JSON.stringify({ ...data, sections: data.sections.filter((block) => !removed.includes(block._type)) });
	}
	assert.deepEqual({ ...next }, expectedRow, `Revision ${row.id}`);
}
for (const collection of seed.collections.filter((c) => c.slug !== "site_chrome")) {
	assert.deepEqual(db.prepare(`SELECT * FROM "ec_${collection.slug}" ORDER BY id`).all(), before.prepare(`SELECT * FROM "ec_${collection.slug}" ORDER BY id`).all(), `Unrelated ${collection.slug} content changed`);
}
for (const table of ["media", "_emdash_block_types", "_emdash_block_type_versions"]) assert.deepEqual(db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all(), before.prepare(`SELECT * FROM "${table}" ORDER BY id`).all(), `${table} changed`);
assert.equal(db.prepare("SELECT count(*) AS n FROM revisions").get().n, revisions.length);
console.log(`Verified ${expected.length} menus and ${links} items: visible/parked links, column grouping and rendered header/footer preserved; all ${revisions.length} revisions, other pages and media verified.`);
db.close(); before.close();
