import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { decodeEntry, decodePage } from "../src/lib/content/codec.mjs";
import { externalMedia, mediaUrl, mediaFieldType } from "../src/lib/content/media.mjs";

const require = createRequire(import.meta.resolve("astro"));
const { build } = require("esbuild");
const load = async (entry) => {
	const bundle = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "esm", external: ["virtual:*"] });
	return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
};
const { generateFieldSchema } = await load("node_modules/emdash/src/schema/zod-generator.ts");
const { validateSeed } = await load("node_modules/emdash/src/seed/validate.ts");
const seed = JSON.parse(readFileSync("seed/seed.json", "utf8"));
const specs = JSON.parse(readFileSync("src/content/specs.json", "utf8"));
const validation = validateSeed(seed);
assert.equal(validation.valid, true, JSON.stringify(validation.errors));
const blocks = new Map(seed.blockTypes.map((b) => [b.slug, b]));
let images = 0, files = 0;
function validateRecord(fields, data) {
	for (const field of fields) {
		const value = data[field.slug];
		const result = generateFieldSchema(field).safeParse(value);
		assert.ok(result.success, `${field.slug}: ${result.success ? "" : JSON.stringify(result.error.issues)}`);
		if (field.type === "image" && value) images++;
		if (field.type === "file" && value) files++;
		if (field.type === "repeater") {
			assert.ok(!field.validation.subFields.some((f) => f.type === "file"), "file pickers cannot be repeater subfields");
			for (const row of value ?? []) validateRecord(field.validation.subFields, row);
		}
		if (field.type === "blocks") for (const block of value ?? []) {
			const type = blocks.get(block._type);
			assert.ok(type, block._type);
			const version = type.versions.find((v) => v.version === block._version);
			assert.ok(version, `${block._type} version ${block._version}`);
			validateRecord(version.fields, block);
		}
	}
}
for (const collection of seed.collections) for (const entry of seed.content[collection.slug]) validateRecord(collection.fields, entry.data);

// Simulate the values produced by the real media picker, which omits src/url
// for uploads and identifies the file through its storage key.
const upload = { id: "uploaded-image", provider: "local", alt: "Updated alt", meta: { storageKey: "uploaded-image.webp" } };
const blog = structuredClone(seed.content.blogs[0]);
blog.data.image = upload;
assert.equal(decodeEntry(specs.collections.blogs, blog).image, "/_emdash/api/media/file/uploaded-image.webp");
assert.equal(decodeEntry(specs.collections.blogs, blog).imageAlt, "Updated alt");
const home = structuredClone(seed.content.pages.find((p) => p.slug === "home"));
const factoryItem = home.data.sections.find((s) => s._type === "home_factory_video_items_item");
assert.ok(factoryItem, "video items have file fields outside repeaters");
factoryItem.src = { id: "video", provider: "local", meta: { storageKey: "factory-video.mp4" } };
assert.equal(decodePage(specs.pages.home, home.data.sections).factoryVideo.items[0].src, "/_emdash/api/media/file/factory-video.mp4");
assert.equal(mediaUrl(null), "");
assert.equal(mediaUrl(externalMedia("/documents/a.pdf", "file")), "/documents/a.pdf");
assert.equal(mediaUrl({ id: "abc", provider: "local" }), "/_emdash/api/media/file/abc");
assert.equal(mediaUrl({ id: "abc", meta: { storageKey: "../a.pdf" } }), "/_emdash/api/media/file/..%2Fa.pdf");
assert.equal(mediaFieldType(["url"], ["https://youtube.com/watch?v=abc"]), null);
assert.equal(mediaFieldType(["href"], ["/contact/"]), null);
assert.equal(mediaFieldType(["certificateUrl"], ["/images/certificate.jpeg"]), "file");
console.log(`OK: native EmDash validates the seed, ${images} image values and ${files} file values; uploaded images/videos resolve correctly; navigation and embeds stay links.`);
