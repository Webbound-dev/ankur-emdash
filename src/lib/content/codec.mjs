// Lossless converter between the original Ankur page/collection JSON and
// EmDash's flat block/field storage. A "spec" (see migration/infer.mjs) records,
// for every leaf of the original object, which EmDash field holds it; decode()
// rebuilds the exact original shape from that, so the UI components keep
// receiving byte-identical props.
//
// Pure ESM, no dependencies: runs both in the migration scripts (Node) and in
// the deployed Worker.

/** @typedef {{kind:'scalar',path:string[],slug:string,type:string,optional?:boolean}} ScalarField */
/** @typedef {{kind:'strlist',path:string[],slug:string,optional?:boolean}} StrListField */
/** @typedef {{kind:'strlines',path:string[],slug:string,sep:string,optional?:boolean}} StrLinesField */
/** @typedef {{kind:'objlines',path:string[],slug:string,keys:string[],sep:string,lineSep:string,optional?:boolean}} ObjLinesField */
/** @typedef {{kind:'repeater',path:string[],slug:string,item:RecordSpec,optional?:boolean}} RepeaterField */
/** @typedef {{kind:'blocks',path:string[],slug:string,discriminator:string,types:Record<string,{blockType:string,spec:RecordSpec}>,optional?:boolean}} BlocksField */
/** @typedef {{kind:'synthetic',slug:string}} SyntheticField */
/** @typedef {{fields:(ScalarField|StrListField|StrLinesField|ObjLinesField|RepeaterField|BlocksField|SyntheticField)[]}} RecordSpec */

import { toBlogRichText } from "./blog-rich-text.mjs";
import { externalMedia, mediaUrl } from "./media.mjs";

export const BLOCK_VERSION = 1;

/** Insert `key: value` into a plain object at a given position (keeps original key order). */
function withKeyAt(obj, key, value, index) {
	const entries = Object.entries(obj);
	entries.splice(Math.min(index ?? 0, entries.length), 0, [key, value]);
	return Object.fromEntries(entries);
}

function getAt(obj, path) {
	let cur = obj;
	for (const k of path) {
		if (cur == null || typeof cur !== "object") return undefined;
		cur = cur[k];
	}
	return cur;
}

function setAt(obj, path, value) {
	let cur = obj;
	for (let i = 0; i < path.length - 1; i++) {
		const k = path[i];
		if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
		cur = cur[k];
	}
	cur[path[path.length - 1]] = value;
}

/** Original object -> EmDash field data (record level: block, repeater row or entry). */
export function encodeRecord(spec, obj) {
	const out = {};
	for (const f of spec.fields) {
		if (f.kind === "synthetic") continue;
		const v = getAt(obj, f.path);
		if (v === undefined) continue;
		switch (f.kind) {
			case "media":
				out[f.slug] = externalMedia(v, f.type, getAt(obj, f.altPath));
				break;
			case "portableText":
				out[f.slug] = toBlogRichText(v);
				break;
			case "scalar":
				out[f.slug] = v;
				break;
			case "strlist":
				out[f.slug] = v.map((value) => ({ value }));
				break;
			case "strlines":
				out[f.slug] = v.join(f.sep);
				break;
			case "objlines":
				out[f.slug] = v.map((o) => f.keys.map((k) => o[k] ?? "").join(f.sep)).join(f.lineSep);
				break;
			case "repeater":
				out[f.slug] = v.map((row) => encodeRecord(f.item, row));
				break;
			case "blocks":
				out[f.slug] = v.map((item, i) => {
					const typeKey = item[f.discriminator];
					const t = f.types[typeKey];
					if (!t) throw new Error(`No block type for ${f.discriminator}=${typeKey}`);
					return {
						_type: t.blockType,
						_version: t.version ?? BLOCK_VERSION,
						_key: `${f.slug}-${i + 1}`,
						...encodeRecord(t.spec, item),
					};
				});
				break;
		}
	}
	return out;
}

