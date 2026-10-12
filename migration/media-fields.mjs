// Explicit migration for local EmDash/D1 SQLite. Defaults to a dry run;
// --apply backs up the entire database and updates schema, entries and revisions
// in one transaction. Retains old block versions and all publication metadata.
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
const samePath = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const parseMedia = (value) => {
	if (typeof value === "string" && value.startsWith("{")) {
		const parsed = JSON.parse(value);
		if (parsed && typeof parsed === "object" && ("id" in parsed || "src" in parsed)) return parsed;
	}
	return value;
};

function migrateRecord(spec, input) {
	const out = { ...input };
	for (const field of spec.fields) {
		if (!Object.hasOwn(out, field.slug)) continue;
		const value = out[field.slug];
		if (field.kind === "media") {
			const altField = spec.fields.find((f) => samePath(f.path, field.altPath));
			out[field.slug] = externalMedia(parseMedia(value), field.type, altField ? out[altField.slug] : undefined);
		} else if (field.kind === "repeater") {
			out[field.slug] = (value ?? []).map((row) => migrateRecord(field.item, row));
		} else if (field.kind === "blocks") {
			out[field.slug] = (value ?? []).map((block) => {
				const type = Object.values(field.types).find((t) => t.blockType === block._type);
				return type ? { ...migrateRecord(type.spec, block), _version: type.version ?? block._version } : block;
			});
		}
	}
	return out;
}

function migrateSections(pageSpec, sections) {
	return (sections ?? []).flatMap((block) => {
		const part = Object.values(pageSpec.parts).find((p) => p.blockType === block._type);
		if (!part) {
			const list = Object.values(pageSpec.parts).flatMap((p) => p.lists ?? []).find((l) => l.blockType === block._type);
			return [list ? { ...migrateRecord(list.spec, block), _version: list.version } : block];
		}
		const out = { ...migrateRecord(part.spec, block), _version: part.version };
		const promoted = [];
		for (const list of part.lists ?? []) {
			const oldField = part.legacySpec?.fields.find((f) => samePath(f.path, list.path));
			if (!oldField || !Object.hasOwn(out, oldField.slug)) continue;
			for (const [i, row] of (out[oldField.slug] ?? []).entries()) promoted.push({
				...migrateRecord(list.spec, row), _type: list.blockType, _version: list.version,
				_key: `${block._key}-${list.path.join("-")}-${i + 1}`,
			});
			delete out[oldField.slug];
		}
		return [out, ...promoted];
	});
}

// Match EmDash's canonical block contract fingerprint (labels aren't contracts).
function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
	return value;
}
function fingerprint(fields) {
	const contract = fields.map((f) => ({ slug: f.slug, type: f.type, required: f.required ?? false,
		...(f.defaultValue !== undefined ? { defaultValue: f.defaultValue } : {}),
		...(f.validation !== undefined ? { validation: f.validation } : {}),
		...(f.options !== undefined ? { options: f.options } : {}),
	}));
	return `block-type:v1:sha256:${createHash("sha256").update(JSON.stringify(canonical(contract))).digest("hex")}`;
}

