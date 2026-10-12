// Import public assets into the existing local CMS library and local R2 bucket.
// Dry run by default. --apply backs up D1, verifies R2 bytes, then commits all
// library records and current/revision media references in one DB transaction.
// Staging uses a persisted manifest so retries reuse the same storage keys.
import { DatabaseSync, backup } from "node:sqlite";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve, relative, join, extname, basename, dirname } from "node:path";
import { storeLocalAssets } from "./local-r2-assets.mjs";
import { imageMetadata } from "astro/assets/utils";

const { values } = parseArgs({ options: {
	database: { type: "string" }, apply: { type: "boolean", default: false },
	public: { type: "string", default: "public" },
	persistence: { type: "string", default: ".wrangler/state/v3" },
	bucket: { type: "string", default: "ankur-media" },
	manifest: { type: "string", default: ".wrangler/media-import/manifest.json" },
} });
if (!values.database || !existsSync(values.database)) throw new Error("Use --database <existing SQLite file> [--apply]");
const path = resolve(values.database);
const publicDirectory = resolve(values.public);
const manifestPath = resolve(values.manifest);
const require = createRequire(import.meta.resolve("emdash"));
const { ulid } = require("ulidx");
const mimeTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif", ".avif": "image/avif", ".pdf": "application/pdf", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg" };
const files = [];
function scan(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) scan(path);
		else if (entry.isFile() && mimeTypes[extname(entry.name).toLowerCase()]) files.push(path);
	}
}
scan(publicDirectory);
files.sort();
const db = new DatabaseSync(path, { readOnly: !values.apply });
try {
	const fields = db.prepare(`SELECT c.slug AS collection, f.slug, f.type FROM _emdash_fields f
		JOIN _emdash_collections c ON c.id = f.collection_id`).all();
	const collections = [...new Set(fields.map((f) => f.collection))];
	// Capture existing refs, including alt text, before copying any files.
	const references = new Map();
	function collect(value) {
		if (!value || typeof value !== "object") return;
		if (["external", "external-url"].includes(value.provider) && typeof value.src === "string" && value.src.startsWith("/")) {
			const existing = references.get(value.src);
			if (!existing || !existing.alt) references.set(value.src, { alt: value.alt ?? "" });
		}
		for (const child of Object.values(value)) if (child && typeof child === "object") collect(child);
	}
	for (const collection of collections) {
		for (const row of db.prepare(`SELECT * FROM "ec_${collection}"`).all()) for (const field of fields.filter((f) => f.collection === collection)) {
			if (["image", "file", "blocks", "repeater", "portableText", "json"].includes(field.type) && row[field.slug]) collect(JSON.parse(row[field.slug]));
		}
	}
	for (const row of db.prepare("SELECT data FROM revisions").all()) collect(JSON.parse(row.data));
	const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { assets: [] };
	if (previous.database && previous.database !== path) throw new Error("This manifest belongs to a different database; use another --manifest");
	if (previous.bucket && previous.bucket !== values.bucket) throw new Error("This manifest belongs to a different bucket");
	const byHash = new Map(db.prepare("SELECT * FROM media WHERE status = 'ready' AND content_hash IS NOT NULL").all().map((m) => [m.content_hash, m]));
	const assets = [];
	const byUrl = new Map();
	let duplicates = 0;
	for (const file of files) {
		const bytes = readFileSync(file);
		const sourcePath = `/${relative(publicDirectory, file).split("\\").join("/")}`;
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const contentHash = `sha1:${createHash("sha1").update(bytes).digest("hex")}`;
		const existing = byHash.get(contentHash);
		let asset = assets.find((a) => a.contentHash === contentHash);
		if (asset) duplicates++;
		else {
			const staged = previous.assets.find((a) => a.contentHash === contentHash);
			let dimensions = {};
			if (mimeTypes[extname(file).toLowerCase()].startsWith("image/")) {
				try { const size = await imageMetadata(bytes, sourcePath); dimensions = { width: size.width, height: size.height }; } catch { /* Unsupported image formats remain available. */ }
			}
			asset = { id: existing?.id ?? staged?.id ?? ulid(),
				storageKey: existing?.storage_key ?? staged?.storageKey ?? `${ulid()}${extname(file).toLowerCase()}`,
				sourcePath, filename: existing?.filename ?? basename(file), mimeType: mimeTypes[extname(file).toLowerCase()],
				size: bytes.length, sha256, contentHash, ...dimensions, alt: existing?.alt ?? references.get(sourcePath)?.alt ?? "",
				existing: Boolean(existing),
			};
			assets.push(asset);
		}
		byUrl.set(sourcePath, asset);
	}
	const missing = [...references.keys()].filter((url) => !byUrl.has(url));
	console.log(`${files.length} source files; ${assets.length} unique assets (${duplicates} duplicate files); ${assets.filter((a) => !a.existing).length} new library records.`);
	for (const url of missing) console.log(`Missing source, keeping reference: ${url}`);
	if (!values.apply) { console.log("Dry run only; nothing imported."); }
	else {
		const backupPath = `${path}.assets-backup-${Date.now()}.sqlite`;
		await backup(db, backupPath);
		console.log(`Backup: ${backupPath}`);
		mkdirSync(dirname(manifestPath), { recursive: true });
		writeFileSync(manifestPath, JSON.stringify({ database: path, bucket: values.bucket, assets, missing }, null, 2));
		// Storage is verified before any database reference is changed. Unique
		// keys are staged safely and are reused on retry if the DB commit fails.
		await storeLocalAssets({ assets, publicDirectory, persistenceDirectory: values.persistence, bucketName: values.bucket, workDirectory: dirname(manifestPath) });
		let changedReferences = 0, changedEntries = 0, changedRevisions = 0;
		function rewrite(value) {
			if (!value || typeof value !== "object") return value;
			if (Array.isArray(value)) return value.map(rewrite);
			const asset = ["external", "external-url"].includes(value.provider) ? byUrl.get(value.src ?? value.url) : undefined;
			if (asset) {
				changedReferences++;
				return { id: asset.id, provider: "local", filename: asset.filename, mimeType: asset.mimeType,
					...(typeof value.alt === "string" ? { alt: value.alt } : {}),
					...(asset.width ? { width: asset.width, height: asset.height } : {}),
					meta: { ...(value.meta ?? {}), storageKey: asset.storageKey },
				};
			}
			return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
		}
		db.exec("BEGIN IMMEDIATE");
		try {
			const insert = db.prepare(`INSERT INTO media (id,filename,mime_type,size,width,height,alt,storage_key,content_hash,status,created_at)
				VALUES (?,?,?,?,?,?,?,?,?,'ready',?)`);
			for (const asset of assets.filter((a) => !a.existing)) insert.run(asset.id, asset.filename, asset.mimeType, asset.size, asset.width ?? null, asset.height ?? null, asset.alt, asset.storageKey, asset.contentHash, new Date().toISOString());
			for (const collection of collections) {
				const mediaFields = fields.filter((f) => f.collection === collection && ["image", "file", "blocks", "repeater", "portableText", "json"].includes(f.type));
				for (const row of db.prepare(`SELECT * FROM "ec_${collection}"`).all()) {
					const changes = [];
					for (const field of mediaFields) {
						if (!row[field.slug]) continue;
						const next = JSON.stringify(rewrite(JSON.parse(row[field.slug])));
						if (next !== row[field.slug]) changes.push([field.slug, next]);
					}
					if (changes.length) {
						db.prepare(`UPDATE "ec_${collection}" SET ${changes.map(([key]) => `"${key}" = ?`).join(",")}, version = version + 1,
							updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(...changes.map(([,v]) => v), row.id);
						changedEntries++;
					}
				}
			}
			for (const row of db.prepare("SELECT id,data FROM revisions").all()) {
				const next = JSON.stringify(rewrite(JSON.parse(row.data)));
				if (next !== row.data) { db.prepare("UPDATE revisions SET data = ? WHERE id = ?").run(next, row.id); changedRevisions++; }
			}
			db.exec("COMMIT");
		} catch (error) { db.exec("ROLLBACK"); throw error; }
		console.log(`Imported and verified ${assets.length} library assets; updated ${changedReferences} media references in ${changedEntries} entries and ${changedRevisions} revisions.`);
		console.log("Original public files were retained. Restart the dev server to refresh the library.");
	}
} finally { db.close(); }