/** EmDash field data -> original object. */
export function decodeRecord(spec, data) {
	const out = {};
	const d = data ?? {};
	for (const f of spec.fields) {
		if (f.kind === "synthetic") continue;
		const v = d[f.slug];
		switch (f.kind) {
			case "media":
				if (v == null && f.optional) break;
				setAt(out, f.path, mediaUrl(v));
				break;
			case "portableText":
				setAt(out, f.path, toBlogRichText(v));
				break;
			case "scalar":
				if (v === undefined || v === null) {
					if (!f.optional) setAt(out, f.path, f.type === "string" || f.type === "text" ? "" : undefined);
				} else setAt(out, f.path, v);
				break;
			case "strlist":
				if ((v == null || v.length === 0) && f.optional) break;
				setAt(out, f.path, (v ?? []).map((r) => r.value));
				break;
			case "strlines":
				if ((v == null || v === "") && f.optional) break;
				setAt(out, f.path, v ? String(v).split(f.sep) : []);
				break;
			case "objlines":
				if ((v == null || v === "") && f.optional) break;
				setAt(
					out,
					f.path,
					v
						? String(v)
								.split(f.lineSep)
								.map((line) => {
									const parts = line.split(f.sep);
									const o = {};
									f.keys.forEach((k, i) => {
										o[k] = parts[i] ?? "";
									});
									return o;
								})
						: [],
				);
				break;
			case "repeater":
				if ((v == null || v.length === 0) && f.optional) break;
				setAt(out, f.path, (v ?? []).map((row) => decodeRecord(f.item, row)));
				break;
			case "blocks": {
				if ((v == null || v.length === 0) && f.optional) break;
				const byBlockType = {};
				for (const [typeKey, t] of Object.entries(f.types)) byBlockType[t.blockType] = [typeKey, t.spec];
				setAt(
					out,
					f.path,
					(v ?? []).map((b) => {
						const hit = byBlockType[b._type];
						if (!hit) return null;
						return withKeyAt(decodeRecord(hit[1], b), f.discriminator, hit[0], f.types[hit[0]].discIndex);
					}).filter(Boolean),
				);
				break;
			}
		}
	}
	// The picker's per-use alt text takes priority over a legacy text field.
	for (const f of spec.fields) if (f.kind === "media" && f.type === "image" && typeof d[f.slug]?.alt === "string" && (f.renderAlt || getAt(out, f.altPath) !== undefined)) setAt(out, f.altPath, d[f.slug].alt);
	return out;
}

/**
 * Page spec (one per pages/<name>.json):
 *   { name, order:[topLevelKeys], parts:{ key: { mode:'object'|'wrap'|'main', blockType, spec, keys? } } }
 * - object: top-level object -> one block
 * - wrap:   top-level array/scalar -> one block holding it under `value`
 * - main:   all top-level scalars gathered into one block
 */
export function encodePage(pageSpec, json) {
	const sections = [];
	for (const key of pageSpec.order) {
		const part = pageSpec.parts[key];
		if (part.mode === "main") {
			const sub = {};
			for (const k of part.keys) if (json[k] !== undefined) sub[k] = json[k];
			sections.push({ _type: part.blockType, _version: part.version ?? BLOCK_VERSION, _key: key, ...encodeRecord(part.spec, sub) });
		} else if (part.mode === "wrap") {
			sections.push({
				_type: part.blockType,
				_version: part.version ?? BLOCK_VERSION,
				_key: key,
				...encodeRecord(part.spec, { value: json[key] }),
			});
		} else {
			sections.push({ _type: part.blockType, _version: part.version ?? BLOCK_VERSION, _key: key, ...encodeRecord(part.spec, json[key]) });
		}
		for (const list of part.lists ?? []) {
			for (const [i, item] of (getAt(json[key], list.path) ?? []).entries()) sections.push({
				_type: list.blockType, _version: list.version ?? BLOCK_VERSION,
				_key: `${key}-${list.path.join("-")}-${i + 1}`, ...encodeRecord(list.spec, item),
			});
		}
	}
	return sections;
}

export function decodePage(pageSpec, sections) {
	const byType = {};
	for (const s of sections ?? []) byType[s._type] = s;
	const out = {};
	for (const key of pageSpec.order) {
		const part = pageSpec.parts[key];
		const block = byType[part.blockType];
		if (!block) continue;
		if (part.mode === "main") Object.assign(out, decodeRecord(part.spec, block));
		else if (part.mode === "wrap") out[key] = decodeRecord(part.spec, block).value;
		else {
			const legacy = part.legacySpec && (block._version ?? 1) < (part.version ?? 1);
			out[key] = decodeRecord(legacy ? part.legacySpec : part.spec, block);
			if (!legacy) for (const list of part.lists ?? []) setAt(out[key], list.path,
				(sections ?? []).filter((s) => s._type === list.blockType).map((s) => decodeRecord(list.spec, s)));
			// Preserve the source object's key order for migration parity.
			if (part.lists?.length) {
				const ordered = {};
				for (const f of (part.legacySpec ?? part.spec).fields) {
					const k = f.path?.[0]; if (k && k in out[key]) ordered[k] = out[key][k];
				}
				out[key] = { ...ordered, ...out[key] };
			}
		}
	}
	if (!pageSpec.keyOrder) return out;
	const ordered = {};
	for (const k of pageSpec.keyOrder) if (k in out) ordered[k] = out[k];
	return ordered;
}

/** Collection entry (products/blogs/distributors): data -> original item. */
export function decodeEntry(collSpec, entry) {
	const data = entry.data ?? entry;
	const item = decodeRecord(collSpec.spec, data);
	if (!collSpec.slugKey) return item;
	return withKeyAt(item, collSpec.slugKey, entry.slug ?? entry.id ?? data.slug, collSpec.slugIndex);
}

export function encodeEntry(collSpec, item, position) {
	const data = encodeRecord(collSpec.spec, item);
	if (collSpec.includePosition !== false) data.position = position;
	return { slug: String(item[collSpec.slugKey]), data };
}
