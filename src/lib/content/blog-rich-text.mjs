/** Convert the former blog composition blocks into native rich text.
 * Already migrated documents pass through unchanged, including inline marks,
 * images and tables. Unknown legacy sections fail rather than lose content.
 */
export function toBlogRichText(content) {
	if (content == null) return [];
	if (!Array.isArray(content)) throw new Error("Blog content must be an array");
	return content.flatMap((section, index) => {
		if (section._type && !section._type.startsWith("blog_post_")) return [section];
		const type = section.type ?? section._type?.slice("blog_post_".length);
		const key = section._key ?? `content-${index + 1}`;
		const span = (text, suffix) => ({ _type: "span", _key: `${key}-${suffix}`, text, marks: [] });
		const block = (text, style = "normal", suffix = "text") => ({
			_type: "block", _key: suffix === "text" ? key : `${key}-${suffix}`,
			style, markDefs: [], children: [span(text ?? "", suffix)],
		});
		// A paragraph's `links` mark the first occurrence of each link's text.
		const linked = (text = "", links = []) => {
			const markDefs = [], children = [];
			let rest = text, n = 0;
			for (const link of links) {
				const at = rest.indexOf(link.text);
				if (at < 0) throw new Error(`Blog link text "${link.text}" is not in its paragraph`);
				const mark = `${key}-link-${++n}`;
				// External links open in a new tab, as on the old site.
				markDefs.push({ _type: "link", _key: mark, href: link.href, ...(link.href.startsWith("http") ? { blank: true } : {}) });
				if (at > 0) children.push(span(rest.slice(0, at), `text-${n}`));
				children.push({ ...span(link.text, `link-${n}`), marks: [mark] });
				rest = rest.slice(at + link.text.length);
			}
			if (rest || !children.length) children.push(span(rest, `text-${n + 1}`));
			return { _type: "block", _key: key, style: "normal", markDefs, children };
		};
		switch (type) {
			case "lead":
			case "p": return [section.links?.length ? linked(section.text, section.links) : block(section.text)];
			case "h2":
			case "h3": return [block(section.text, type)];
			case "quote": return [block(section.text, "blockquote")];
			case "ul": return (section.items ?? []).map((item, i) => ({
				...block(typeof item === "string" ? item : item.value, "normal", `item-${i + 1}`),
				listItem: "bullet", level: 1,
			}));
			case "statrow": {
				const stats = section.stats ?? [];
				if (!stats.length) return [];
				return [{
					_type: "table", _key: key, hasHeaderRow: true,
					rows: ["label", "value"].map((field, ri) => ({
						_key: `${key}-row-${ri + 1}`,
						cells: stats.map((stat, ci) => ({
							_key: `${key}-cell-${ri + 1}-${ci + 1}`,
							_type: "tableCell", isHeader: ri === 0, colspan: 1, rowspan: 1,
							content: [span(stat[field] ?? "", `cell-${ri + 1}-${ci + 1}`)],
						})),
					})),
				}];
			}
			default: throw new Error(`Unsupported legacy blog section: ${type}`);
		}
	});
}
