#!/usr/bin/env python3
"""Compare the migrated site's rendered HTML against the baseline static build of
the current site. Normalises build-specific noise (scoped-style hashes, hashed asset
filenames, island uids) so only genuine markup/content differences remain.

  python3 migration/compare-html.py <baseline_dist_dir> <base_url> [paths...]
"""
import sys, re, difflib, urllib.request, os, html


NONRENDER = set("""html head body div section main header footer nav ul ol li p h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr td th
form article aside figure figcaption blockquote details summary dl dt dd hr pre address fieldset legend br option optgroup
astro-island astro-slot template noscript script style link meta title
svg g defs path circle rect line polygon polyline lineargradient radialgradient stop clippath use text tspan filter mask pattern symbol ellipse
feturbulence fecolormatrix fegaussianblur feoffset feblend femerge femergenode fecomposite feflood""".split())

def _tags(line):
    return re.findall(r'<(/?)([a-zA-Z][a-zA-Z0-9-]*)|<!--', line), line

def _edge_tag(line, last):
    # returns lowercase tag name, 'comment', or None
    toks = list(re.finditer(r'<!--.*?-->|<(/?)([a-zA-Z][a-zA-Z0-9-]*)', line))
    if not toks: return None
    t = toks[-1] if last else toks[0]
    return 'comment' if t.group(0).startswith('<!--') else t.group(2).lower()

def drop_nonrendering_gaps(lines):
    out = []
    for i, ln in enumerate(lines):
        if ln.endswith('§') and i + 1 < len(lines):
            left = _edge_tag(ln, True); right = _edge_tag(lines[i + 1], False)
            if left in (None, 'comment') or right in (None, 'comment') or left in NONRENDER or right in NONRENDER:
                ln = ln[:-1]
        elif ln.endswith('§'):
            ln = ln[:-1]
        out.append(ln)
    return out

def norm(s):
    s = re.sub(r'(\d+\.\d{8})\d+', r'\1', s)  # float noise past 8 decimals (Node vs workerd trig)
    s = s.replace('&#38;', '&').replace('&#x26;', '&').replace('&amp;', '&').replace('&apos;', '&#39;').replace('&#34;', '&quot;')
    s = re.sub(r'\sdata-astro-cid-[a-z0-9]+(="")?', '', s)
    s = re.sub(r'data-astro-cid-[a-z0-9]+', 'data-astro-cid-X', s)
    s = re.sub(r'<!--.*?-->', '', s, flags=re.S)
    s = re.sub(r'\bastro-[a-z0-9]{8}\b', 'astro-X', s)
    s = re.sub(r'(/_astro/[^"\' )]*?)\.[A-Za-z0-9_-]{8}\.(js|css)', r'\1.H.\2', s)
    s = re.sub(r'/_astro/[^"\' )]+', '/_astro/X', s)
    s = re.sub(r'uid="[^"]*"', 'uid="X"', s)
    s = re.sub(r'prefix="r\d+"', 'prefix="rN"', s)
    s = re.sub(r'\sbefore-hydration-url="[^"]*"', '', s)
    s = re.sub(r'\sserver-render-time="[^"]*"', '', s)
    s = re.sub(r'<link rel="preload" as="image"[^>]*>', '', s)
    s = re.sub(r'(component-url|renderer-url|before-hydration-url)="[^"]*"', r'\1="X"', s)
    s = re.sub(r'\bdata-astro-transition-(?:scope|persist)="[^"]*"', 'data-astro-transition-X', s)
    s = re.sub(r'<style[^>]*>.*?</style>', '', s, flags=re.S)
    s = re.sub(r'<script[^>]*>.*?</script>', lambda m: '' if 'application/ld+json' not in m.group(0) else m.group(0), s, flags=re.S)
    s = re.sub(r'<link rel="(stylesheet|modulepreload)"[^>]*>', '', s)
    # Whitespace-aware, but only where it can render: inside <body>. In <head> (and
    # around <html>/<body>) gaps never render, so they are ignored.
    s = re.sub(r'\s+', ' ', s)
    i = s.find('<body')
    head, body = (s[:i], s[i:]) if i >= 0 else (s, '')
    head = re.sub(r'>\s*<', '>\n<', head)
    body = body.replace('> <', '>§<')
    body = re.sub(r'>(§?)<', lambda m: '>' + m.group(1) + '\n<', body)
    body = re.sub(r'</body>§?<', '</body>\n<', body)
    body = re.sub(r'</body>§$', '</body>', body)
    s = head + '\n' + body
    return drop_nonrendering_gaps([l.strip() for l in s.split('\n') if l.strip()])

def base_html(dist, path):
    p = os.path.join(dist, path.strip('/'), 'index.html') if path != '/' else os.path.join(dist, 'index.html')
    return open(p, encoding='utf-8').read()

def live_html(url, path):
    with urllib.request.urlopen(url.rstrip('/') + path, timeout=120) as r:
        return r.read().decode('utf-8')

dist, url = sys.argv[1], sys.argv[2]
paths = sys.argv[3:] or ['/']
total_diff = 0
for path in paths:
    try:
        a = norm(base_html(dist, path)); b = norm(live_html(url, path))
    except Exception as e:
        print(f'{path:34} ERROR {e}'); total_diff += 1; continue
    d = [l for l in difflib.unified_diff(a, b, 'baseline', 'emdash', lineterm='', n=0) if not l.startswith(('---', '+++', '@@'))]
    status = 'IDENTICAL' if not d else f'{len(d)} diff lines'
    print(f'{path:34} {status}  (base {len(a)} lines / new {len(b)} lines)')
    if d:
        total_diff += 1
        if os.environ.get('SHOW'):
            for l in d[:int(os.environ.get('SHOW'))]: print('    ', l[:200])
sys.exit(1 if total_diff else 0)
