// Remove audited unused fields locally, without reseeding populated content.
// Dry run by default; --apply backs up D1 and commits schema/data atomically.
import { DatabaseSync, backup } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { externalMedia } from "../src/lib/content/media.mjs";

const { values } = parseArgs({ options: { database: { type: "string" }, apply: { type: "boolean", default: false } } });
if (!values.database || !existsSync(values.database)) throw new Error("Use --database <existing SQLite file> [--apply]");
const seed = JSON.parse(readFileSync(new URL("../seed/seed.json", import.meta.url), "utf8"));
const specs = JSON.parse(readFileSync(new URL("../src/content/specs.json", import.meta.url), "utf8"));
const path = resolve(values.database);
const db = new DatabaseSync(path, { readOnly: !values.apply });
const blockDefs = new Map(seed.blockTypes.map((b) => [b.slug, b]));
const blockSpecs = new Map();
function register(spec) {
	for (const f of spec.fields) {
		if (f.kind === "repeater") register(f.item);
		if (f.kind === "blocks") for (const type of Object.values(f.types)) { blockSpecs.set(type.blockType, type.spec); register(type.spec); }
	}
}
for (const page of Object.values(specs.pages)) for (const part of Object.values(page.parts)) {
	blockSpecs.set(part.blockType, part.spec); register(part.spec);
	for (const list of part.lists ?? []) { blockSpecs.set(list.blockType, list.spec); register(list.spec); }
}
for (const collection of Object.values(specs.collections)) register(collection.spec);
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
const jsonTypes = new Set(["image", "file", "blocks", "repeater", "portableText", "json"]);
function parseField(field, value) {
	if (value == null || typeof value !== "string" || !jsonTypes.has(field.type)) return value;
	try { return JSON.parse(value); } catch { if (["image", "file"].includes(field.type)) return value; throw new Error(`Invalid JSON in ${field.slug}`); }
}
function cleanBlocks(blocks) {
	return (blocks ?? []).filter((b) => b._type !== "industrial_salt_trusted_by").map((block) => {
		const target = blockDefs.get(block._type), spec = blockSpecs.get(block._type);
		if (!target || !spec) return block;
		const old = db.prepare("SELECT v.fields FROM _emdash_block_type_versions v JOIN _emdash_block_types b ON b.id=v.block_type_id WHERE b.slug=? AND v.version=?").get(block._type, block._version);
		if (!old) throw new Error(`Unknown stored block contract ${block._type}@${block._version}`);
		const nextFields = target.versions.find((v) => v.version === target.currentVersion).fields;
		return { ...cleanRecord(JSON.parse(old.fields), nextFields, spec, block), _version: target.currentVersion };
	});
}
function cleanRecord(oldFields, newFields, spec, data) {
	const next = { ...data };
	for (const old of oldFields) if (!newFields.some((f) => f.slug === old.slug)) delete next[old.slug];
	for (const field of newFields) {
		if (!Object.hasOwn(data, field.slug) || data[field.slug] == null) continue;
		const value = data[field.slug], old = oldFields.find((f) => f.slug === field.slug);
		const codec = spec?.fields.find((f) => f.slug === field.slug);
		if (field.type === "image") {
			const legacyAlt = codec?.legacyAltSlug ? data[codec.legacyAltSlug] : undefined;
			let media = externalMedia(parseField(field, value), "image", legacyAlt);
			if (codec?.renderAlt && typeof media?.alt !== "string") media = { ...media, alt: typeof legacyAlt === "string" ? legacyAlt : "" };
			next[field.slug] = media;
		} else if (field.type === "repeater") {
			next[field.slug] = value.map((row) => cleanRecord(old?.validation?.subFields ?? [], field.validation.subFields, codec?.item, row));
		} else if (field.type === "blocks") next[field.slug] = cleanBlocks(value);
	}
	return next;
}
function plan() {
	const blocks = [], fields = [], removedFields = [], entries = [], revisions = [];
	for (const block of seed.blockTypes) {
		const stored = db.prepare("SELECT * FROM _emdash_block_types WHERE slug=?").get(block.slug);
		if (!stored) throw new Error(`Missing block type ${block.slug}; apply earlier migrations first`);
		for (const version of block.versions) {
			const existing = db.prepare("SELECT fingerprint FROM _emdash_block_type_versions WHERE block_type_id=? AND version=?").get(stored.id, version.version);
			if (existing && existing.fingerprint !== fingerprint(version.fields)) throw new Error(`Immutable contract conflict ${block.slug}@${version.version}`);
		}
		if (stored.current_version !== block.currentVersion) blocks.push({ block, stored });
	}
	const oldFields = new Map();
	for (const collection of seed.collections) {
		const stored = db.prepare("SELECT id FROM _emdash_collections WHERE slug=?").get(collection.slug);
		const originals = db.prepare("SELECT * FROM _emdash_fields WHERE collection_id=? ORDER BY sort_order").all(stored.id).map((f) => ({ ...f, validation: f.validation ? JSON.parse(f.validation) : undefined }));
		oldFields.set(collection.slug, originals);
		for (const field of originals.filter((f) => !collection.fields.some((n) => n.slug === f.slug))) {
			if (!["products", "blogs"].includes(collection.slug) || !["image_alt", "hero_image_alt"].includes(field.slug)) throw new Error(`Unexpected removal ${collection.slug}.${field.slug}`);
			removedFields.push({ collection: collection.slug, field });
		}
		for (const field of collection.fields) {
			const old = originals.find((f) => f.slug === field.slug);
			if (!old || old.type !== field.type) throw new Error(`Unexpected field addition/type change ${collection.slug}.${field.slug}`);
			if (JSON.stringify(old.validation ?? null) !== JSON.stringify(field.validation ?? null)) fields.push({ id: old.id, field });
		}
		for (const row of db.prepare(`SELECT * FROM "ec_${collection.slug}"`).all()) {
			const data = Object.fromEntries(originals.map((f) => [f.slug, parseField(f, row[f.slug])]));
			const next = cleanRecord(originals, collection.fields, specs.collections[collection.slug]?.spec, data);
			const changes = collection.fields.map((f) => [f.slug, next[f.slug] && typeof next[f.slug] === "object" ? JSON.stringify(next[f.slug]) : next[f.slug]]).filter(([key, value]) => row[key] !== value);
			if (changes.length) entries.push({ collection: collection.slug, id: row.id, changes });
		}
	}
	for (const row of db.prepare("SELECT * FROM revisions").all()) {
		const collection = seed.collections.find((c) => c.slug === row.collection);
		if (!collection) continue;
		const next = JSON.stringify(cleanRecord(oldFields.get(row.collection), collection.fields, specs.collections[row.collection]?.spec, JSON.parse(row.data)));
		if (next !== row.data) revisions.push({ id: row.id, data: next });
	}
	return { blocks, fields, removedFields, entries, revisions };
}
try {
	let changes = plan();
	const summary = () => `${changes.blocks.length} block versions, ${changes.fields.length} field contracts, ${changes.removedFields.length} redundant collection fields, ${changes.entries.length} entries, ${changes.revisions.length} revisions`;
	if (!Object.values(changes).some((c) => c.length)) console.log("Already migrated; no changes.");
	else if (!values.apply) console.log(`Dry run: ${summary()}.`);
	else {
		const backupPath = `${path}.unused-fields-backup-${Date.now()}.sqlite`;
		await backup(db, backupPath); console.log(`Backup: ${backupPath}`);
		db.exec("BEGIN IMMEDIATE");
		try {
			changes = plan();
			for (const { block, stored } of changes.blocks) {
				for (const v of block.versions) db.prepare("INSERT OR IGNORE INTO _emdash_block_type_versions (id,block_type_id,version,fields,fingerprint) VALUES (?,?,?,?,?)").run(randomUUID(), stored.id, v.version, JSON.stringify(v.fields), fingerprint(v.fields));
				db.prepare("UPDATE _emdash_block_types SET current_version=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(block.currentVersion, stored.id);
			}
			for (const { id, field } of changes.fields) db.prepare("UPDATE _emdash_fields SET validation=? WHERE id=?").run(JSON.stringify(field.validation), id);
			for (const row of changes.entries) db.prepare(`UPDATE "ec_${row.collection}" SET ${row.changes.map(([key]) => `"${key}"=?`).join(",")}, version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(...row.changes.map(([,v]) => v), row.id);
			for (const row of changes.revisions) db.prepare("UPDATE revisions SET data=? WHERE id=?").run(row.data, row.id);
			for (const { collection, field } of changes.removedFields) {
				db.prepare("DELETE FROM _emdash_fields WHERE id=?").run(field.id);
				db.exec(`ALTER TABLE "ec_${collection}" DROP COLUMN "${field.slug}"`);
			}
			db.exec("COMMIT");
		} catch (error) { db.exec("ROLLBACK"); throw error; }
		console.log(`Migrated ${summary()}. Restart the dev server to refresh schema caches.`);
	}
} finally { db.close(); }
