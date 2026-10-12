// Offline migration for an existing EmDash SQLite database (including local D1).
// Restart the server afterwards to refresh schema/types. Writes are transactional.
// Defaults to a dry run. --apply creates a complete SQLite backup first.
// This explicit data migration is needed because the schema API cannot change
// blocks -> portableText in place, even though both use a JSON column.
import { DatabaseSync, backup } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { toBlogRichText } from "../src/lib/content/blog-rich-text.mjs";

const { values } = parseArgs({ options: {
	database: { type: "string" }, apply: { type: "boolean", default: false },
} });
if (!values.database || !existsSync(values.database)) {
	throw new Error("Use --database <existing SQLite file> [--apply]");
}
const path = resolve(values.database);
const db = new DatabaseSync(path, { readOnly: !values.apply });
try {
	const field = db.prepare(`SELECT f.id, f.type FROM _emdash_fields f
		JOIN _emdash_collections c ON c.id = f.collection_id
		WHERE c.slug = 'blogs' AND f.slug = 'content'`).get();
	if (!field || !["blocks", "portableText"].includes(field.type)) {
		throw new Error("Expected blogs.content to be blocks or portableText");
	}
	// Validate all content before the first write; unknown legacy blocks abort.
	const plan = () => {
		const entries = db.prepare("SELECT id, content FROM ec_blogs").all().map((row) => ({
			id: row.id, before: row.content, content: JSON.stringify(toBlogRichText(JSON.parse(row.content ?? "[]"))),
		}));
		const revisions = db.prepare("SELECT id, data FROM revisions WHERE collection = 'blogs'").all().map((row) => {
			const data = JSON.parse(row.data);
			if (Object.hasOwn(data, "content")) data.content = toBlogRichText(data.content);
			return { id: row.id, before: row.data, data: JSON.stringify(data) };
		});
		return { entries, revisions };
	};
	let changes = plan();
	if (field.type === "portableText" && changes.entries.every((r) => r.content === r.before) && changes.revisions.every((r) => r.data === r.before)) {
		console.log("Already migrated; no changes.");
	} else if (!values.apply) {
		console.log(`Dry run: ${changes.entries.length} posts and ${changes.revisions.length} revisions; blogs.content -> portableText.`);
	} else {
		const backupPath = `${path}.blog-backup-${Date.now()}.sqlite`;
		await backup(db, backupPath);
		console.log(`Backup: ${backupPath}`);
		db.exec("BEGIN IMMEDIATE");
		try {
			changes = plan();
			const updateEntry = db.prepare("UPDATE ec_blogs SET content = ?, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?");
			for (const row of changes.entries) if (row.content !== row.before) updateEntry.run(row.content, row.id);
			const updateRevision = db.prepare("UPDATE revisions SET data = ? WHERE id = ? AND collection = 'blogs'");
			for (const row of changes.revisions) if (row.data !== row.before) updateRevision.run(row.data, row.id);
			db.prepare(`UPDATE _emdash_fields SET type = 'portableText', column_type = 'JSON',
				label = 'Article', validation = NULL, widget = NULL, options = NULL, searchable = 1 WHERE id = ?`).run(field.id);
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
		console.log(`Migrated ${changes.entries.length} posts and ${changes.revisions.length} revisions. Restart the dev server.`);
	}
} finally {
	db.close();
}
