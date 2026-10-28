// Apply seed/seed.json to the site's D1 database with EmDash's own seed logic
// (`emdash seed --on-conflict=update`, which only targets SQLite files):
// block types, collections, menus and the seed's entries are updated in
// place — content through a new revision that is then published — and
// missing entries are created. Entries the seed doesn't list (posts added in
// the admin), users, plugin settings and media are left alone.
//
//   node migration/apply-seed-d1.mjs                     # local dev database (.wrangler/state)
//   node migration/apply-seed-d1.mjs --remote --dry-run  # deployed database, rolled back: counts only
//   node migration/apply-seed-d1.mjs --remote            # deployed database
//   node migration/apply-seed-d1.mjs --remote --hindi-only   # only add the Hindi translations and menus
//
// --hindi-only leaves every English entry, menu and setting as it is (they
// may have been edited in the admin since the seed was made): it adds the
// seed's Hindi entries for English entries that exist, and the Hindi menus,
// and skips anything that already exists.
//
// Stop `astro dev` before running it locally. Before --remote, record a D1
// Time Travel bookmark (`wrangler d1 time-travel info ankur`) to restore from.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getPlatformProxy } from "wrangler";
import { Kysely } from "kysely";
import { i as RawBindingD1Dialect } from "../node_modules/@emdash-cms/cloudflare/dist/d1-dialect-CWVUKxi6.mjs";
import { t as applySeed } from "../node_modules/emdash/dist/apply-Cx48saFC.mjs";
import { n as validateSeed } from "../node_modules/emdash/dist/validate-BSZbSUDk.mjs";
import { n as claimExplicitSeedOwnership } from "../node_modules/emdash/dist/ownership-COPyVysP.mjs";

const { values } = parseArgs({ options: {
	remote: { type: "boolean", default: false },
	"dry-run": { type: "boolean", default: false },
	"hindi-only": { type: "boolean", default: false },
	"database-id": { type: "string", default: "378500c7-e695-4705-b96a-61f616c0ea7b" },
} });

// Entry slugs renamed in ankur-data since the database was seeded.
const RENAMED_SLUGS = { products: { "salt-plus": "dfs-salt" } };

const seed = JSON.parse(readFileSync(new URL("../seed/seed.json", import.meta.url), "utf8"));
const validation = validateSeed(seed);
for (const warning of validation.warnings) console.warn(`warning: ${warning}`);
if (!validation.valid) throw new Error(`Invalid seed:\n${validation.errors.join("\n")}`);

// Only the DB binding is needed. Locally it matches wrangler.jsonc (no id), so
// it opens the same .wrangler/state database as `astro dev`; remotely it needs
// the database id.
const configPath = join(mkdtempSync(join(tmpdir(), "apply-seed-")), "wrangler.json");
writeFileSync(configPath, JSON.stringify({
	name: "apply-seed", compatibility_date: "2026-02-24", compatibility_flags: ["nodejs_compat"],
	d1_databases: [values.remote
		? { binding: "DB", database_name: "ankur", database_id: values["database-id"], remote: true }
		: { binding: "DB", database_name: "ankur" }],
}));
const proxy = await getPlatformProxy({
	configPath,
	persist: { path: fileURLToPath(new URL("../.wrangler/state/v3", import.meta.url)) },
	remoteBindings: values.remote,
});
const binding = proxy.env.DB;

const db = new Kysely({ dialect: new RawBindingD1Dialect({ database: binding }) });
const where = values.remote ? "REMOTE (deployed) database" : "local database";
const count = async (sql) => (await binding.prepare(sql).first()).n;
console.log(`Target: ${where}`);
console.log(`blogs before: ${await count("SELECT count(*) AS n FROM ec_blogs WHERE deleted_at IS NULL")}`);

if (values["hindi-only"]) {
	// Each Hindi entry with its English source (which is skipped: the seed
	// needs it to link the translation), for English entries that exist.
	const hindiSeed = { ...seed, settings: undefined, content: {}, menus: [] };
	console.log(`Hindi only${values["dry-run"] ? " (dry run: nothing is written)" : ""}:`);
	for (const [collection, entries] of Object.entries(seed.content ?? {})) {
		const rows = (await binding.prepare(`SELECT slug, locale FROM ec_${collection} WHERE deleted_at IS NULL`).all()).results;
		const english = new Set(rows.filter((r) => (r.locale ?? "en") === "en").map((r) => r.slug));
		const hindiThere = new Set(rows.filter((r) => r.locale === "hi").map((r) => r.slug));
		const sources = new Map(entries.filter((e) => !e.locale && english.has(e.slug)).map((e) => [e.id, e]));
		const hindi = entries.filter((e) => e.locale === "hi" && sources.has(e.translationOf));
		if (!hindi.length) continue;
		hindiSeed.content[collection] = hindi.flatMap((h) => [sources.get(h.translationOf), h]);
		const there = hindi.filter((h) => hindiThere.has(h.slug)).length;
		console.log(`  ${collection}: ${hindi.length - there} Hindi entries to add${there ? `, ${there} already there (left as is)` : ""}`);
	}
	// English menus stay out (applying a menu replaces its items), so the
	// Hindi menus aren't linked to them as translations; pages find them by
	// name and locale.
	hindiSeed.menus = seed.menus.filter((m) => m.locale === "hi").map(({ translationOf, ...menu }) => menu);
	console.log(`  menus: ${hindiSeed.menus.map((m) => m.name).join(", ")} (Hindi; items replaced if they exist)`);
	if (!values["dry-run"]) {
		const result = await applySeed(db, hindiSeed, { includeContent: true, onConflict: "skip" });
		console.log("Applied:", JSON.stringify({ menus: result.menus, content: result.content }));
	}
	await db.destroy();
	await proxy.dispose();
	process.exit(0);
}

