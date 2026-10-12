// Local D1 cleanup: state-only distributor records and the unused Network UI.
// --apply creates a full backup. Duplicate published states are soft-deleted;
// all revision IDs/publication pointers and historical block contracts remain.
import { DatabaseSync, backup } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createHash, randomUUID } from "node:crypto";

const { values } = parseArgs({ options: { database: { type: "string" }, apply: { type: "boolean", default: false } } });
if (!values.database || !existsSync(values.database)) throw new Error("Use --database <existing SQLite file> [--apply]");
const seed = JSON.parse(readFileSync(new URL("../seed/seed.json", import.meta.url), "utf8"));
const distributorSchema = seed.collections.find((c) => c.slug === "distributors");
const businessSchema = seed.collections.find((c) => c.slug === "business_pages").fields.find((f) => f.slug === "sections");
const hero = seed.blockTypes.find((b) => b.slug === "network_hero");
const removed = ["region", "state", "city", "address", "phone", "position"];
function fingerprint(fields) {
	function canonical(v) {
		if (Array.isArray(v)) return v.map(canonical);
		if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
		return v;
	}
	const contract = fields.map((f) => ({ slug: f.slug, type: f.type, required: f.required ?? false,
		...(f.defaultValue !== undefined ? { defaultValue: f.defaultValue } : {}),
		...(f.validation !== undefined ? { validation: f.validation } : {}),
		...(f.options !== undefined ? { options: f.options } : {}),
	}));
	return `block-type:v1:sha256:${createHash("sha256").update(JSON.stringify(canonical(contract))).digest("hex")}`;
}
function cleanDistributor(data) {
	const title = (data.state ?? data.title)?.trim();
	if (!title) throw new Error("Distributor has no state; cannot migrate safely");
	const next = { ...data, title };
	for (const key of removed) delete next[key];
	return next;
}
function cleanNetwork(sections) {
	return sections.filter((b) => b._type !== "network_directory").map((b) => {
		if (b._type !== "network_hero") return b;
		const next = { ...b, _version: hero.currentVersion };
		delete next.search_placeholder; delete next.search_button_label;
		return next;
	});
}
const path = resolve(values.database);
const db = new DatabaseSync(path, { readOnly: !values.apply });
function plan() {
	const collection = db.prepare("SELECT * FROM _emdash_collections WHERE slug='distributors'").get();
	const fields = db.prepare("SELECT * FROM _emdash_fields WHERE collection_id=?").all(collection.id);
	if (fields.some((f) => !["title", ...removed].includes(f.slug))) throw new Error("Unexpected custom distributor fields; migrate them explicitly first");
	const columns = db.prepare("PRAGMA table_info(ec_distributors)").all().map((c) => c.name);
	const rows = db.prepare(`SELECT * FROM ec_distributors ORDER BY ${columns.includes("position") ? "position," : ""} created_at,id`).all();
	const entries = rows.filter((row) => columns.includes("state") && row.title !== row.state?.trim()).map((row) => ({ id: row.id, title: cleanDistributor(row).title }));
	const seen = new Set(), duplicates = [];
	for (const row of rows) {
		if (row.deleted_at || row.status !== "published") continue;
		const state = (columns.includes("state") ? row.state : row.title)?.trim();
		if (!state) throw new Error(`Missing state on ${row.slug}`);
		const key = `${row.locale}:${state.toLowerCase()}`;
		if (seen.has(key)) duplicates.push(row.id); else seen.add(key);
	}
	const revisions = [];
	for (const row of db.prepare("SELECT * FROM revisions WHERE collection IN ('distributors','business_pages')").all()) {
		const data = JSON.parse(row.data);
		let next;
		if (row.collection === "distributors") next = cleanDistributor(data);
		else {
			const entry = db.prepare("SELECT slug FROM ec_business_pages WHERE id=?").get(row.entry_id);
			if (entry?.slug !== "network") continue;
			next = { ...data, sections: cleanNetwork(data.sections ?? []) };
		}
		if (JSON.stringify(next) !== row.data) revisions.push({ id: row.id, data: JSON.stringify(next) });
	}
	const network = db.prepare("SELECT * FROM ec_business_pages WHERE slug='network'").get();
	const sections = JSON.stringify(cleanNetwork(JSON.parse(network.sections)));
	const storedHero = db.prepare("SELECT * FROM _emdash_block_types WHERE slug='network_hero'").get();
	for (const version of hero.versions) {
		const stored = db.prepare("SELECT fingerprint FROM _emdash_block_type_versions WHERE block_type_id=? AND version=?").get(storedHero.id, version.version);
		if (stored && stored.fingerprint !== fingerprint(version.fields)) throw new Error("Network hero contract conflict");
	}
	const sectionsField = db.prepare("SELECT f.* FROM _emdash_fields f JOIN _emdash_collections c ON c.id=f.collection_id WHERE c.slug='business_pages' AND f.slug='sections'").get();
	const titleField = fields.find((f) => f.slug === "title");
	const schemaChanged = fields.length !== 1 || titleField.label !== "State" || collection.label !== distributorSchema.label || storedHero.current_version !== hero.currentVersion || sectionsField.validation !== JSON.stringify(businessSchema.validation);
	return { collection, titleField, sectionsField, storedHero, schemaChanged, dropColumns: removed.filter((c) => columns.includes(c)), entries, duplicates, revisions, network: sections === network.sections ? null : { id: network.id, sections } };
}
try {
	let changes = plan();
	const count = () => `${changes.entries.length} distributor titles, ${changes.duplicates.length} duplicate states, ${changes.network ? 1 : 0} Network entry, ${changes.revisions.length} revisions, ${changes.dropColumns.length} removed columns`;
	if (!changes.schemaChanged && !changes.dropColumns.length && !changes.entries.length && !changes.duplicates.length && !changes.revisions.length && !changes.network) console.log("Already migrated; no changes.");
	else if (!values.apply) console.log(`Dry run: ${count()}.`);
	else {
		const backupPath = `${path}.distributor-states-backup-${Date.now()}.sqlite`;
		await backup(db, backupPath); console.log(`Backup: ${backupPath}`);
		db.exec("BEGIN IMMEDIATE");
		try {
			changes = plan();
			for (const row of changes.entries) db.prepare("UPDATE ec_distributors SET title=?, version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(row.title, row.id);
			for (const id of changes.duplicates) db.prepare("UPDATE ec_distributors SET deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(id);
			for (const row of changes.revisions) db.prepare("UPDATE revisions SET data=? WHERE id=?").run(row.data, row.id);
			if (changes.network) db.prepare("UPDATE ec_business_pages SET sections=?, version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(changes.network.sections, changes.network.id);
			db.prepare("DELETE FROM _emdash_fields WHERE collection_id=? AND slug<>'title'").run(changes.collection.id);
			db.prepare("UPDATE _emdash_fields SET label='State', required=1, sort_order=0 WHERE id=?").run(changes.titleField.id);
			db.prepare("UPDATE _emdash_collections SET label=?, label_singular=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(distributorSchema.label, distributorSchema.labelSingular, changes.collection.id);
			for (const column of changes.dropColumns) db.exec(`ALTER TABLE ec_distributors DROP COLUMN "${column}"`);
			for (const version of hero.versions) db.prepare("INSERT OR IGNORE INTO _emdash_block_type_versions (id,block_type_id,version,fields,fingerprint) VALUES (?,?,?,?,?)").run(randomUUID(), changes.storedHero.id, version.version, JSON.stringify(version.fields), fingerprint(version.fields));
			db.prepare("UPDATE _emdash_block_types SET current_version=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(hero.currentVersion, changes.storedHero.id);
			db.prepare("UPDATE _emdash_fields SET validation=? WHERE id=?").run(JSON.stringify(businessSchema.validation), changes.sectionsField.id);
			db.exec("COMMIT");
		} catch (error) { db.exec("ROLLBACK"); throw error; }
		console.log(`Migrated ${count()}. Duplicate records are in trash; restart the dev server.`);
	}
} finally { db.close(); }
