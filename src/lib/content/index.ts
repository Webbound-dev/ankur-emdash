// Reads Ankur content out of EmDash and hands the pages/components the exact
// same JSON shapes they received from ankur-data (see codec.mjs). Page and
// component code therefore stays unchanged.
import { getEmDashCollection, getEmDashEntry, getMenuWithCacheHint } from "emdash";
import { navigationMenus, withNavigation } from "./navigation.mjs";
import { decodeEntry, decodePage } from "./codec.mjs";
import specs from "../../content/specs.json";

const pageSpecs = specs.pages as Record<string, any>;
const collectionSpecs = specs.collections as Record<string, any>;

/** A page such as `home`, `about`, `navbar`, `footer` (pages/<name>.json). */
export async function getPage<T = any>(name: string, registerCacheHint?: (hint: any) => void): Promise<T> {
	const spec = pageSpecs[name];
	if (!spec) throw new Error(`No content spec for page "${name}"`);
	const { entry } = await getEmDashEntry(spec.collection as any, name);
	if (!entry) {
		throw new Error(`Page "${name}" is missing from EmDash. Has the seed been applied?`);
	}
	const content = decodePage(spec, (entry.data as any).sections);
	const menuNames = (navigationMenus as Record<string, string[]>)[name] ?? [];
	const menus = await Promise.all(menuNames.map(async (menuName) => {
		const { data, cacheHint } = await getMenuWithCacheHint(menuName);
		registerCacheHint?.(cacheHint);
		if (!data) throw new Error(`Menu "${menuName}" is missing. Apply the navigation migration.`);
		return [menuName, data];
	}));
	return withNavigation(name, content, Object.fromEntries(menus)) as T;
}

async function getAllEntries(collection: string) {
	const all: any[] = [];
	let cursor: string | undefined;
	do {
		const res = await getEmDashCollection(collection as any, { limit: 100, cursor });
		all.push(...res.entries);
		cursor = res.nextCursor;
	} while (cursor);
	return all.sort((a, b) => ((a.data as any).position ?? 0) - ((b.data as any).position ?? 0));
}

async function getList<T = any>(collection: string): Promise<T[]> {
	const spec = collectionSpecs[collection];
	const entries = await getAllEntries(collection);
	return entries.map((e) => decodeEntry(spec, { slug: (e.data as any).slug ?? e.id, data: e.data })) as T[];
}

export const getProducts = <T = any>() => getList<T>("products");
export const getBlogs = <T = any>() => getList<T>("blogs");
export const getDistributors = <T = any>() => getList<T>("distributors");

export async function getProduct<T = any>(slug: string): Promise<T | undefined> {
	return (await getProducts<T>()).find((p: any) => p.slug === slug);
}

export async function getBlog<T = any>(slug: string): Promise<T | undefined> {
	return (await getBlogs<T>()).find((p: any) => p.slug === slug);
}