if (values["dry-run"]) {
	console.log("Dry run: nothing is written. Entries the seed would create or update:");
	for (const [collection, entries] of Object.entries(seed.content ?? {})) {
		const rows = await binding.prepare(`SELECT slug FROM ec_${collection} WHERE deleted_at IS NULL`).all();
		const existing = new Set(rows.results.map((r) => r.slug));
		for (const [from, to] of Object.entries(RENAMED_SLUGS[collection] ?? {})) if (existing.delete(from)) existing.add(to);
		const create = entries.filter((e) => !existing.has(e.slug)).map((e) => e.slug);
		const untouched = [...existing].filter((s) => !entries.some((e) => e.slug === s));
		console.log(`  ${collection}: ${entries.length - create.length} update, ${create.length} create${create.length ? ` (${create.join(", ")})` : ""}${untouched.length ? `; not in seed, left as is: ${untouched.join(", ")}` : ""}`);
	}
	console.log(`  menus: ${seed.menus.map((m) => m.name).join(", ")} (items replaced)`);
	console.log(`  block types: ${seed.blockTypes.length}, collections: ${seed.collections.length}`);
} else {
	// Slugs ankur-data renamed: move the existing entry to the new slug so the
	// seed updates it in place instead of creating a second one.
	for (const [collection, renames] of Object.entries(RENAMED_SLUGS)) {
		for (const [from, to] of Object.entries(renames)) {
			const taken = await binding.prepare(`SELECT 1 FROM ec_${collection} WHERE slug = ?`).bind(to).first();
			const { meta } = taken ? { meta: { changes: 0 } }
				: await binding.prepare(`UPDATE ec_${collection} SET slug = ? WHERE slug = ? AND deleted_at IS NULL`).bind(to, from).run();
			console.log(`${collection}: ${from} → ${to}: ${meta.changes ? "renamed" : taken ? "already exists" : "not found"}`);
		}
	}
	// The seed carries the full new value of every blocks field it updates, but
	// EmDash validates it against the stored blocks with the same _key:
	// - a block type that gained fields has a new version, and an update may
	//   only change a stored block's version through an explicit migration,
	//   which the seed update doesn't do: move those stored blocks to the
	//   current version first (their new fields are optional);
	// - seed keys are positional, so a section inserted in ankur-data (e.g. a
	//   product's FAQ before "Where to buy") reuses a key for another block
	//   type: drop that stored block, and the seed adds it as a new one.
	const currentVersion = new Map(seed.blockTypes.map((b) => [b.slug, b.currentVersion]));
	for (const collection of seed.collections) {
		const blockFields = collection.fields.filter((f) => f.type === "blocks").map((f) => f.slug);
		const entries = new Map((seed.content?.[collection.slug] ?? []).map((e) => [e.slug, e]));
		for (const field of blockFields) {
			const rows = (await binding.prepare(`SELECT id, slug, ${field} AS v FROM ec_${collection.slug} WHERE deleted_at IS NULL`).all()).results;
			for (const row of rows) {
				const entry = entries.get(row.slug);
				const stored = row.v ? JSON.parse(row.v) : null;
				if (!entry || !Array.isArray(stored)) continue;
				const incoming = new Map((entry.data?.[field] ?? []).map((b) => [b._key, b._type]));
				let bumped = 0, dropped = 0;
				const next = stored.flatMap((b) => {
					if (incoming.has(b._key) && incoming.get(b._key) !== b._type) { dropped++; return []; }
					const to = currentVersion.get(b._type);
					if (to && b._version < to) { bumped++; return [{ ...b, _version: to }]; }
					return [b];
				});
				if (!bumped && !dropped) continue;
				await binding.prepare(`UPDATE ec_${collection.slug} SET ${field} = ? WHERE id = ?`).bind(JSON.stringify(next), row.id).run();
				console.log(`${collection.slug}/${row.slug}.${field}: ${bumped} moved to the current version, ${dropped} replaced by another block type`);
			}
		}
	}
	await claimExplicitSeedOwnership(db, seed);
	const result = await applySeed(db, seed, { includeContent: true, onConflict: "update" });
	console.log("Applied:", JSON.stringify({
		blockTypes: result.blockTypes, collections: result.collections, fields: result.fields,
		menus: result.menus, content: result.content,
	}));
	console.log(`blogs after: ${await count("SELECT count(*) AS n FROM ec_blogs WHERE deleted_at IS NULL")}`);
}
await db.destroy();
await proxy.dispose();
