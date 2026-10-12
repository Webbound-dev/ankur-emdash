// Use the installed Cloudflare runtime and Miniflare R2 implementation rather
// than manipulating its persistence files. Workerd test needs no listening port.
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

export async function storeLocalAssets({ assets, publicDirectory, persistenceDirectory, bucketName, workDirectory }) {
	const require = createRequire(import.meta.resolve("@astrojs/cloudflare"));
	const miniflare = require("miniflare");
	const runtimeRequire = createRequire(require.resolve("miniflare"));
	const dist = dirname(require.resolve("miniflare"));
	const options = { config: { env: { MEDIA: { type: "r2", name: bucketName } } }, dev: {} };
	const sharedOptions = { resourcePersistencePath: resolve(persistenceDirectory) };
	const services = await miniflare.R2_PLUGIN.getServices({ options, tmpPath: workDirectory, sharedOptions });
	const bindings = miniflare.R2_PLUGIN.getBindings(options, sharedOptions);
	services.push({ name: "loopback", worker: { compatibilityDate: "2026-01-01", modules: [
		{ name: "main.js", esModule: 'export default {fetch(){return new Response("ok")}};' },
	] } });
	services.push({ name: "source-assets", disk: { path: resolve(publicDirectory), writable: false } });
	services.push({ name: "import-assets", worker: {
		compatibilityDate: "2026-01-01",
		bindings: [...bindings, { name: "SOURCE", service: { name: "source-assets" } }, { name: "ASSETS", json: JSON.stringify(assets) }],
		modules: [{ name: "import.js", esModule: `
export default {async test(ctrl, env) {
  for (const asset of env.ASSETS) {
    const head = await env.MEDIA.head(asset.storageKey);
    if (!head) {
      const source = await env.SOURCE.fetch("http://assets" + asset.sourcePath);
      if (!source.ok) throw new Error("Cannot read asset: " + asset.sourcePath);
      const bytes = await source.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
      if (hash !== asset.sha256 || bytes.byteLength !== asset.size) throw new Error("Source changed: " + asset.sourcePath);
      await env.MEDIA.put(asset.storageKey, bytes, {httpMetadata: {contentType: asset.mimeType}});
    }
    const object = await env.MEDIA.get(asset.storageKey);
    if (!object || object.size !== asset.size || object.httpMetadata.contentType !== asset.mimeType) throw new Error("Invalid stored asset: " + asset.storageKey);
    const stored = await object.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", stored);
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    if (hash !== asset.sha256) throw new Error("Stored asset hash mismatch: " + asset.storageKey);
  }
  console.log("Verified " + env.ASSETS.length + " stored assets against their original bytes.");
}};` }],
	} });
	const config = { services, extensions: [{ modules: [
		{ name: "miniflare:shared", esModule: readFileSync(join(dist, "workers/shared/index.worker.js"), "utf8") },
		{ name: "miniflare:zod", esModule: readFileSync(join(dist, "workers/shared/zod.worker.js"), "utf8") },
	] }] };
	mkdirSync(workDirectory, { recursive: true });
	const configPath = join(workDirectory, "r2-import.bin");
	writeFileSync(configPath, miniflare.serializeConfig(config));
	execFileSync(runtimeRequire("workerd").default, ["test", "--binary", "--experimental", configPath, "import-assets"], {
		stdio: "inherit", timeout: 120_000,
	});
}
