// Inline editing for EmDash's edit mode (loaded by BaseLayout only then).
//
// Components mark every editable value with its path in the content they
// render: text with `data-cms-field`, link targets with `data-cms-link`,
// images with `data-cms-image`, and add/remove lists with a
// `data-cms-list-changed` marker. Pages wrap that content with cmsScope()
// (src/lib/content), which says which EmDash entry the paths belong to.
//
// A change is saved as a draft through EmDash's content API, using the codec
// to put the value back into the entry's stored blocks (src/lib/content/
// edit.mjs). EmDash's toolbar shows the save state, and its Publish button
// publishes every entry edited on the page.
import specs from '../../content/specs.json';
import { computeEdit, decodeScoped, EditError, getPath, parsePath } from '../../lib/content/edit.mjs';

type EntryScope = { kind: 'page'; collection: string; id: string; name: string }
  | { kind: 'entry'; collection: string; id: string; slug: string };
type ListScope = { kind: 'list'; prefix: string; items: (EntryScope | undefined)[] };
type Scope = EntryScope | ListScope;
type Target = { entry: EntryScope; path: (string | number)[] };
type Upload = { url: string; media: Record<string, unknown> };

const FIELD = 'data-cms-field';
const LINK = 'data-cms-link';
const IMAGE = 'data-cms-image';
const LIST = 'data-cms-list-changed';
// Navbar and footer links live in EmDash menus (see MenuLabel.tsx).
const MENU = 'data-cms-menu';
const MENU_LINK = 'data-cms-menu-link';
const MARKED = `[${FIELD}],[${LINK}],[${IMAGE}],[${MENU}],[${MENU_LINK}]`;

// ───────────────────────── resolving paths ─────────────────────────

function scopesOf(el: Element): Scope[] {
  try {
    return JSON.parse(el.getAttribute('data-cms-scope') || '[]');
  } catch {
    return [];
  }
}

/** Find the entry a marked element's path belongs to, nearest scope first. */
function resolve(el: Element, path: string): Target | null {
  for (let host = el.closest('[data-cms-scope]'); host; host = host.parentElement?.closest('[data-cms-scope]') ?? null) {
    const scopes = scopesOf(host);
    for (const scope of scopes) {
      if (scope.kind !== 'list' || !path.startsWith(`${scope.prefix}[`)) continue;
      const m = path.slice(scope.prefix.length).match(/^\[(\d+)\]\.?(.*)$/);
      const entry = m ? scope.items[Number(m[1])] : undefined;
      if (m && entry) return { entry, path: parsePath(m[2]) };
    }
    const own = scopes.find((s): s is EntryScope => s.kind !== 'list');
    if (own) return { entry: own, path: parsePath(path) };
  }
  return null;
}

function codecScope(entry: EntryScope, slug: string) {
  const all = specs as { pages: Record<string, unknown>; collections: Record<string, unknown> };
  return entry.kind === 'page'
    ? { kind: 'page', spec: all.pages[entry.name] }
    : { kind: 'entry', spec: all.collections[entry.collection], slug };
}

const adminUrl = (entry: EntryScope) =>
  `/_emdash/admin/content/${encodeURIComponent(entry.collection)}/${encodeURIComponent(entry.id)}`;

// ───────────────────────── saving ─────────────────────────

