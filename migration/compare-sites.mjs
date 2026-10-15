// Word-by-word, section-by-section comparison of the old Ankur site and this
// one: visible text, images (src + alt), links (href + target), form fields,
// head tags and JSON-LD, page by page from both sites' sitemaps.
//
// Run the old site locally from ankur-client with ankur-data and
// ankur-ui-components (same branch) in its content/ and ui-components/, then:
//   node migration/compare-sites.mjs http://localhost:4500 http://localhost:4400
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { parseDocument } = require('htmlparser2');
const { diffArrays } = require('diff');

const [OLD, NEW, ...only] = process.argv.slice(2);
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head']);
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&ldquo;|&rdquo;/g, '"').replace(/&lsquo;|&rsquo;/g, "'").replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…');
const host = (u) => (u ?? '').replace(/^https?:\/\/(localhost:\d+|ankurgroup\.in|ankur\.heetkv\.workers\.dev)/, '');

const BLOCK = new Set(['div','p','li','ul','ol','h1','h2','h3','h4','h5','h6','section','header','footer','nav','main','article','aside','br','tr','td','th','table','figure','figcaption','blockquote','button','label','form','dt','dd','picture']);
function items(html) {
  const doc = parseDocument(html, { decodeEntities: true });
  const out = []; let section = '(top)'; let buf = '';
  // Text is joined across inline tags (so "<b>6</b>min" stays one word) and
  // split at block boundaries, as a reader would see it.
  const flush = () => { for (const w of buf.replace(/\s+/g, ' ').trim().split(' ')) if (w) out.push({ v: w, section }); buf = ''; };
  const mark = (v) => { flush(); out.push({ v, section }); };
  const walk = (node) => {
    if (node.type === 'root') { for (const c of node.children ?? []) walk(c); return; }
    if (node.type === 'text') { buf += node.data; return; }
    if (node.type !== 'tag' || SKIP.has(node.name)) return;
    const a = node.attribs ?? {};
    const block = BLOCK.has(node.name);
    if (block) flush();
    const isSection = ['section', 'header', 'footer', 'nav', 'main', 'article', 'aside'].includes(node.name);
    const prev = section;
    if (isSection) section = `${node.name}#${a.id || a['aria-label'] || node.name}`;
    if (/^h[1-6]$/.test(node.name)) mark(`⟨${node.name}⟩`);
    if (node.name === 'img') mark(`⟨img ${host(a.src).split('?')[0]} alt="${a.alt ?? '∅'}"${a.srcset ? ' srcset=' + host(a.srcset) : ''}⟩`);
    if (node.name === 'source' && a.srcset) mark(`⟨source ${a.media ?? ''} ${host(a.srcset)}⟩`);
    if (node.name === 'video') mark(`⟨video ${host(a.src ?? '')} poster=${host(a.poster ?? '')}⟩`);
    if (node.name === 'iframe') mark(`⟨iframe ${host(a.src)}⟩`);
    if (node.name === 'a') mark(`⟨a ${host(a.href)}${a.target ? ' target=' + a.target : ''}⟩`);
    if (['input', 'textarea', 'select'].includes(node.name) && (a.placeholder || a.name)) mark(`⟨${node.name} ${a.name ?? ''} "${a.placeholder ?? ''}"⟩`);
    for (const c of node.children ?? []) walk(c);
    if (block) flush();
    if (isSection) { flush(); section = prev; }
  };
  walk(doc); flush();
  return out;
}

function head(html) {
  const h = html.split('</head>')[0];
  const metas = {};
  for (const m of h.matchAll(/<meta\s+([^>]+)>/g)) {
    const k = m[1].match(/(?:name|property)="([^"]+)"/)?.[1], v = m[1].match(/content="([^"]*)"/)?.[1];
    if (k && v !== undefined) metas[k] = host(decode(v));
  }
  metas.title = decode(h.match(/<title>([^<]*)/)?.[1] ?? '');
  metas.canonical = host(h.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? '');
  metas.preload = [...h.matchAll(/<link rel="preload" as="image" ([^>]*)>/g)].map((m) => `${host(m[1].match(/href="([^"]*)"/)?.[1])} ${m[1].match(/media="([^"]*)"/)?.[1] ?? ''}`).sort().join(' | ');
  for (const k of Object.keys(metas)) if (/viewport|charset|generator|astro|google-site|theme-color/.test(k)) delete metas[k];
  const ld = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return { BAD: m[1].slice(0, 80) }; } })
    .map((j) => JSON.parse(JSON.stringify(j, (k, v) => typeof v === 'string' ? host(v) : v)));
  return { metas, ld };
}