function plan() {
	const blocks = [];
	for (const block of seed.blockTypes) {
		const existing = db.prepare("SELECT id, current_version FROM _emdash_block_types WHERE slug = ?").get(block.slug);
		const current = block.versions.find((v) => v.version === block.currentVersion);
		if (!existing) {
			// Only the newly introduced repeatable media item types are created.
			if (!Object.values(specs.pages).some((p) => Object.values(p.parts).some((part) => part.lists?.some((l) => l.blockType === block.slug)))) continue;
			blocks.push({ block, existing: null });
			continue;
		}
		const stored = db.prepare("SELECT fingerprint FROM _emdash_block_type_versions WHERE block_type_id = ? AND version = ?").get(existing.id, block.currentVersion);
		if (stored) {
			if (stored.fingerprint !== fingerprint(current.fields)) throw new Error(`Schema conflict for ${block.slug} version ${block.currentVersion}; migration aborted`);
			if (existing.current_version !== block.currentVersion) blocks.push({ block, existing });
		} else {
			const legacy = block.versions.find((v) => v.version === existing.current_version);
			const active = db.prepare("SELECT fingerprint FROM _emdash_block_type_versions WHERE block_type_id = ? AND version = ?").get(existing.id, existing.current_version);
			if (!legacy || active.fingerprint !== fingerprint(legacy.fields)) throw new Error(`Existing ${block.slug} schema differs from the retained contract`);
			blocks.push({ block, existing });
		}
	}
	const fields = [];
	for (const collection of seed.collections) {
		const existing = db.prepare("SELECT id FROM _emdash_collections WHERE slug = ?").get(collection.slug);
		if (!existing) throw new Error(`Missing collection ${collection.slug}`);
		for (const field of collection.fields) {
			const stored = db.prepare("SELECT * FROM _emdash_fields WHERE collection_id = ? AND slug = ?").get(existing.id, field.slug);
			if (!stored) throw new Error(`Missing field ${collection.slug}.${field.slug}`);
			if (["image", "file"].includes(field.type) && stored.type !== field.type) {
				if (!["string", "text"].includes(stored.type)) throw new Error(`Unexpected field type for ${collection.slug}.${field.slug}`);
				fields.push({ id: stored.id, field });
			}
			if (field.type === "blocks" && JSON.stringify(JSON.parse(stored.validation ?? "{}")) !== JSON.stringify(field.validation ?? {})) fields.push({ id: stored.id, field });
		}
	}
	const entries = [];
	const migrateData = (collection, slug, data) => {
		const pageSpec = specs.pages[slug];
		if (pageSpec?.collection === collection) return { ...data, sections: migrateSections(pageSpec, data.sections) };
		if (specs.collections[collection]) return migrateRecord(specs.collections[collection].spec, data);
		return data;
	};
	for (const collection of seed.collections) {
		const rows = db.prepare(`SELECT * FROM "ec_${collection.slug}"`).all();
		for (const row of rows) {
			const data = {};
			for (const field of collection.fields) {
				const value = row[field.slug];
				data[field.slug] = ["blocks", "repeater", "portableText", "json"].includes(field.type) && typeof value === "string" ? JSON.parse(value) : value;
			}
			const migrated = migrateData(collection.slug, row.slug, data);
			const changes = [];
			for (const field of collection.fields) {
				const value = migrated[field.slug];
				const stored = value && typeof value === "object" ? JSON.stringify(value) : value;
				if (stored !== row[field.slug]) changes.push([field.slug, stored]);
			}
			if (changes.length) entries.push({ collection: collection.slug, id: row.id, changes });
		}
	}
	const revisions = [];
	for (const revision of db.prepare("SELECT * FROM revisions").all()) {
		if (!seed.collections.some((c) => c.slug === revision.collection)) continue;
		const row = db.prepare(`SELECT slug FROM "ec_${revision.collection}" WHERE id = ?`).get(revision.entry_id);
		if (!row) continue;
		const next = JSON.stringify(migrateData(revision.collection, row.slug, JSON.parse(revision.data)));
		if (next !== revision.data) revisions.push({ id: revision.id, data: next });
	}
	return { blocks, fields, entries, revisions };
}

try {
	let changes = plan();
	const describe = () => `${changes.blocks.length} block contracts, ${changes.fields.length} collection fields, ${changes.entries.length} entries, ${changes.revisions.length} revisions`;
	if (!Object.values(changes).some((rows) => rows.length)) console.log("Already migrated; no changes.");
	else if (!values.apply) console.log(`Dry run: ${describe()}.`);
	else {
		const backupPath = `${path}.media-backup-${Date.now()}.sqlite`;
		await backup(db, backupPath);
		console.log(`Backup: ${backupPath}`);
		db.exec("BEGIN IMMEDIATE");
		try {
			changes = plan();
			for (const { block, existing } of changes.blocks) {
				const id = existing?.id ?? randomUUID();
				if (!existing) db.prepare("INSERT INTO _emdash_block_types (id,slug,label,category,current_version,source) VALUES (?,?,?,?,?,'seed')").run(id, block.slug, block.label, block.category ?? null, block.currentVersion);
				for (const version of block.versions) db.prepare("INSERT OR IGNORE INTO _emdash_block_type_versions (id,block_type_id,version,fields,fingerprint) VALUES (?,?,?,?,?)").run(randomUUID(), id, version.version, JSON.stringify(version.fields), fingerprint(version.fields));
				db.prepare("UPDATE _emdash_block_types SET current_version = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(block.currentVersion, id);
			}
			for (const { id, field } of changes.fields) db.prepare("UPDATE _emdash_fields SET type = ?, column_type = ?, validation = ? WHERE id = ?").run(field.type, ["image", "file"].includes(field.type) ? "TEXT" : "JSON", field.validation ? JSON.stringify(field.validation) : null, id);
			for (const entry of changes.entries) {
				const columns = entry.changes.map(([key]) => `"${key}" = ?`).join(", ");
				db.prepare(`UPDATE "ec_${entry.collection}" SET ${columns}, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(...entry.changes.map(([, value]) => value), entry.id);
			}
			for (const revision of changes.revisions) db.prepare("UPDATE revisions SET data = ? WHERE id = ?").run(revision.data, revision.id);
			db.exec("COMMIT");
		} catch (error) { db.exec("ROLLBACK"); throw error; }
		console.log(`Migrated ${describe()}. Restart the dev server.`);
	}
} finally { db.close(); }
