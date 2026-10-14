// Proves inline editing is exact: for every string/number leaf of every page
// and collection entry in the seed, editing it through computeEdit() and
// decoding the patched data changes that leaf and nothing else.
//
//   node migration/check-inline-edit.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeEdit, decodeScoped, deepEqual, EditError } from "../src/lib/content/edit.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const seed = JSON.parse(readFileSync(join(root, "seed/seed.json"), "utf8"));
const specs = JSON.parse(readFileSync(join(root, "src/content/specs.json"), "utf8"));

function leaves(value, path = [], out = []) {
	if (Array.isArray(value)) value.forEach((v, i) => leaves(v, [...path, i], out));
	else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) leaves(v, [...path, k], out);
	else if (typeof value === "string" || typeof value === "number") out.push([path, value]);
	return out;
}

function edited(value, path, next) {
	const copy = JSON.parse(JSON.stringify(value));
	let cur = copy;
	for (const k of path.slice(0, -1)) cur = cur[k];
	cur[path.at(-1)] = next;
	return copy;
}

let checked = 0;
const refused = {};
const failures = [];
for (const [collection, entries] of Object.entries(seed.content)) {
	for (const entry of entries) {
		const scope = specs.pages[entry.slug]?.collection === collection
			? { kind: "page", spec: specs.pages[entry.slug] }
			: { kind: "entry", spec: specs.collections[collection], slug: entry.slug };
		if (!scope.spec) continue;
		const decoded = decodeScoped(scope, entry.data);
		for (const [path, value] of leaves(decoded)) {
			if (scope.kind === "entry" && path[0] === scope.spec.slugKey) continue;
			if (path[0] === "content" && collection === "blogs") continue; // Portable Text: edited in the admin
			const next = typeof value === "number" ? String(value + 1) : `${value} (edited)`;
			const label = `${collection}/${entry.slug}:${path.join(".")}`;
			try {
				const { patch } = computeEdit(scope, entry.data, path, next);
				const after = decodeScoped(scope, { ...entry.data, ...patch });
				const expected = edited(decoded, path, typeof value === "number" ? value + 1 : next);
				if (!deepEqual(after, expected)) failures.push(`${label}: decoded result differs`);
				checked++;
			} catch (e) {
				if (!(e instanceof EditError)) throw e;
				(refused[e.message] ??= []).push(label);
			}
		}
	}
}
console.log(`inline edits checked: ${checked}`);
for (const [message, labels] of Object.entries(refused)) {
	console.log(`refused ${labels.length}: ${message}\n  ${labels.slice(0, 8).join("\n  ")}${labels.length > 8 ? "\n  …" : ""}`);
}
if (failures.length) {
	console.log(failures.slice(0, 40).join("\n"));
	if (failures.length > 40) console.log(`… ${failures.length - 40} more`);
	process.exit(1);
}