const flat = (o, p = '', out = {}) => { if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out); } else out[p] = o; return out; };

async function get(base, p) { const r = await fetch(base + p, { redirect: 'manual' }); return { status: r.status, location: r.headers.get('location'), html: r.status === 200 || r.status === 404 ? await r.text() : '' }; }

const sitemap = async (base) => {
  const out = [];
  for (const f of ['sitemap-pages.xml', 'sitemap-products.xml', 'sitemap-blog.xml']) {
    const x = await (await fetch(`${base}/${f}`)).text();
    out.push(...[...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname));
  }
  return out;
};
const paths = only.length ? only : [...new Set([...(await sitemap(OLD)), ...(await sitemap(NEW)), '/does-not-exist/'])];

let clean = 0; const report = [];
for (const p of paths) {
  const [o, n] = await Promise.all([get(OLD, p), get(NEW, p)]);
  const lines = [];
  if (o.status !== n.status) lines.push(`STATUS ${o.status}${o.location ? '→' + o.location : ''} vs ${n.status}${n.location ? '→' + n.location : ''}`);
  if (o.html && n.html) {
    const ho = head(o.html), hn = head(n.html);
    for (const k of new Set([...Object.keys(ho.metas), ...Object.keys(hn.metas)])) if (ho.metas[k] !== hn.metas[k]) lines.push(`HEAD ${k}: old=${JSON.stringify(ho.metas[k] ?? null)} new=${JSON.stringify(hn.metas[k] ?? null)}`);
    const byType = (ld) => Object.fromEntries(ld.map((j, i) => [`${j['@type']}${ld.filter((x, xi) => xi < i && x['@type'] === j['@type']).length || ''}`, flat(j)]));
    const lo = byType(ho.ld), ln = byType(hn.ld);
    for (const t of new Set([...Object.keys(lo), ...Object.keys(ln)])) {
      if (!lo[t] || !ln[t]) { lines.push(`JSON-LD ${t}: ${lo[t] ? 'only old' : 'only new'}`); continue; }
      for (const k of new Set([...Object.keys(lo[t]), ...Object.keys(ln[t])])) if (lo[t][k] !== ln[t][k]) lines.push(`JSON-LD ${t}.${k}: old=${JSON.stringify(lo[t][k] ?? null)} new=${JSON.stringify(ln[t][k] ?? null)}`);
    }
    const io = items(o.html), inn = items(n.html);
    const d = diffArrays(io.map((x) => x.v), inn.map((x) => x.v));
    let oi = 0, ni = 0;
    for (let i = 0; i < d.length; i++) {
      const part = d[i];
      if (!part.added && !part.removed) { oi += part.count; ni += part.count; continue; }
      const next = d[i + 1];
      const removed = part.removed ? part.value : [], added = part.added ? part.value : (next?.added ? next.value : []);
      if (part.removed && next?.added) i++;
      const sec = (part.removed ? io[oi] : inn[ni])?.section ?? '?';
      const ctx = io.slice(Math.max(0, oi - 6), oi).map((x) => x.v).join(' ');
      lines.push(`[${sec}] …${ctx}\n      OLD: ${removed.join(' ').slice(0, 400) || '∅'}\n      NEW: ${added.join(' ').slice(0, 400) || '∅'}`);
      oi += removed.length; ni += added.length;
    }
  }
  if (!lines.length) clean++; else report.push(`\n=== ${p} (${lines.length})\n  ${lines.join('\n  ')}`);
}
console.log(`${paths.length} pages, ${clean} identical`);
console.log(report.join('\n'));