function api(url: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: { 'X-EmDash-Request': '1', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
}

const contentUrl = (entry: EntryScope) =>
  `/_emdash/api/content/${encodeURIComponent(entry.collection)}/${encodeURIComponent(entry.id)}`;

/** Entries changed on this page, published together from the toolbar. */
const edited = new Map<string, EntryScope>();
/** One save at a time per entry, so each starts from the latest revision. */
const queues = new Map<string, Promise<unknown>>();

function emit(name: string, detail: unknown) {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Save `value` at the target's path as a draft. `value` can be a function of
 * the stored value. `check` can inspect the stored value before anything is
 * written and throw an EditError to refuse.
 */
function save(target: Target, value: unknown, options: { upload?: Upload; check?: (previous: unknown) => void } = {}): Promise<boolean> {
  const { entry } = target;
  const key = `${entry.collection}/${entry.id}`;
  emit('emdash:save', { state: 'saving' });

  const run = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await api(contentUrl(entry));
      if (!res.ok) throw new Error(`Couldn't load the content (${res.status}).`);
      const body = (await res.json()) as any;
      const item = body.data.item;
      const scope = codecScope(entry, item.slug);
      const previous = getPath(decodeScoped(scope, item.data), target.path);
      if (previous === undefined) throw new EditError("This isn't stored with this page. Edit it in the admin.");
      options.check?.(previous);
      const next = typeof value === 'function' ? value(previous) : value;
      const { patch } = computeEdit(scope, item.data, target.path, next, options.upload);
      if (!Object.keys(patch).length) return false;
      const put = await api(contentUrl(entry), { method: 'PUT', body: JSON.stringify({ data: patch, _rev: body.data._rev }) });
      if (!put.ok) {
        const err = (await put.json().catch(() => null)) as any;
        // Changed since we read it: redo the edit on the new version. A lock
        // (the entry is open in the admin) names who holds it.
        if (put.status === 409 && err?.error?.code !== 'ENTRY_LOCKED' && attempt === 0) continue;
        throw new Error(err?.error?.message || `Saving failed (${put.status}).`);
      }
      return true;
    }
    throw new Error('Someone else is editing this content. Reload the page and try again.');
  };

  const done = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(run).then(
    (changed) => {
      emit('emdash:save', { state: 'saved' });
      if (changed) {
        edited.set(key, entry);
        emit('emdash:content-changed', { collection: entry.collection, id: entry.id });
      }
      return true;
    },
    (err) => {
      emit('emdash:save', { state: 'error' });
      if (err instanceof EditError) notify(err.message, entry);
      else notify(err?.message || 'Saving failed.', entry);
      console.error('[inline editor]', err);
      return false;
    },
  );
  queues.set(key, done);
  emit('emdash:save-pending', { done });
  return done;
}

async function publishAll() {
  const toolbarEntry = currentToolbarEntry();
  if (toolbarEntry) edited.set(`${toolbarEntry.collection}/${toolbarEntry.id}`, toolbarEntry);
  await Promise.all(queues.values());
  const failed: string[] = [];
  for (const entry of edited.values()) {
    const res = await api(`${contentUrl(entry)}/publish`, { method: 'POST', body: '{}' });
    if (!res.ok) failed.push(entry.kind === 'page' ? entry.name : entry.slug);
  }
  if (failed.length) notify(`Couldn't publish: ${failed.join(', ')}. Try again from the admin.`);
  else location.reload();
}

/** The entry EmDash's toolbar reports on, if it has unpublished changes. */
function currentToolbarEntry(): EntryScope | null {
  const el = document.querySelector('[data-emdash-ref]');
  try {
    const ref = JSON.parse(el?.getAttribute('data-emdash-ref') || 'null');
    if (!ref || !(ref.status === 'draft' || ref.hasDraft)) return null;
    const scope = el && scopesOf(el).find((s): s is EntryScope => s.kind !== 'list' && s.id === ref.id);
    return scope ?? null;
  } catch {
    return null;
  }
}

/**
 * Save a menu item ("menu/itemId"). Menus have no drafts: the change is live
 * as soon as it's saved.
 */
