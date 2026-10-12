// Reproduces Astro 5's whitespace behaviour inside the blog templates.
//
// Astro 5's compiler dropped whitespace-only text nodes and trimmed text inside
// `{...}`-heavy templates (e.g. "<span>6</span> <span>min read</span>" rendered as
// "6min read" on the live site). Astro 7 collapses to a single space instead, which
// changes inline spacing. Running this once on those templates strips the same
// whitespace in the source, so Astro 7 renders them exactly as the old site did.
//
//   node migration/normalize-whitespace.mjs src/ui/components/BlogDetail.astro ...
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const dir = path.resolve("node_modules/.pnpm/@astrojs+compiler-rs@0.5.1/node_modules/@astrojs/compiler-rs");
const { parse } = await import(path.join(dir, "dist/index.mjs"));

const KEEP = new Set(["pre", "textarea", "script", "style"]);

for (const file of process.argv.slice(2)) {
	const src = readFileSync(file, "utf8");
	const { ast } = await parse(src);
	const edits = [];
	(function walk(n, inKeep) {
		if (!n || typeof n !== "object") return;
		if (Array.isArray(n)) return n.forEach((c) => walk(c, inKeep));
		if (n.type === "JSXText" && !inKeep) {
			const raw = src.slice(n.start, n.end);
			const trimmed = raw.trim();
			if (trimmed !== raw) edits.push([n.start, n.end, trimmed]);
			return;
		}
		let keep = inKeep;
		if (n.type === "JSXElement") {
			const name = n.openingElement?.name?.name;
			if (name && KEEP.has(name)) keep = true;
		}
		for (const k of Object.keys(n)) if (k !== "frontmatter") walk(n[k], keep);
	})(ast.body, false);

	let out = src;
	for (const [s, e, v] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + v + out.slice(e);
	writeFileSync(file, out);
	console.log(`${file}: ${edits.length} text nodes trimmed`);
}
