// Menu names are stable template slots; labels and link order are CMS authored.
export const navigationMenus = {
	navbar: ["navbar_left", "navbar_right", "navbar_products"],
	footer: ["footer_navigation", "footer_legal"],
};

export function menusFromChrome(navbar, footer) {
	const links = (rows, title = "label") => rows.map((row) => ({ type: "custom", label: row[title], url: row.href }));
	return [
		{ name: "navbar_left", label: "Header — left", items: links(navbar.leftLinks) },
		{ name: "navbar_right", label: "Header — right", items: links(navbar.rightLinks) },
		{ name: "navbar_products", label: "Header — products", items: links(navbar.products, "title") },
		{ name: "navbar_left_parked", label: "Header — parked left links (not displayed)", items: links(navbar.leftLinksHidden) },
		{ name: "navbar_right_parked", label: "Header — parked right links (not displayed)", items: links(navbar.rightLinksHidden) },
		{ name: "footer_navigation", label: "Footer — columns", items: footer.columns.map((column) => ({
			type: "custom", label: column.title, url: "#", children: links(column.links),
		})) },
		{ name: "footer_legal", label: "Footer — legal", items: links(footer.legalLinks) },
	];
}

export function withNavigation(name, content, menus) {
	const items = (key) => menus[key]?.items ?? [];
	const link = (item) => ({ label: item.label, href: item.url,
		...(item.target ? { target: item.target } : {}), ...(item.titleAttr ? { titleAttr: item.titleAttr } : {}) });
	if (name === "navbar") return { ...content,
		leftLinks: items("navbar_left").map(link), rightLinks: items("navbar_right").map(link),
		products: items("navbar_products").map((item) => { const { label, ...rest } = link(item); return { title: label, ...rest }; }),
	};
	if (name === "footer") return { ...content,
		columns: items("footer_navigation").map((item) => ({ title: item.label, links: (item.children ?? []).map(link) })),
		legalLinks: items("footer_legal").map(link),
	};
	return content;
}