let menuNoticeShown = false;
function saveMenuItem(ref: string, body: { label?: string; customUrl?: string }): Promise<boolean> {
  const [menu, id] = ref.split('/');
  emit('emdash:save', { state: 'saving' });
  const done = api(`/_emdash/api/menus/${encodeURIComponent(menu)}/items/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) })
    .then(async (res) => {
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as any;
        throw new Error(err?.error?.message || `Saving failed (${res.status}).`);
      }
      emit('emdash:save', { state: 'saved' });
      if (!menuNoticeShown) {
        menuNoticeShown = true;
        notify('Menu links are live as soon as they are saved; they don\'t need Publish.');
      }
      return true;
    })
    .catch((err) => {
      emit('emdash:save', { state: 'error' });
      notify(err?.message || 'Saving failed.');
      return false;
    });
  emit('emdash:save-pending', { done });
  return done;
}

// ───────────────────────── messages ─────────────────────────

let toast: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function notify(message: string, entry?: EntryScope) {
  toast?.remove();
  toast = document.createElement('div');
  toast.className = 'cms-toast';
  toast.textContent = message;
  if (entry) {
    const link = document.createElement('a');
    link.href = adminUrl(entry);
    link.target = '_blank';
    link.textContent = 'Open in admin';
    toast.appendChild(document.createTextNode(' '));
    toast.appendChild(link);
  }
  document.body.appendChild(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast?.remove(), 8000);
}

// ───────────────────────── text ─────────────────────────

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Text as typed, keeping the line breaks browsers insert as <br> or <div>. */
function typedText(el: HTMLElement): string {
  let text = '';
  (function walk(node: Node) {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) text += (child as Text).data;
      else if (child.nodeName === 'BR') text += '\n';
      else {
        if (child.nodeName === 'DIV' && text && !text.endsWith('\n')) text += '\n';
        walk(child);
      }
    }
  })(el);
  return text;
}

let editing: HTMLElement | null = null;

/** Edit a page value marked with data-cms-field. */
function editField(el: HTMLElement) {
  const target = resolve(el, el.getAttribute(FIELD)!);
  if (!target) return notify('This text has no editable source on this page.');
  startTextEdit(el, (text, original) =>
    save(target, text, {
      check(previous) {
        // Only edit text shown exactly as stored; anything formatted on the
        // way to the page goes through the admin.
        if (typeof previous === 'object' || norm(String(previous)) !== norm(original)) {
          throw new EditError('This text is shown differently from how it is stored. Edit it in the admin.');
        }
      },
    }),
  );
}

/** Edit a menu link's label (data-cms-menu). */
function editMenuLabel(el: HTMLElement) {
  startTextEdit(el, (text) => {
    if (!text) {
      notify('A menu link needs a label.');
      return Promise.resolve(false);
    }
    return saveMenuItem(el.getAttribute(MENU)!, { label: text });
  });
}

/** Make an element's text editable; `commit` saves it and resolves to success. */
function startTextEdit(el: HTMLElement, commit: (text: string, original: string) => Promise<boolean>) {
  if (editing === el) return;
  editing?.blur();
  const original = el.textContent ?? '';
  editing = el;
  el.setAttribute('data-cms-editing', '');
  el.contentEditable = 'plaintext-only';
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.focus();

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      el.textContent = original;
      el.blur();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      el.blur();
    }
  };
  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    // Paste as plain text (contenteditable="true" fallback would keep markup).
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
  };
  const finish = () => {
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('paste', onPaste);
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-cms-editing');
    if (editing === el) editing = null;
    const text = typedText(el).replace(/^\s+|\s+$/g, '');
    if (norm(text) === norm(original)) {
      el.textContent = original;
      return;
    }
    commit(text, original).then((ok) => {
      if (!ok) el.textContent = original;
    });
  };
  el.addEventListener('keydown', onKey);
  el.addEventListener('paste', onPaste);
  el.addEventListener('blur', finish, { once: true });
}

// ───────────────────────── links and images ─────────────────────────

let popover: HTMLElement | null = null;

function closePopover() {
  popover?.remove();
  popover = null;
}

function openPopover(anchor: Element, title: string): HTMLElement {
  closePopover();
  popover = document.createElement('div');
  popover.className = 'cms-popover';
  const rect = anchor.getBoundingClientRect();
  popover.style.top = `${Math.max(8, rect.bottom + window.scrollY + 8)}px`;
  popover.style.left = `${Math.max(8, Math.min(rect.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 340))}px`;
  const heading = document.createElement('div');
  heading.className = 'cms-popover-title';
  heading.textContent = title;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  close.onclick = closePopover;
  heading.appendChild(close);
  popover.appendChild(heading);
  document.body.appendChild(popover);
  return popover;
}

/** A small form in a popover for values that aren't visible text. */
function editInPopover(el: Element, path: string, title: string, current: string, placeholder: string, apply: (target: Target, value: string) => void) {
  const target = resolve(el, path);
  if (!target) return notify('This has no editable source on this page.');
  const box = openPopover(el, title);
  const form = document.createElement('form');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.placeholder = placeholder;
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'Save';
  form.appendChild(input);
  form.appendChild(button);
  form.onsubmit = (e) => {
    e.preventDefault();
    apply(target, input.value.trim());
  };
  box.appendChild(form);
  input.focus();
  input.select();
}

/** Where a marked link keeps its address: `href`, or `data-file` on download buttons. */
const linkAttr = (el: Element) => (el.hasAttribute('href') || !el.hasAttribute('data-file') ? 'href' : 'data-file');

function editLink(el: Element) {
  const attr = linkAttr(el);
  editInPopover(el, el.getAttribute(LINK)!, 'Link address', el.getAttribute(attr) ?? '', '/contact/ or https://…', (target, href) => {
    if (/^\s*(javascript|data|vbscript):/i.test(href)) return notify('That link address is not allowed.');
    closePopover();
    save(target, href).then((ok) => {
      if (ok) el.setAttribute(attr, href);
    });
  });
  // Documents (PDFs, certificates) can be uploaded to the media library instead.
  const target = resolve(el, el.getAttribute(LINK)!);
  if (!target || !popover) return;
  const upload = document.createElement('label');
  upload.className = 'cms-upload';
  upload.textContent = 'Or upload a file (PDF, image…)';
  const file = document.createElement('input');
  file.type = 'file';
  file.onchange = async () => {
    const picked = file.files?.[0];
    if (!picked) return;
    upload.textContent = 'Uploading…';
    const item = await uploadMedia(picked);
    if (!item) return void (upload.textContent = 'Or upload a file (PDF, image…)');
    const url = item.url || `/_emdash/api/media/file/${item.storageKey}`;
    closePopover();
    save(target, url, { upload: { url, media: fileValue(item, url) } }).then((ok) => {
      if (ok) el.setAttribute(attr, url);
    });
  };
  upload.appendChild(file);
  popover.appendChild(upload);
}

/** A media-library item as stored in a file field. */
function fileValue(item: any, url: string) {
  const value: Record<string, unknown> = {
    id: item.id,
    provider: item.provider || 'local',
    filename: item.filename,
    mimeType: item.mimeType,
    size: item.size,
    url,
    meta: item.meta,
  };
  for (const k of Object.keys(value)) if (value[k] === undefined) delete value[k];
  return value;
}

/** Upload a file to the media library; resolves to the new item or null. */
async function uploadMedia(picked: File): Promise<any | null> {
  const form = new FormData();
  form.append('file', picked);
  const res = await fetch('/_emdash/api/media', { method: 'POST', body: form, credentials: 'same-origin', headers: { 'X-EmDash-Request': '1' } });
  const body = (await res.json().catch(() => null)) as any;
  const item = body?.success && body.data?.item;
  if (!item) notify(body?.error?.message || 'Upload failed.');
  return item || null;
}

function editMenuLink(el: Element) {
  const box = openPopover(el, 'Link address');
  const form = document.createElement('form');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = el.getAttribute('href') ?? '';
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'Save';
  form.appendChild(input);
  form.appendChild(button);
  form.onsubmit = (e) => {
    e.preventDefault();
    const href = input.value.trim();
    if (!href || /^\s*(javascript|data|vbscript):/i.test(href)) return notify('That link address is not allowed.');
    closePopover();
    saveMenuItem(el.getAttribute(MENU_LINK)!, { customUrl: href }).then((ok) => {
      if (ok) el.setAttribute('href', href);
    });
  };
  box.appendChild(form);
  input.focus();
  input.select();
}

function editPlaceholder(el: HTMLInputElement | HTMLTextAreaElement) {
  const original = el.placeholder;
  editInPopover(el, el.getAttribute(FIELD)!, 'Placeholder text', original, '', (target, text) => {
    closePopover();
    save(target, text, {
      check(previous) {
        if (norm(String(previous)) !== norm(original)) throw new EditError('This text is shown differently from how it is stored. Edit it in the admin.');
      },
    }).then((ok) => {
      if (ok) el.placeholder = text;
    });
  });
}

function mediaValue(item: any) {
  const isLocal = !item.provider || item.provider === 'local';
  const url = item.url || item.previewUrl || `/_emdash/api/media/file/${item.storageKey}`;
  const media: Record<string, unknown> = {
    id: item.id,
    provider: item.provider || 'local',
    ...(isLocal ? { src: url } : { previewUrl: url }),
    alt: item.alt || '',
    width: item.width,
    height: item.height,
    meta: item.meta,
  };
  for (const k of Object.keys(media)) if (media[k] === undefined) delete media[k];
  return { url, media };
}

function editImage(el: Element) {
  const path = el.getAttribute(IMAGE)!;
  const target = resolve(el, path);
  if (!target) return notify('This image has no editable source on this page.');
  const box = openPopover(el, 'Change image');

  const choose = (item: any) => {
    const { url, media } = mediaValue(item);
    closePopover();
    save(target, url, {
      upload: { url, media },
      check(previous) {
        if (typeof previous !== 'string') throw new EditError('This image can only be changed in the admin.');
      },
    }).then((ok) => {
      const shown = el.matches('img, video') ? el : el.querySelector('img, video');
      if (!ok || !shown) return;
      shown.removeAttribute('srcset');
      shown.closest('picture')?.querySelectorAll('source').forEach((s) => s.remove());
      shown.setAttribute(shown.tagName === 'VIDEO' ? 'poster' : 'src', url);
    });
  };

  const upload = document.createElement('label');
  upload.className = 'cms-upload';
  upload.textContent = 'Upload a new image';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.onchange = async () => {
    const picked = file.files?.[0];
    if (!picked) return;
    upload.textContent = 'Uploading…';
    const item = await uploadMedia(picked);
    if (!item) return void (upload.textContent = 'Upload a new image');
    choose(item);
  };
  upload.appendChild(file);

  const grid = document.createElement('div');
  grid.className = 'cms-media-grid';
  grid.textContent = 'Loading the media library…';
  box.appendChild(upload);
  box.appendChild(grid);

  api('/_emdash/api/media?mimeType=image/&limit=60')
    .then((r) => r.json())
    .then((body: any) => {
      const items = body?.data?.items ?? [];
      grid.textContent = items.length ? '' : 'No images in the media library yet.';
      for (const item of items) {
        const thumb = document.createElement('button');
        thumb.type = 'button';
        const img = document.createElement('img');
        img.src = item.url || item.previewUrl || `/_emdash/api/media/file/${item.storageKey}`;
        img.alt = item.alt || item.filename || '';
        img.loading = 'lazy';
        thumb.appendChild(img);
        thumb.onclick = () => choose(item);
        grid.appendChild(thumb);
      }
    })
    .catch(() => (grid.textContent = "Couldn't load the media library."));
}

// Hover badges for links and images (their click is the element's own).
let badges: HTMLElement | null = null;
let badgeFor: Element | null = null;

function showBadges(el: Element) {
  const link = el.closest(`[${LINK}]`);
  const menuLink = el.closest(`[${MENU_LINK}]`);
  const image = el.closest(`[${IMAGE}]`);
  const owner = image ?? link ?? menuLink;
  if (!owner || owner === badgeFor) return;
  badges?.remove();
  badgeFor = owner;
  badges = document.createElement('div');
  badges.className = 'cms-badges';
  const rect = owner.getBoundingClientRect();
  badges.style.top = `${rect.top + window.scrollY + 4}px`;
  badges.style.left = `${rect.left + window.scrollX + 4}px`;
  const add = (label: string, action: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      action();
    };
    badges!.appendChild(b);
  };
  if (image) add('Change image', () => editImage(image));
  if (link) add('Edit link', () => editLink(link));
  else if (menuLink) add('Edit link', () => editMenuLink(menuLink));
  document.body.appendChild(badges);
}

// ───────────────────────── add/remove lists ─────────────────────────

let listBar: HTMLElement | null = null;

function dirtyLists(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[${LIST}]`)].filter((m) => m.value === '1');
}

