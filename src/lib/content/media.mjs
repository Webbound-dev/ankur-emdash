const IMAGE_EXT = /\.(avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i;
const FILE_EXT = /\.(pdf|docx?|xlsx?|csv|zip|mp4|webm|mov|mp3|wav|ogg)(?:[?#]|$)/i;

/** Infer asset fields, never ordinary navigation or embedded-video links. */
export function mediaFieldType(path, values) {
	const key = path.at(-1);
	const strings = values.filter((v) => typeof v === "string" && v);
	if (!strings.length) return null;
	if (["file", "certificateUrl", "downloadUrl", "documentUrl"].includes(key)) return "file";
	if (strings.every((v) => IMAGE_EXT.test(v) || FILE_EXT.test(v))) {
		return strings.some((v) => FILE_EXT.test(v)) ? "file" : "image";
	}
	if (["image", "logo", "photo", "poster", "thumbnail", "src"].includes(key) && strings.every((v) => v.startsWith("/images/"))) return "image";
	return null;
}

export function externalMedia(value, type, alt) {
	if (value == null || value === "") return null;
	if (typeof value === "object") return value;
	if (typeof value !== "string") throw new Error("Invalid media field value");
	const filename = value.split(/[?#]/)[0].split("/").at(-1) || "asset";
	return { id: "", provider: "external", src: value, filename,
		...(type === "file" ? { url: value } : { alt: alt ?? "" }),
	};
}

/** Pickers persist a provider reference, often without src/url. Resolve it
 * for the existing public components, which receive their original props.
 */
export function mediaUrl(value) {
	if (typeof value === "string") return value;
	if (!value) return "";
	if (value.provider === "external" || value.provider === "external-url") return value.src ?? value.url ?? value.previewUrl ?? "";
	const key = value.meta?.storageKey;
	if (key) {
		const segments = String(key).split("/");
		const encoded = segments.some((part) => !part || part === "." || part === "..")
			? encodeURIComponent(String(key)) : segments.map(encodeURIComponent).join("/");
		return `/_emdash/api/media/file/${encoded}`;
	}
	return value.src ?? value.url ?? value.previewUrl ?? (value.id ? `/_emdash/api/media/file/${encodeURIComponent(value.id)}` : "");
}
