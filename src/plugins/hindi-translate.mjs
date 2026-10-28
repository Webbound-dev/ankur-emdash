// Keeps the Hindi version of the site up to date: when an English page,
// product or blog post is published, its changed text is translated (Claude
// through OpenRouter, src/lib/hindi/translator.mjs) and published to the
// entry's Hindi translation; editors correct the Hindi directly in the admin.
// A new English entry gets a new Hindi translation.
//
// Publishing only queues the entry; a cron job translates one queued entry a
// minute, outside the editor's save request. Text whose English hasn't
// changed keeps its current Hindi, including edits made in the admin.
//
// The OpenRouter API key is set in the admin under Plugins → Hindi
// translation (stored encrypted). Menus are not covered: translate them with
// migration/hindi/translate.mjs or in the admin's menu translations.
import { definePlugin } from "emdash";
import specs from "../content/specs.json";
import styleGuide from "../lib/hindi/style-guide.md?raw";
import initialTranslations from "../lib/hindi/translations.json";
import {
	COLLECTIONS, DEFAULT_MODEL, LOCALE, applyText, createOpenRouterAsk, createTextRules,
	decodeLike, entryUnit, keepStored, pathKey, textAt, translateItems,
} from "../lib/hindi/translator.mjs";

export const HINDI_PLUGIN_ID = "hindi-translate";
export const HINDI_PLUGIN_VERSION = "1.0.0";
const CRON = "translate-queued";
const QUEUE = "queue:";
const LOCK = "lock";
// Longer than a page's translation and review take; a stale lock (a crashed
// run) expires after this.
const LOCK_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;

export const HINDI_SETTINGS_SCHEMA = {
	enabled: { type: "boolean", label: "Translate and publish Hindi when English content is published", default: true },
	openrouterApiKey: { type: "secret", label: "OpenRouter API key", description: "From openrouter.ai/keys. Stored encrypted." },
	model: { type: "string", label: "Model", description: "OpenRouter model id", default: DEFAULT_MODEL },
};

const rules = createTextRules(specs);

/**
 * What the current Hindi of an entry was translated from, per field: { [path]: { en, hi } }.
 * Starts from the bulk translation (translations.json) and is updated with
 * every draft this plugin writes.
 */
async function getState(ctx, unit, group) {
	return (await ctx.kv.get(`state:${unit.collection}:${group}`)) ?? initialTranslations[unit.key] ?? {};
}

async function getTerms(ctx) {
	const initial = Object.fromEntries(Object.values(initialTranslations.terms ?? {}).map(({ en, hi }) => [en, hi]));
	return { ...initial, ...((await ctx.kv.get("terms")) ?? {}) };
}

/** The Hindi translation of an entry: its row and its latest data (a pending draft, else live). */
async function getHindi(ctx, collection, id) {
	const { translations } = await ctx.content.getTranslations(collection, id);
	const summary = translations.find((t) => t.locale === LOCALE);
	if (!summary) return null;
	const item = await ctx.content.get(collection, summary.id);
	if (!item) return null;
	const draft = item.draftRevisionId ? await ctx.content.getRevision(collection, summary.id, item.draftRevisionId) : null;
	return { item, data: draft?.data ?? item.data };
}