/** Rebuild a list from what the page shows, keeping fields it doesn't show. */
function listFromPage(listPath: string, previous: unknown[]): unknown[] {
  const prefix = `${listPath}[`;
  const rows: Record<number, Record<string, string> | string> = {};
  const take = (attr: string, read: (el: Element) => string) => {
    document.querySelectorAll(`[${attr}^="${CSS.escape(prefix)}"]`).forEach((el) => {
      const m = el.getAttribute(attr)!.slice(prefix.length).match(/^(\d+)\](?:\.(.+))?$/);
      if (!m) return;
      const i = Number(m[1]);
      if (m[2]) rows[i] = { ...(typeof rows[i] === 'object' ? (rows[i] as Record<string, string>) : {}), [m[2]]: read(el) };
      else rows[i] = read(el);
    });
  };
  take(FIELD, (el) => (el.textContent ?? '').trim());
  take(IMAGE, (el) => (el.matches('img') ? el : el.querySelector('img'))?.getAttribute('src') ?? '');
  // Rows keep their original index after a removal, so each one starts from
  // its stored item. New rows start from the last item, so fields the page
  // doesn't show (such as a photo's category) get a sensible value.
  return Object.keys(rows).map(Number).sort((a, b) => a - b).map((i) => {
    const row = rows[i];
    if (typeof row === 'string') return row;
    const base = (previous[i] ?? previous[previous.length - 1] ?? {}) as Record<string, unknown>;
    const out = JSON.parse(JSON.stringify(base));
    for (const [key, value] of Object.entries(row)) {
      const keys = key.split('.');
      let cur = out;
      for (const k of keys.slice(0, -1)) cur = cur[k] ??= {};
      cur[keys.at(-1)!] = value;
    }
    return out;
  });
}

