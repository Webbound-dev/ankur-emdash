// Refresh migration/source/ from an ankur-data checkout, the content source
// of the old site, then regenerate with generate.mjs:
//
//   node migration/sync-ankur-data.mjs ../Ankur/ankur-data
//   node migration/generate.mjs && node migration/roundtrip.mjs
//
// Copies every page and collection file as-is. The navbar and footer links
// are the one exception: on this site they are EmDash menus, so they are moved
// out of navbar.json/footer.json into menus.json (see menusFromChrome).
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { menusFromChrome } from "../src/lib/content/navigation.mjs";

const from = process.argv[2];
if (!from || !existsSync(join(from, "pages")) || !existsSync(join(from, "collections"))) {
	throw new Error("Usage: node migration/sync-ankur-data.mjs <path to ankur-data checkout>");
}
const source = resolve(import.meta.dirname, "source");

for (const dir of ["pages", "collections"]) cpSync(join(from, dir), join(source, dir), { recursive: true });

const readJson = (file) => JSON.parse(readFileSync(join(source, file), "utf8"));
const writeJson = (file, value) => writeFileSync(join(source, file), `${JSON.stringify(value, null, 2)}\n`);

const navbar = readJson("pages/navbar.json");
const footer = readJson("pages/footer.json");
writeJson("menus.json", menusFromChrome(navbar, footer));

const NAVBAR_LINKS = ["leftLinks", "rightLinks", "_hiddenLinks_note", "leftLinksHidden", "rightLinksHidden", "products"];
const FOOTER_LINKS = ["columns", "legalLinks"];
const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
writeJson("pages/navbar.json", without(navbar, NAVBAR_LINKS));
writeJson("pages/footer.json", without(footer, FOOTER_LINKS));

console.log(`Synced ${from} into migration/source (menus rebuilt from navbar and footer links).`);
