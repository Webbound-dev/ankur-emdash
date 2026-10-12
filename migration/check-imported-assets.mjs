// Check imported library metadata and preservation of content against its backup.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { mediaUrl } from "../src/lib/content/media.mjs";

const { values } = parseArgs({ options: {
	database: { type: "string" }, before: { type: "string" }, manifest: { type: "string" },
} });
if (!values.database || !values.before || !values.manifest) throw new Error("Use --database <SQLite> --before <backup> --manifest <JSON>");
const db = new DatabaseSync(values.database, { readOnly: true });
const before = new DatabaseSync(values.before, { readOnly: true });
try {
	const manifest = JSON.parse(readFileSync(values.manifest, "utf8"));
	const library = new Map(db.prepare("SELECT * FROM media").all().map((row) => [row.id, row]));
	for (const asset of manifest.assets) {
		const row = library.get(asset.id);
		assert.ok(row, `Missing media ${asset.id}`);
		for (const [field, expected] of Object.entries({ storage_key: asset.storageKey, content_hash: asset.contentHash, size: asset.size, mime_type: asset.mimeType, status: "ready" })) assert.equal(row[field], expected);
	}
	let references = 0;
	function compare(original, current) {
		if (original && typeof original === "object" && ["external", "external-url"].includes(original.provider) && current?.provider === "local") {
			const row = library.get(current.id);
			assert.ok(row, "Content points at missing media");
			assert.equal(current.meta.storageKey, row.storage_key);
			assert.equal(current.alt, original.alt);
			assert.equal(mediaUrl(current), `/_emdash/api/media/file/${row.storage_key}`);
			references++;
			return;
		}
		if (!original || typeof original !== "object") { assert.deepEqual(current, original); return; }
		assert.deepEqual(Object.keys(current), Object.keys(original));
		for (const key of Object.keys(original)) compare(original[key], current[key]);
	}
	for (const collection of before.prepare("SELECT slug FROM _emdash_collections").all()) {
		const fields = before.prepare("SELECT f.slug, f.type FROM _emdash_fields f JOIN _emdash_collections c ON c.id=f.collection_id WHERE c.slug=?").all(collection.slug);
		const jsonFields = new Set(fields.filter((f) => ["image", "file", "blocks", "repeater", "portableText", "json"].includes(f.type)).map((f) => f.slug));
		const originals = before.prepare(`SELECT * FROM "ec_${collection.slug}"`).all();
		assert.equal(db.prepare(`SELECT count(*) AS n FROM "ec_${collection.slug}"`).get().n, originals.length);
		for (const original of originals) {
			const current = db.prepare(`SELECT * FROM "ec_${collection.slug}" WHERE id=?`).get(original.id);
			assert.ok(current);
			for (const key of Object.keys(original)) {
				if (["version", "updated_at"].includes(key)) continue;
				if (jsonFields.has(key) && original[key]) compare(JSON.parse(original[key]), JSON.parse(current[key]));
				else assert.deepEqual(current[key], original[key]);
			}
		}
	}
	const revisions = before.prepare("SELECT * FROM revisions").all();
	assert.equal(db.prepare("SELECT count(*) AS n FROM revisions").get().n, revisions.length);
	for (const original of revisions) {
		const current = db.prepare("SELECT * FROM revisions WHERE id=?").get(original.id);
		compare(JSON.parse(original.data), JSON.parse(current.data));
		delete original.data; delete current.data;
		assert.deepEqual(current, original);
	}
	assert.ok(db.prepare("SELECT count(*) AS n FROM _emdash_media_usage_work WHERE state='pending'").get().n > 0, "Usage indexing was not queued");
	console.log(`Verified ${manifest.assets.length} library records and ${references} migrated references; content, publication pointers and revision metadata preserved.`);
} finally { db.close(); before.close(); }