async function saveLists() {
  let ok = true;
  for (const marker of dirtyLists()) {
    const listPath = marker.getAttribute(LIST)!;
    const target = resolve(marker, listPath);
    if (!target) continue;
    // The list is rebuilt against the stored value read during the save.
    ok = (await save(target, (previous: unknown[]) => listFromPage(listPath, previous), {
      check(previous) {
        if (!Array.isArray(previous)) throw new EditError('This list can only be changed in the admin.');
      },
    })) && ok;
  }
  if (ok) location.reload();
}

function watchLists() {
  setInterval(() => {
    const dirty = dirtyLists().length > 0;
    if (dirty && !listBar) {
      listBar = document.createElement('div');
      listBar.className = 'cms-listbar';
      listBar.textContent = 'You added or removed list items. ';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Save list changes';
      button.onclick = () => {
        button.disabled = true;
        saveLists().finally(() => (button.disabled = false));
      };
      listBar.appendChild(button);
      document.body.appendChild(listBar);
    } else if (!dirty && listBar) {
      listBar.remove();
      listBar = null;
    }
  }, 1000);
}

// ───────────────────────── wiring ─────────────────────────

const STYLE = `
[${FIELD}],[${LINK}],[${IMAGE}],[${MENU}]{outline:1px dashed rgba(37,99,235,.45);outline-offset:2px;}
[${FIELD}],[${MENU}]{cursor:text;}
[${FIELD}]:hover,[${LINK}]:hover,[${IMAGE}]:hover,[${MENU}]:hover{outline:2px solid rgba(37,99,235,.8);}
[data-cms-editing]{outline:2px solid #2563eb !important;background:rgba(37,99,235,.06);}
.cms-badges{position:absolute;z-index:2147483000;display:flex;gap:4px;pointer-events:auto;}
.cms-badges button,.cms-popover button,.cms-listbar button{font:600 12px/1 system-ui,sans-serif;background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 9px;cursor:pointer;}
.cms-popover{position:absolute;z-index:2147483001;width:320px;max-width:calc(100vw - 16px);background:#fff;color:#111;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.25);padding:12px;font:14px/1.4 system-ui,sans-serif;}
.cms-popover-title{display:flex;justify-content:space-between;align-items:center;font-weight:600;margin-bottom:8px;}
.cms-popover-title button{background:none;color:#555;font-size:18px;padding:0 4px;}
.cms-popover form{display:flex;gap:6px;}
.cms-popover input[type=text]{flex:1;min-width:0;border:1px solid #ccc;border-radius:6px;padding:6px 8px;font:inherit;}
.cms-upload{display:block;border:1px dashed #999;border-radius:8px;padding:10px;text-align:center;cursor:pointer;margin-bottom:8px;}
.cms-upload input{display:none;}
.cms-media-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-height:260px;overflow:auto;color:#555;}
.cms-media-grid button{padding:0;background:#eee;aspect-ratio:1;overflow:hidden;border-radius:6px;}
.cms-media-grid img{width:100%;height:100%;object-fit:cover;display:block;}
.cms-toast,.cms-listbar{position:fixed;z-index:2147483002;left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);background:#111;color:#fff;border-radius:10px;padding:10px 14px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3);}
.cms-toast{bottom:84px;}
.cms-toast a{color:#93c5fd;text-decoration:underline;}
.cms-listbar{bottom:136px;display:flex;gap:10px;align-items:center;}
`;

