// Move local authored navigation to native menus. Never reseed existing entries.
import { DatabaseSync, backup } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { decodePage } from "../src/lib/content/codec.mjs";
import { menusFromChrome } from "../src/lib/content/navigation.mjs";

const { values } = parseArgs({ options: { database: { type: "string" }, "before-specs": { type: "string" }, apply: { type: "boolean", default: false } } });
if (!values.database || !existsSync(values.database) || !values["before-specs"]) throw new Error("Use --database <existing SQLite> --before-specs <original specs.json> [--apply]");
const path = resolve(values.database);
const db = new DatabaseSync(path, { readOnly: !values.apply });
const beforeSpecs = JSON.parse(readFileSync(values["before-specs"], "utf8"));
const seed = JSON.parse(readFileSync(new URL("../seed/seed.json", import.meta.url), "utf8"));
const schema = seed.collections.find((c) => c.slug === "site_chrome");
const validation = schema.fields.find((f) => f.slug === "sections").validation;
const removed = new Set(["navbar_left_links", "navbar_right_links", "navbar_products", "navbar_left_links_hidden", "navbar_right_links_hidden", "navbar_page", "footer_columns", "footer_legal_links"]);
const clean = (sections) => sections.filter((b) => !removed.has(b._type));

function plan() {
	const rows = db.prepare("SELECT * FROM ec_site_chrome ORDER BY slug").all();
	assert.equal(rows.length, 2, "Expected the two current chrome documents; inspect additional locales/entries before migrating");
	const navbar = rows.find((r) => r.slug === "navbar"), footer = rows.find((r) => r.slug === "footer");
	assert(navbar && footer && navbar.locale === footer.locale, "Missing matching header/footer");
	const entries = rows.flatMap((row) => {
		const sections = JSON.parse(row.sections), next = clean(sections);
		return JSON.stringify(next) !== JSON.stringify(sections) ? [{ row, sections: JSON.stringify(next) }] : [];
	});
	const menus = entries.length ? menusFromChrome(decodePage(beforeSpecs.pages.navbar, JSON.parse(navbar.sections)), decodePage(beforeSpecs.pages.footer, JSON.parse(footer.sections))) : [];
	if (entries.length) assert.equal(entries.length, 2, "Partially migrated chrome; inspect before proceeding");
	for (const menu of menus) assert(!db.prepare("SELECT id FROM _emdash_menus WHERE name=? AND locale=?").get(menu.name, navbar.locale), `Menu ${menu.name} already exists; refusing to overwrite edits`);
	if (!entries.length) for (const menu of seed.menus) assert(db.prepare("SELECT id FROM _emdash_menus WHERE name=? AND locale=?").get(menu.name, navbar.locale), `Missing migrated menu ${menu.name}`);
	const revisions = db.prepare("SELECT * FROM revisions WHERE collection='site_chrome'").all().flatMap((row) => {
		const data = JSON.parse(row.data), sections = data.sections, next = clean(sections);
		if (JSON.stringify(next) === JSON.stringify(sections)) return [];
		// Refuse to silently collapse different draft/historical link sets.
		const current = rows.find((r) => r.id === row.entry_id);
		assert(current, "Orphaned chrome revision");
		const navigationOnly = (blocks) => blocks.filter((b) => removed.has(b._type)).map(({ _key, ...block }) => block);
		assert.deepEqual(navigationOnly(sections), navigationOnly(JSON.parse(current.sections)), "A saved revision has different navigation; preserve/reconcile it before migrating");
		return [{ id: row.id, data: JSON.stringify({ ...data, sections: next }) }];
	});
	const field = db.prepare("SELECT f.* FROM _emdash_fields f JOIN _emdash_collections c ON c.id=f.collection_id WHERE c.slug='site_chrome' AND f.slug='sections'").get();
	return { menus, locale: navbar.locale, entries, revisions, field, schemaChange: JSON.stringify(JSON.parse(field.validation)) !== JSON.stringify(validation),
		labelChange: db.prepare("SELECT label FROM _emdash_collections WHERE slug='site_chrome'").get().label !== schema.label };
}

function insertItems(menuId, locale, items, parentId = null) {
	items.forEach((item, index) => {
		const id = randomUUID();
		db.prepare("INSERT INTO _emdash_menu_items (id,menu_id,parent_id,sort_order,type,custom_url,label,locale,translation_group) VALUES (?,?,?,?,?,?,?,?,?)")
			.run(id, menuId, parentId, index, "custom", item.url, item.label, locale, id);
		insertItems(menuId, locale, item.children ?? [], id);
	});
}
try {
	let changes = plan();
	const pending = () => changes.entries.length || changes.revisions.length || changes.schemaChange || changes.labelChange;
	const summary = () => `${changes.menus.length} menus, ${changes.entries.length} documents, ${changes.revisions.length} revisions`;
	if (!pending()) console.log("Already migrated; menus and content left unchanged.");
	else if (!values.apply) console.log(`Dry run: ${summary()}.`);
	else {
		const backupPath = `${path}.navigation-backup-${Date.now()}.sqlite`;
		await backup(db, backupPath); console.log(`Backup: ${backupPath}`);
		db.exec("BEGIN IMMEDIATE");
		try {
			changes = plan();
			for (const menu of changes.menus) {
				const id = randomUUID();
				db.prepare("INSERT INTO _emdash_menus (id,name,label,locale,translation_group) VALUES (?,?,?,?,?)").run(id, menu.name, menu.label, changes.locale, id);
				insertItems(id, changes.locale, menu.items);
			}
			for (const { row, sections } of changes.entries) db.prepare("UPDATE ec_site_chrome SET sections=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(sections, row.id);
			for (const row of changes.revisions) db.prepare("UPDATE revisions SET data=? WHERE id=?").run(row.data, row.id);
			db.prepare("UPDATE _emdash_fields SET validation=? WHERE id=?").run(JSON.stringify(validation), changes.field.id);
			db.prepare("UPDATE _emdash_collections SET label=?,label_singular=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug='site_chrome'").run(schema.label, schema.labelSingular);
			db.exec("COMMIT");
		} catch (error) { db.exec("ROLLBACK"); throw error; }
		console.log(`Migrated ${summary()}. Restart the dev server to refresh schema/menu caches.`);
	}
} finally { db.close(); }
