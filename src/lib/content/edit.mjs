// Inline editing: apply one change, addressed by the original JSON path the
// components put in `data-cms-field` / `data-cms-link` / `data-cms-image`
// (e.g. "hero.slides[1].cta.href"), to an entry's stored EmDash data.
//
// The change is made on the decoded (original-shape) object and re-encoded
// with the codec. Only stored values whose encoding actually changed are
// replaced, so everything else, including media-library references that the
// original shape only knows as URLs, is written back untouched.
//
// Pure ESM, no dependencies: shared by the browser editor and Node checks.

import { decodeEntry, decodePage, encodePage, encodeRecord } from "./codec.mjs";

export class EditError extends Error {}

/** "hero.slides[1].cta.href" -> ["hero", "slides", 1, "cta", "href"]; "[0].title" -> [0, "title"] */
export function parsePath(path) {
	const out = [];
	for (const part of String(path).split(".")) {
		const re = /([^[\]]+)|\[(\d+)\]/g;
		let m;
		while ((m = re.exec(part))) out.push(m[1] !== undefined ? m[1] : Number(m[2]));
	}
	return out;
}

export function getPath(obj, path) {
	let cur = obj;
	for (const k of path) {
		if (cur == null || typeof cur !== "object") return undefined;
		cur = cur[k];
	}
	return cur;
}

function setPath(obj, path, value) {
	let cur = obj;
	for (let i = 0; i < path.length - 1; i++) {
		if (cur[path[i]] == null || typeof cur[path[i]] !== "object") throw new EditError(`Nothing is stored at "${path.slice(0, i + 1).join(".")}"`);
		cur = cur[path[i]];
	}
	cur[path[path.length - 1]] = value;
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function deepEqual(a, b) {
	if (a === b) return true;
	if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const ka = Object.keys(a).filter((k) => a[k] !== undefined);
	const kb = Object.keys(b).filter((k) => b[k] !== undefined);
	return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}

/** Media values are replaced whole, never merged key by key. */
const isMedia = (v) => isObj(v) && ("provider" in v || "storageKey" in (v.meta ?? {}));

/**
 * Keep `raw` wherever `before` and `after` (two encodings of the same shape)
 * agree; take `after` where they differ.
 */
export function mergeChanged(raw, before, after) {
	if (deepEqual(before, after)) return raw;
	if (isMedia(after) || isMedia(before)) return after;
	if (isObj(before) && isObj(after) && isObj(raw)) {
		const out = { ...raw };
		for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
			if (after[k] === undefined) delete out[k];
			else out[k] = mergeChanged(raw[k], before[k], after[k]);
		}
		return out;
	}
	if (Array.isArray(before) && Array.isArray(after) && Array.isArray(raw) && before.length === after.length && raw.length === after.length) {
		return after.map((item, i) => mergeChanged(raw[i], before[i], item));
	}
	return after;
}

/**
 * Apply section-level changes to the stored sections array. The codec reads a
 * page part from the last block of its type and list items from every block
 * of their type in order (see decodePage), so blocks are matched the same way.
 */
function mergeSections(pageSpec, raw, before, after) {
	if (before.length !== after.length) {
		throw new EditError("This change adds or removes page items. Add or remove them in the admin instead.");
	}
	const partTypes = new Set(Object.values(pageSpec.parts).map((p) => p.blockType));
	const rawByType = {};
	raw.forEach((block, i) => (rawByType[block._type] ??= []).push(i));
	const seen = {};
	const out = [...raw];
	after.forEach((block, i) => {
		const n = (seen[block._type] = (seen[block._type] ?? -1) + 1);
		if (deepEqual(before[i], block)) return;
		const positions = rawByType[block._type] ?? [];
		const at = partTypes.has(block._type) ? positions.at(-1) : positions[n];
		if (at === undefined) throw new EditError("This section is not stored on the page yet. Edit it in the admin.");
		if ((out[at]._version ?? 1) !== block._version) {
			throw new EditError("This section uses an older format. Open it in the admin and save it once, then edit it here.");
		}
		out[at] = mergeChanged(out[at], before[i], block);
	});
	return out;
}

/** Replace the placeholder external media that encoding produced for an upload. */
function useUploadedMedia(value, url, media) {
	if (!media) return value;
	if (Array.isArray(value)) return value.map((v) => useUploadedMedia(v, url, media));
	if (!isObj(value)) return value;
	if (value.provider === "external" && value.src === url) return { ...media, ...(typeof value.alt === "string" && value.alt ? { alt: value.alt } : {}) };
	return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, useUploadedMedia(v, url, media)]));
}

/**
 * Decode an entry's stored data into the shape the components render.
 * scope: { kind: "page", spec } | { kind: "entry", spec, slug }
 */
export function decodeScoped(scope, data) {
	if (scope.kind === "page") return decodePage(scope.spec, data.sections);
	return decodeEntry(scope.spec, { slug: scope.slug, data });
}

/**
 * Compute the EmDash `data` patch for one edit.
 *   scope   page or entry spec (see decodeScoped)
 *   data    the entry's stored data, as returned by the content API
 *   path    original JSON path, as an array (parsePath)
 *   value   the new value (string, number, string list or list of objects)
 *   upload  optional { url, media }: `value` contains `url` for a newly
 *           picked media-library item, which is stored as `media`
 * Returns { patch, previous } or throws EditError. An empty patch means the
 * path is not stored in this entry (for example, it comes from a menu).
 */
export function computeEdit(scope, data, path, value, upload) {
	const decoded = decodeScoped(scope, data);
	const previous = getPath(decoded, path);
	if (previous === undefined) throw new EditError("This text isn't stored with this page. Edit it in the admin.");
	if (typeof previous === "number" && typeof value === "string") {
		const n = Number(value.trim());
		if (!Number.isFinite(n)) throw new EditError("This value must be a number.");
		value = n;
	}
	const next = clone(decoded);
	setPath(next, path, value);
	const finish = (v) => (upload ? useUploadedMedia(v, upload.url, upload.media) : v);
	const encode = (fn) => {
		try {
			return fn();
		} catch (e) {
			throw new EditError(`This value can't be changed here (${e.message}). Edit it in the admin.`);
		}
	};

	if (scope.kind === "page") {
		const before = encodePage(scope.spec, decoded);
		const after = finish(encode(() => encodePage(scope.spec, next)));
		const sections = mergeSections(scope.spec, data.sections ?? [], before, after);
		return { patch: deepEqual(sections, data.sections) ? {} : { sections }, previous };
	}

	const strip = (item) => {
		const { [scope.spec.slugKey]: _slug, ...rest } = item;
		return rest;
	};
	const before = encodeRecord(scope.spec.spec, strip(decoded));
	const after = finish(encode(() => encodeRecord(scope.spec.spec, strip(next))));
	const patch = {};
	for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (deepEqual(before[k], after[k])) continue;
		patch[k] = after[k] === undefined ? null : mergeChanged(data[k], before[k], after[k]);
	}
	return { patch, previous };
}