let started = false;

/** Runs on every page load, including the site's client-side navigations. */
export function startInlineEditor() {
  // Page transitions replace <body> and may drop our <style>.
  if (!document.getElementById('cms-inline-editor-style')) {
    const style = document.createElement('style');
    style.id = 'cms-inline-editor-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  // Components show their add/remove controls (gallery photos and videos) with this class.
  document.body.classList.add('edit-mode');
  if (started) return;
  started = true;

  // Capture phase: runs before the page's own handlers, so clicking editable
  // text edits it instead of following a link or advancing a slider.
  document.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    if (!t || t.closest('#emdash-toolbar, .cms-popover, .cms-badges, .cms-toast, .cms-listbar')) return;
    if (popover && !t.closest('.cms-popover')) closePopover();
    const field = t.closest<HTMLElement>(`[${FIELD}]`);
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      e.preventDefault();
      editPlaceholder(field);
      return;
    }
    if (field && !field.querySelector(MARKED)) {
      e.preventDefault();
      e.stopPropagation();
      editField(field);
      return;
    }
    const menuLabel = t.closest<HTMLElement>(`[${MENU}]`);
    if (menuLabel) {
      e.preventDefault();
      e.stopPropagation();
      editMenuLabel(menuLabel);
      return;
    }
    if (t.closest(`[${LINK}],[${MENU_LINK}]`) || field) e.preventDefault();
  }, true);

  document.addEventListener('mouseover', (e) => {
    const t = e.target as Element | null;
    if (t && !t.closest('.cms-badges')) showBadges(t);
  });

  // Publish everything edited here, not just the entry the toolbar shows.
  document.addEventListener('click', (e) => {
    if (!(e.target as Element | null)?.closest('#emdash-tb-publish') || !edited.size) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const button = document.getElementById('emdash-tb-publish') as HTMLButtonElement | null;
    if (button) button.disabled = true;
    publishAll().finally(() => button && (button.disabled = false));
  }, true);

  // EmDash's own inline rich-text editor (blog articles) reports its saves
  // too; include those entries when publishing.
  document.addEventListener('emdash:content-changed', (e) => {
    const { collection, id } = ((e as CustomEvent).detail ?? {}) as { collection?: string; id?: string };
    if (collection && id && !edited.has(`${collection}/${id}`)) edited.set(`${collection}/${id}`, { kind: 'entry', collection, id, slug: id });
  });

  watchLists();
}