async function translateEntry(ctx, collection, id) {
	const english = await ctx.content.get(collection, id);
	if (!english || (english.locale ?? "en") !== "en") return "not an English entry";
	const unit = entryUnit(specs, rules, collection, { slug: english.slug, data: english.data });
	if (!unit) return "no content spec";
	const group = english.translationGroup ?? english.id;
	const hindi = await getHindi(ctx, collection, english.id);
	const hindiJson = hindi ? decodeLike(unit, specs, { slug: english.slug, data: hindi.data }) : null;
	const state = await getState(ctx, unit, group);
	const terms = await getTerms(ctx);

	// Hindi for English text seen before, wherever it was.
	const known = new Map(Object.values(state).map(({ en, hi }) => [en, hi]));
	const result = new Map();
	const todo = [];
	for (const [path, en] of unit.strings) {
		const pk = pathKey(path);
		const current = path[0] === "@title" ? hindi?.data.title : hindiJson && textAt(hindiJson, path);
		// Unchanged English keeps the Hindi as it is now (it may have been
		// edited in the admin); changed or new English is translated.
		if (state[pk]?.en === en) result.set(pk, typeof current === "string" && current ? current : state[pk].hi);
		else if (known.has(en)) result.set(pk, known.get(en));
		else todo.push({ id: `t${todo.length + 1}`, path, en, pk });
	}
	const newTerms = [...new Set(unit.terms.map(([, en]) => en).filter((en) => !(en in terms)))];
	todo.push(...newTerms.map((en, i) => ({ id: `term${i + 1}`, path: ["term", en], en, term: true })));

	if (todo.length) {
		const ask = createOpenRouterAsk({
			fetch: (url, init) => ctx.http.fetch(url, init),
			apiKey: await ctx.settings.get("openrouterApiKey"),
			model: (await ctx.settings.get("model")) || DEFAULT_MODEL,
			styleGuide,
		});
		const translated = await translateItems(ask, unit.key, todo, { log: (m) => ctx.log.info(m) });
		for (const item of todo) {
			if (item.term) terms[item.en] = translated.get(item.id);
			else result.set(item.pk, translated.get(item.id));
		}
		if (newTerms.length) await ctx.kv.set("terms", terms);
	}

	const json = structuredClone(unit.json);
	let title;
	for (const [path] of unit.strings) {
		const hi = result.get(pathKey(path));
		if (path[0] === "@title") title = hi; else applyText(json, path, hi);
	}
	for (const [path, en] of unit.terms) applyText(json, path, terms[en]);
	const data = keepStored(english.data, unit.encode(unit.json), unit.encode(json));
	if (title !== undefined) data.title = title;

	if (hindi && Object.keys(data).every((k) => JSON.stringify(data[k]) === JSON.stringify(hindi.data[k]))) {
		return "Hindi already up to date";
	}
	const hindiId = hindi
		? (await ctx.content.update(collection, hindi.item.id, data)).id
		: (await ctx.content.create(collection, data, { locale: LOCALE, translationOf: english.id })).id;
	// Live straight away; editors correct the Hindi in the admin.
	const { _rev } = await ctx.content.getVersioned(collection, hindiId);
	await ctx.content.publish(collection, hindiId, { _rev });
	await ctx.kv.set(`state:${collection}:${group}`, Object.fromEntries(
		unit.strings.map(([path, en]) => [pathKey(path), { en, hi: result.get(pathKey(path)) }]),
	));
	return `Hindi ${hindi ? "updated" : "created"} and published (${todo.length} field${todo.length === 1 ? "" : "s"} translated)`;
}

async function runQueue(ctx) {
	const queued = (await ctx.kv.list(QUEUE)).sort((a, b) => String(a.value?.at).localeCompare(String(b.value?.at)));
	if (!queued.length) return;
	// One run at a time: a translation can outlast the one-minute schedule.
	const lock = await ctx.kv.getVersioned(LOCK);
	if (lock && Date.parse(lock.value) > Date.now()) return;
	const taken = await ctx.kv.compareAndSet(LOCK, lock?.revision ?? null, new Date(Date.now() + LOCK_MS).toISOString());
	if (!taken.applied) return;
	try {
		const { key, value } = queued[0];
		const [collection, id] = key.replace(QUEUE, "").split(":");
		try {
			const outcome = await translateEntry(ctx, collection, id);
			ctx.log.info(`${collection}/${id}: ${outcome}`);
			await ctx.kv.delete(key);
		} catch (error) {
			const attempts = (value?.attempts ?? 0) + 1;
			ctx.log.error(`${collection}/${id}: Hindi translation failed (attempt ${attempts}): ${error.message}`);
			if (attempts >= MAX_ATTEMPTS) await ctx.kv.delete(key);
			else await ctx.kv.set(key, { ...value, attempts });
		}
	} finally {
		await ctx.kv.delete(LOCK);
	}
}

export function createPlugin() {
	return definePlugin({
		id: HINDI_PLUGIN_ID,
		version: HINDI_PLUGIN_VERSION,
		capabilities: ["content:write", "content:publish", "content:revisions:read", "network:request"],
		allowedHosts: ["openrouter.ai"],
		admin: { settingsSchema: HINDI_SETTINGS_SCHEMA },
		hooks: {
			"plugin:activate": async (_event, ctx) => {
				await ctx.cron.schedule(CRON, { schedule: "* * * * *" });
			},
			"content:afterPublish": {
				// Queuing must never stop a publish.
				errorPolicy: "continue",
				handler: async (event, ctx) => {
					const { content, collection } = event;
					if (!COLLECTIONS.has(collection) || (content.locale ?? "en") !== "en") return;
					if ((await ctx.settings.get("enabled")) === false) return;
					await ctx.kv.set(`${QUEUE}${collection}:${content.id}`, { at: new Date().toISOString() });
					// Scheduled on activation; again here in case activation ran before this plugin existed.
					await ctx.cron.schedule(CRON, { schedule: "* * * * *" });
				},
			},
			cron: {
				timeout: LOCK_MS,
				errorPolicy: "continue",
				handler: async (event, ctx) => {
					if (event.name === CRON) await runQueue(ctx);
				},
			},
		},
	});
}

export default createPlugin;
