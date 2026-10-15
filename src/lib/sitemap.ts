/** A sitemap `<lastmod>` element (W3C date), or nothing when the date is unknown. */
export function lastmod(date: Date | string | undefined): string {
  const d = date ? new Date(date) : undefined;
  return d && !isNaN(d.getTime()) ? `<lastmod>${d.toISOString().slice(0, 10)}</lastmod>` : '';
}
