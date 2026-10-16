// Compares the data each interactive component (astro-island) receives on the
// old Ankur site and this one, e.g. the distributor list, grades and forms.
//   node migration/compare-islands.mjs http://localhost:4500 http://localhost:4400
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { parseDocument } = require('htmlparser2');
const { DomUtils } = require('htmlparser2');
const [OLD, NEW] = process.argv.slice(2);
const host = (v) => typeof v === 'string' ? v.replace(/^https?:\/\/(localhost:\d+|ankurgroup\.in)/, '') : v;
// Astro serialises props as [type, value] pairs; turn them back into plain JSON.
const revive = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'number'
  ? (v[0] === 0 ? (v[1] && typeof v[1] === 'object' ? Object.fromEntries(Object.entries(v[1]).map(([k, x]) => [k, revive(x)])) : host(v[1])) : v[0] === 1 ? v[1].map(revive) : v[1])
  : v;
const flat = (o, p = '', out = {}) => { if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out); } else out[p] = o; return out; };
async function islands(base, path) {
  const doc = parseDocument(await (await fetch(base + path)).text());
  return DomUtils.findAll((e) => e.name === 'astro-island', doc.children).map((e) => {
    const name = (e.attribs['component-url'] ?? '').split('/').pop().replace(/\?.*$/, '').replace(/\.(tsx|jsx|ts)$/, '').replace(/\.[A-Za-z0-9_-]{8}\.js$/, '');
    let props = {}; try { props = revive([0, JSON.parse(e.attribs.props ?? '{}')]); } catch { props = { BAD: true }; }
    return { name, props: flat(props) };
  });
}
const sm = async (b, f) => [...(await (await fetch(`${b}/${f}`)).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
const paths = [...new Set([...(await sm(OLD, 'sitemap-pages.xml')), ...(await sm(OLD, 'sitemap-products.xml')), ...(await sm(OLD, 'sitemap-blog.xml'))])];
let clean = 0;
for (const p of paths) {
  const [o, n] = await Promise.all([islands(OLD, p), islands(NEW, p)]);
  const lines = [];
  const names = [...new Set([...o.map((i) => i.name), ...n.map((i) => i.name)])];
  for (const name of names) {
    const oi = o.filter((i) => i.name === name), ni = n.filter((i) => i.name === name);
    if (oi.length !== ni.length) { lines.push(`${name}: ${oi.length} on old, ${ni.length} on new`); continue; }
    oi.forEach((x, k) => {
      const y = ni[k].props;
      for (const key of new Set([...Object.keys(x.props), ...Object.keys(y)])) {
        if (/menuRef|cms|edit|_hiddenLinks_note|LinksHidden|transition-persist|data-astro-cid/i.test(key)) continue;
        if (x.props[key] !== y[key]) lines.push(`${name}.${key}: old=${JSON.stringify(x.props[key] ?? null)?.slice(0, 120)} new=${JSON.stringify(y[key] ?? null)?.slice(0, 120)}`);
      }
    });
  }
  if (!lines.length) clean++; else console.log(`\n=== ${p} (${lines.length})\n  ${lines.slice(0, 25).join('\n  ')}${lines.length > 25 ? `\n  … ${lines.length - 25} more` : ''}`);
}
console.log(`\n${paths.length} pages, ${clean} with identical component data`);
