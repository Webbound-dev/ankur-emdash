// Reads Ankur content out of EmDash and hands the pages/components the exact
// same JSON shapes they received from ankur-data (see codec.mjs). Page and
// component code therefore stays unchanged.
import { getEmDashCollection, getEmDashEntry, getMenuWithCacheHint, getRequestContext, getSeoMeta } from "emdash";
import type { ContentSeo, SeoMeta } from "emdash";
import { navigationMenus, withNavigation } from "./navigation.mjs";
import { decodeEntry, decodePage } from "./codec.mjs";
import specs from "../../content/specs.json";

const pageSpecs = specs.pages as Record<string, any>;
const collectionSpecs = specs.collections as Record<string, any>;

// Inline editing (src/ui/lib/inlineEditor.ts). Components mark editable
// values with their path in the original JSON (`data-cms-field="hero.title"`).
// In EmDash's edit mode, cmsScope() wraps them with the entry those paths
// belong to, so the editor can save each change to the right entry. The
// reference is kept on the decoded object as a non-enumerable property:
// components still receive the original JSON shape.
const REF = Symbol("cms-ref");

interface CmsRef {
	scope: Record<string, unknown>;
	edit: unknown;
	/** The entry's SEO panel values (collections with SEO enabled). */
	seo?: ContentSeo;
	/** When the entry was last saved, for sitemap <lastmod>. */
	updatedAt?: Date;
}

function withRef<T>(content: T, ref: CmsRef): T {
	if (content && typeof content === "object") {
		Object.defineProperty(content, REF, { value: ref, enumerable: false });
	}
	return content;
}

const refOf = (content: unknown): CmsRef | undefined => (content as any)?.[REF];

/** When a page or entry from this module was last saved. */
export function lastModified(content: unknown): Date | undefined {
	return refOf(content)?.updatedAt;
}

/** True for an editor viewing the site with EmDash's edit mode switched on. */
export function isEditMode(): boolean {
	return getRequestContext()?.editMode === true;
}

/** A list of collection entries whose paths start with `prefix[index]`, e.g. `products[2].name` or `[0].title`. */
export function cmsList(prefix: string, entries: unknown[]) {
	const items = entries.map((entry) => refOf(entry)?.scope);
	return { kind: "list", prefix, items };
}

/**
 * Attributes for an element wrapping content rendered from these sources
 * (a page or entry from this module, or a cmsList()). Renders nothing outside
 * edit mode. The first page or entry also gets EmDash's entry annotation, so
 * the toolbar shows its draft status and Publish button.
 */
export function cmsScope(...sources: unknown[]): Record<string, string> {
	if (!isEditMode()) return {};
	const scopes = sources.map((source) => ((source as any)?.kind === "list" ? source : refOf(source)?.scope)).filter(Boolean);
	if (!scopes.length) return {};
	const main = sources.map(refOf).find(Boolean);
	return { ...(main ? { ...(main.edit as Record<string, string>) } : {}), "data-cms-scope": JSON.stringify(scopes) };
}

/** cmsScope() without the toolbar annotation, for shared regions such as the navbar and footer. */
export function cmsRegion(...sources: unknown[]): Record<string, string> {
	const { "data-emdash-ref": _ref, ...attrs } = cmsScope(...sources);
	return attrs;
}

/**
 * SEO for a page, product or post: values an editor set in the entry's SEO
 * panel, falling back to the defaults the page passes (its own SEO section).
 * Returns null when the panel is empty, so the page's defaults apply as-is.
 */
export function panelSeo(
	content: unknown,
	defaults: { title: string; description: string; siteUrl: string; path: string },
): SeoMeta | null {
	const seo = refOf(content)?.seo;
	if (!seo || !(seo.title || seo.description || seo.image || seo.canonical || seo.noIndex)) return null;
	return getSeoMeta({ data: { seo } }, {
		siteUrl: defaults.siteUrl,
		path: defaults.path,
		defaultTitle: defaults.title,
		defaultDescription: defaults.description,
	});
}

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
	return withRef(withNavigation(name, content, Object.fromEntries(menus), isEditMode()), {
		scope: { kind: "page", collection: spec.collection, id: (entry.data as any).id, name },
		edit: entry.edit,
		seo: (entry.data as any).seo,
		updatedAt: (entry.data as any).updatedAt,
	}) as T;
}

async function getAllEntries(collection: string) {
	const all: any[] = [];
	let cursor: string | undefined;
	do {
		const res = await getEmDashCollection(collection as any, { limit: 100, cursor });
		all.push(...res.entries);
		cursor = res.nextCursor;
	} while (cursor);
	// A preview link (`?_preview=…`) for an entry of this collection: the list
	// above already carries the draft of a published entry, but leaves out one
	// that was never published, so add that entry for this request only.
	const preview = getRequestContext()?.preview;
	if (preview?.collection === collection && !all.some((e) => e.id === preview.id || (e.data as any).id === preview.id)) {
		const { entry } = await getEmDashEntry(collection as any, preview.id);
		if (entry) all.push(entry);
	}
	return all.sort((a, b) => ((a.data as any).position ?? 0) - ((b.data as any).position ?? 0));
}

// In edit mode EmDash marks rich-text values so its <PortableText> renders
// them as an inline editor. Decoding copies the value, so carry the mark over.
const EMDASH_EDIT = Symbol.for("__emdash");

function keepRichTextEditing<T>(item: T, data: Record<string, unknown>): T {
	for (const [key, value] of Object.entries(data)) {
		const meta = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, EMDASH_EDIT) : undefined;
		const target = (item as any)?.[key];
		if (meta && target && typeof target === "object") Object.defineProperty(target, EMDASH_EDIT, meta);
	}
	return item;
}

async function getList<T = any>(collection: string): Promise<T[]> {
	const spec = collectionSpecs[collection];
	const entries = await getAllEntries(collection);
	return entries.map((e) =>
		withRef(keepRichTextEditing(decodeEntry(spec, { slug: (e.data as any).slug ?? e.id, data: e.data }), e.data as any), {
			scope: { kind: "entry", collection, id: (e.data as any).id, slug: (e.data as any).slug ?? e.id },
			edit: e.edit,
			seo: (e.data as any).seo,
			updatedAt: (e.data as any).updatedAt,
		}),
	) as T[];
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
