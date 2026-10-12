/** data-cms-image wraps either an <img> or a <video> (e.g. a poster-swap
 *  target whose actual playable file also needs to be CMS-editable) —
 *  resolves to whichever media element is actually there. */
function _mediaEl(wrapper: Element): HTMLImageElement | HTMLVideoElement | null {
  if (wrapper.tagName === 'IMG' || wrapper.tagName === 'VIDEO') {
    return wrapper as HTMLImageElement | HTMLVideoElement;
  }
  return wrapper.querySelector('img, video');
}

const STORAGE_KEY    = 'cms-edit-mode';
const DOM_EVENT      = 'cms-editmode';
const FIELD_ATTR     = 'data-cms-field';
const ORIG_ATTR      = 'data-cms-original';
const LINK_ATTR      = 'data-cms-link';
const LINK_ORIG_ATTR = 'data-cms-link-original';
const HREF_ORIG_ATTR = 'data-cms-href-original';
const IMAGE_ATTR     = 'data-cms-image';
const IMAGE_ORIG_ATTR= 'data-cms-image-original';
const LIST_CHANGED_ATTR = 'data-cms-list-changed';
const ICON_ATTR      = 'data-cms-icon';
const ICON_KEY_ATTR  = 'data-cms-icon-key';
const ICON_ORIG_ATTR = 'data-cms-icon-original';
export const LINK_EVENT  = 'cms-link-click';
export const IMAGE_EVENT = 'cms-image-click';
export const SAVED_EVENT = 'cms-saved';
export const ICON_EVENT  = 'cms-icon-click';
export const ICON_CHANGE_EVENT = 'cms-icon-change';
export const TRANSLATE_EVENT = 'cms-translate-click';

/** Locale of the page currently loaded (English default) — set by
 *  BaseLayout via `?locale=` on the iframe src, read here straight off the
 *  URL rather than needing a separate parent->iframe sync message, since a
 *  locale switch always reloads the iframe with a new URL anyway. */
function _currentLocale(): string {
  if (typeof location === 'undefined') return 'en';
  return new URLSearchParams(location.search).get('locale') || 'en';
}

export type ViewportDevice = 'desktop' | 'tablet' | 'mobile';

// Sync edit mode across parent ↔ iframe (same origin, same channel name)
const bc =
  typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('cms-edit')
    : null;

let navBlocker: ((e: Event) => void) | null = null;

// ── Field-label tooltip ──────────────────────────────────────────────────────
let _tip: HTMLElement | null = null;
let _tipOver: ((e: MouseEvent) => void) | null = null;
let _tipOut:  ((e: MouseEvent) => void) | null = null;

function _mountTooltip(active: boolean): void {
  _tip?.remove(); _tip = null;
  if (_tipOver) { document.removeEventListener('mouseover', _tipOver); _tipOver = null; }
  if (_tipOut)  { document.removeEventListener('mouseout',  _tipOut);  _tipOut  = null; }
  if (!active) return;

  _tip = document.createElement('div');
  Object.assign(_tip.style, {
    position: 'fixed', zIndex: '99999', display: 'none',
    background: '#2563eb', color: '#ffffff',
    fontFamily: 'system-ui, sans-serif', fontSize: '9px',
    fontWeight: '700', letterSpacing: '.1em', textTransform: 'uppercase',
    padding: '3px 8px', borderRadius: '3px 3px 3px 0',
    pointerEvents: 'none', whiteSpace: 'nowrap',
    boxShadow: '0 2px 6px rgba(0,0,0,.18)',
  });
  document.body.appendChild(_tip);

  _tipOver = (e: MouseEvent) => {
    const el = (e.target as Element | null)?.closest(`[${FIELD_ATTR}]`);
    if (!el || !_tip) return;
    const r = el.getBoundingClientRect();
    _tip.textContent = el.getAttribute(FIELD_ATTR) ?? '';
    _tip.style.left  = `${r.left}px`;
    _tip.style.top   = `${r.top > 28 ? r.top - 24 : r.bottom + 4}px`;
    _tip.style.display = 'block';
  };

  _tipOut = (e: MouseEvent) => {
    if (!(e.relatedTarget as Element | null)?.closest(`[${FIELD_ATTR}]`) && _tip)
      _tip.style.display = 'none';
  };

  document.addEventListener('mouseover', _tipOver);
  document.addEventListener('mouseout',  _tipOut);
}

// ── Link-edit badge ──────────────────────────────────────────────────────────
let _badge:      HTMLElement | null = null;
let _badgeFor:   Element | null = null;
let _badgeOver:  ((e: MouseEvent) => void) | null = null;
let _badgeOut:   ((e: MouseEvent) => void) | null = null;
let _badgeTimer: ReturnType<typeof setTimeout> | null = null;

function _cancelBadgeHide() {
  if (_badgeTimer) { clearTimeout(_badgeTimer); _badgeTimer = null; }
}

function _scheduleBadgeHide() {
  _cancelBadgeHide();
  _badgeTimer = setTimeout(() => {
    if (_badge) _badge.style.display = 'none';
    _badgeFor  = null;
    _badgeTimer = null;
  }, 180);
}

function _mountLinkBadge(active: boolean): void {
  _cancelBadgeHide();
  _badge?.remove(); _badge = null; _badgeFor = null;
  if (_badgeOver) { document.removeEventListener('mouseover', _badgeOver); _badgeOver = null; }
  if (_badgeOut)  { document.removeEventListener('mouseout',  _badgeOut);  _badgeOut  = null; }
  if (!active) return;

  _badge = document.createElement('button');
  _badge.textContent = '↗ Link';
  _badge.title = 'Edit link destination';
  Object.assign(_badge.style, {
    position: 'fixed', zIndex: '99998', display: 'none',
    background: '#111827', color: '#60a5fa',
    border: '1px solid rgba(96,165,250,0.45)',
    borderRadius: '4px', padding: '3px 8px',
    fontSize: '9px', fontFamily: 'system-ui, sans-serif',
    fontWeight: '700', letterSpacing: '.1em', textTransform: 'uppercase',
    cursor: 'pointer', whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px rgba(0,0,0,.22)',
  });
  document.body.appendChild(_badge);

  // Hovering the badge itself keeps it alive
  _badge.addEventListener('mouseenter', _cancelBadgeHide);
  _badge.addEventListener('mouseleave', _scheduleBadgeHide);

  _badge.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    _cancelBadgeHide();
    if (!_badgeFor) return;
    const r = _badgeFor.getBoundingClientRect();
    document.dispatchEvent(new CustomEvent(LINK_EVENT, {
      detail: {
        field: _badgeFor.getAttribute(LINK_ATTR) ?? '',
        href:  _badgeFor.getAttribute('href') ?? '',
        rect:  { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height },
      },
    }));
  });

  _badgeOver = (e: MouseEvent) => {
    const el = (e.target as Element)?.closest(`[${LINK_ATTR}]`);
    if (!el) return;
    _cancelBadgeHide();
    _badgeFor = el;
    const r = el.getBoundingClientRect();
    if (_badge) {
      _badge.style.display = 'block';
      _badge.style.top  = `${r.top > 20 ? r.top - 18 : r.bottom + 4}px`;
      _badge.style.left = `${r.right + 6}px`;
    }
  };

  _badgeOut = (e: MouseEvent) => {
    const to = e.relatedTarget as Element | null;
    // Moving directly into the badge — keep it alive
    if (to === _badge || _badge?.contains(to)) { _cancelBadgeHide(); return; }
    // Moving to another link element — reposition without hiding
    if (to?.closest(`[${LINK_ATTR}]`)) { _cancelBadgeHide(); return; }
    // Leaving link area entirely — short grace period so cursor can reach badge
    _scheduleBadgeHide();
  };

  document.addEventListener('mouseover', _badgeOver);
  document.addEventListener('mouseout',  _badgeOut);
}

// ── Image-edit badge ─────────────────────────────────────────────────────────
let _imgBadge:      HTMLElement | null = null;
let _imgBadgeFor:   Element | null = null;
let _imgBadgeOver:  ((e: MouseEvent) => void) | null = null;
let _imgBadgeOut:   ((e: MouseEvent) => void) | null = null;
let _imgBadgeTimer: ReturnType<typeof setTimeout> | null = null;

function _cancelImgBadgeHide() {
  if (_imgBadgeTimer) { clearTimeout(_imgBadgeTimer); _imgBadgeTimer = null; }
}

function _scheduleImgBadgeHide() {
  _cancelImgBadgeHide();
  _imgBadgeTimer = setTimeout(() => {
    if (_imgBadge) _imgBadge.style.display = 'none';
    _imgBadgeFor  = null;
    _imgBadgeTimer = null;
  }, 180);
}

function _mountImageBadge(active: boolean): void {
  _cancelImgBadgeHide();
  _imgBadge?.remove(); _imgBadge = null; _imgBadgeFor = null;
  if (_imgBadgeOver) { document.removeEventListener('mouseover', _imgBadgeOver); _imgBadgeOver = null; }
  if (_imgBadgeOut)  { document.removeEventListener('mouseout',  _imgBadgeOut);  _imgBadgeOut  = null; }
  if (!active) return;

  _imgBadge = document.createElement('button');
  _imgBadge.textContent = '✎ Image';
  _imgBadge.title = 'Change image';
  Object.assign(_imgBadge.style, {
    position: 'fixed', zIndex: '99997', display: 'none',
    background: '#111827', color: '#60a5fa',
    border: '1px solid rgba(96,165,250,0.45)',
    borderRadius: '4px', padding: '3px 8px',
    fontSize: '9px', fontFamily: 'system-ui, sans-serif',
    fontWeight: '700', letterSpacing: '.1em', textTransform: 'uppercase',
    cursor: 'pointer', whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px rgba(0,0,0,.22)',
  });
  document.body.appendChild(_imgBadge);

  _imgBadge.addEventListener('mouseenter', _cancelImgBadgeHide);
  _imgBadge.addEventListener('mouseleave', _scheduleImgBadgeHide);

  _imgBadge.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    _cancelImgBadgeHide();
    if (!_imgBadgeFor) return;
    const r = _imgBadgeFor.getBoundingClientRect();
    // data-cms-image may be on a wrapper div — resolve the actual <img>/<video> src
    const src = _mediaEl(_imgBadgeFor)?.getAttribute('src') ?? '';
    document.dispatchEvent(new CustomEvent(IMAGE_EVENT, {
      detail: {
        field: _imgBadgeFor.getAttribute(IMAGE_ATTR) ?? '',
        src,
        rect:  { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height },
      },
    }));
  });

  _imgBadgeOver = (e: MouseEvent) => {
    // Decorative overlays (gradients, text panels) are often stacked on top
    // of the actual image and swallow the hover before e.target reaches it —
    // fall back to everything under the cursor, not just the topmost hit.
    const el = (e.target as Element)?.closest(`[${IMAGE_ATTR}]`)
      ?? document.elementsFromPoint(e.clientX, e.clientY).find((node) => node.matches(`[${IMAGE_ATTR}]`));
    if (!el) return;
    _cancelImgBadgeHide();
    _imgBadgeFor = el;
    const r = el.getBoundingClientRect();
    if (_imgBadge) {
      _imgBadge.style.display = 'block';
      // Overlay in the top-right corner of the image
      _imgBadge.style.top  = `${r.top + 8}px`;
      _imgBadge.style.left = `${Math.max(r.left + 4, r.right - 76)}px`;
    }
  };

  _imgBadgeOut = (e: MouseEvent) => {
    const to = e.relatedTarget as Element | null;
    if (to === _imgBadge || _imgBadge?.contains(to)) { _cancelImgBadgeHide(); return; }
    if (to?.closest(`[${IMAGE_ATTR}]`)) { _cancelImgBadgeHide(); return; }
    _scheduleImgBadgeHide();
  };

  document.addEventListener('mouseover', _imgBadgeOver);
  document.addEventListener('mouseout',  _imgBadgeOut);
}

// ── Icon-edit badge ──────────────────────────────────────────────────────────
let _iconBadge:      HTMLElement | null = null;
let _iconBadgeFor:   Element | null = null;
let _iconBadgeOver:  ((e: MouseEvent) => void) | null = null;
let _iconBadgeOut:   ((e: MouseEvent) => void) | null = null;
let _iconBadgeTimer: ReturnType<typeof setTimeout> | null = null;

function _cancelIconBadgeHide() {
  if (_iconBadgeTimer) { clearTimeout(_iconBadgeTimer); _iconBadgeTimer = null; }
}

function _scheduleIconBadgeHide() {
  _cancelIconBadgeHide();
  _iconBadgeTimer = setTimeout(() => {
    if (_iconBadge) _iconBadge.style.display = 'none';
    _iconBadgeFor  = null;
    _iconBadgeTimer = null;
  }, 180);
}

function _mountIconBadge(active: boolean): void {
  _cancelIconBadgeHide();
  _iconBadge?.remove(); _iconBadge = null; _iconBadgeFor = null;
  if (_iconBadgeOver) { document.removeEventListener('mouseover', _iconBadgeOver); _iconBadgeOver = null; }
  if (_iconBadgeOut)  { document.removeEventListener('mouseout',  _iconBadgeOut);  _iconBadgeOut  = null; }
  if (!active) return;

  _iconBadge = document.createElement('button');
  _iconBadge.textContent = '✎ Icon';
  _iconBadge.title = 'Change icon';
  Object.assign(_iconBadge.style, {
    position: 'fixed', zIndex: '99997', display: 'none',
    background: '#111827', color: '#60a5fa',
    border: '1px solid rgba(96,165,250,0.45)',
    borderRadius: '4px', padding: '3px 8px',
    fontSize: '9px', fontFamily: 'system-ui, sans-serif',
    fontWeight: '700', letterSpacing: '.1em', textTransform: 'uppercase',
    cursor: 'pointer', whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px rgba(0,0,0,.22)',
  });
  document.body.appendChild(_iconBadge);

  _iconBadge.addEventListener('mouseenter', _cancelIconBadgeHide);
  _iconBadge.addEventListener('mouseleave', _scheduleIconBadgeHide);

  _iconBadge.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    _cancelIconBadgeHide();
    if (!_iconBadgeFor) return;
    const r = _iconBadgeFor.getBoundingClientRect();
    document.dispatchEvent(new CustomEvent(ICON_EVENT, {
      detail: {
        field:   _iconBadgeFor.getAttribute(ICON_ATTR) ?? '',
        iconKey: _iconBadgeFor.getAttribute(ICON_KEY_ATTR) ?? '',
        rect:    { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height },
      },
    }));
  });

  _iconBadgeOver = (e: MouseEvent) => {
    const el = (e.target as Element)?.closest(`[${ICON_ATTR}]`);
    if (!el) return;
    _cancelIconBadgeHide();
    _iconBadgeFor = el;
    const r = el.getBoundingClientRect();
    if (_iconBadge) {
      _iconBadge.style.display = 'block';
      // Positioned just outside the icon box (to the right) rather than
      // inset over a corner — icon boxes are typically small (~40-50px),
      // too small for the image badge's "inset corner" convention without
      // the badge covering the icon and re-triggering its own mouseout.
      _iconBadge.style.top  = `${r.top > 20 ? r.top - 2 : r.bottom + 4}px`;
      _iconBadge.style.left = `${r.right + 6}px`;
    }
  };

  _iconBadgeOut = (e: MouseEvent) => {
    const to = e.relatedTarget as Element | null;
    if (to === _iconBadge || _iconBadge?.contains(to)) { _cancelIconBadgeHide(); return; }
    if (to?.closest(`[${ICON_ATTR}]`)) { _cancelIconBadgeHide(); return; }
    _scheduleIconBadgeHide();
  };

  document.addEventListener('mouseover', _iconBadgeOver);
  document.addEventListener('mouseout',  _iconBadgeOut);
}

// ── Translate badge ──────────────────────────────────────────────────────────
// Mounted on every editable text field, in every locale — symmetric in both
// directions. Whichever locale is currently being viewed is the source: the
// field's live text (including an unsaved edit, not the last-saved value) is
// read on click and sent for translation into the other locale. There's
// never an in-place field to drop the result into (the other locale isn't
// rendered on this page), so the consumer (TranslateAssist.tsx) always shows
// a preview popup with an Apply step before anything is written. Attaches to
// the existing FIELD_ATTR elements rather than a new dedicated attribute, since
// every text field is a translation candidate.
let _translateBadge:      HTMLElement | null = null;
let _translateBadgeFor:   Element | null = null;
let _translateBadgeOver:  ((e: MouseEvent) => void) | null = null;
let _translateBadgeOut:   ((e: MouseEvent) => void) | null = null;
let _translateBadgeTimer: ReturnType<typeof setTimeout> | null = null;

function _cancelTranslateBadgeHide() {
  if (_translateBadgeTimer) { clearTimeout(_translateBadgeTimer); _translateBadgeTimer = null; }
}

function _scheduleTranslateBadgeHide() {
  _cancelTranslateBadgeHide();
  _translateBadgeTimer = setTimeout(() => {
    if (_translateBadge) _translateBadge.style.display = 'none';
    _translateBadgeFor  = null;
    _translateBadgeTimer = null;
  }, 180);
}

function _mountTranslateBadge(active: boolean): void {
  _cancelTranslateBadgeHide();
  _translateBadge?.remove(); _translateBadge = null; _translateBadgeFor = null;
  if (_translateBadgeOver) { document.removeEventListener('mouseover', _translateBadgeOver); _translateBadgeOver = null; }
  if (_translateBadgeOut)  { document.removeEventListener('mouseout',  _translateBadgeOut);  _translateBadgeOut  = null; }
  if (!active) return;

  _translateBadge = document.createElement('button');
  _translateBadge.textContent = '🌐 Translate';
  _translateBadge.title = 'Translate this field from English';
  Object.assign(_translateBadge.style, {
    position: 'fixed', zIndex: '99997', display: 'none',
    background: '#111827', color: '#60a5fa',
    border: '1px solid rgba(96,165,250,0.45)',
    borderRadius: '4px', padding: '3px 8px',
    fontSize: '9px', fontFamily: 'system-ui, sans-serif',
    fontWeight: '700', letterSpacing: '.1em', textTransform: 'uppercase',
    cursor: 'pointer', whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px rgba(0,0,0,.22)',
  });
  document.body.appendChild(_translateBadge);

  _translateBadge.addEventListener('mouseenter', _cancelTranslateBadgeHide);
  _translateBadge.addEventListener('mouseleave', _scheduleTranslateBadgeHide);

  _translateBadge.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    _cancelTranslateBadgeHide();
    if (!_translateBadgeFor) return;
    const r = _translateBadgeFor.getBoundingClientRect();
    const sourceLocale = _currentLocale();
    // Only two locales exist today, so "translate into the other one" has
    // one unambiguous answer. Once a third locale ships, this needs a small
    // picker instead of an implicit toggle.
    const targetLocale = sourceLocale === 'en' ? 'hi' : 'en';
    // Read the field's LIVE text, not its last-saved value — this is what
    // makes the badge symmetric: on either locale, whatever's currently
    // typed there (including an unsaved edit) is the source, and it
    // translates into the other locale. A popup (TranslateAssist.tsx) shows
    // the suggestion for review; nothing here is written in place.
    const sourceText = _translateBadgeFor.textContent?.trim() ?? '';
    document.dispatchEvent(new CustomEvent(TRANSLATE_EVENT, {
      detail: {
        field: _translateBadgeFor.getAttribute(FIELD_ATTR) ?? '',
        sourceLocale,
        targetLocale,
        sourceText,
        rect:  { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height },
      },
    }));
  });

  _translateBadgeOver = (e: MouseEvent) => {
    const el = (e.target as Element)?.closest(`[${FIELD_ATTR}]`);
    if (!el) return;
    _cancelTranslateBadgeHide();
    _translateBadgeFor = el;
    const r = el.getBoundingClientRect();
    if (_translateBadge) {
      _translateBadge.style.display = 'block';
      const targetName = _currentLocale() === 'en' ? 'Hindi' : 'English';
      _translateBadge.title = `Translate this field into ${targetName} (opens a preview to confirm)`;
      // Below-left by default — the field-label tooltip anchors top-left of
      // this same element (both fire on FIELD_ATTR hover, unlike the link/
      // icon badges which key off a different attribute on a different
      // element), so sharing that corner would stack the two on top of each
      // other on short fields (nav links, labels). Only flip above when
      // there's no room below.
      const spaceBelow = window.innerHeight - r.bottom;
      _translateBadge.style.top  = `${spaceBelow > 30 ? r.bottom + 4 : r.top - 22}px`;
      _translateBadge.style.left = `${r.left}px`;
    }
  };

  _translateBadgeOut = (e: MouseEvent) => {
    const to = e.relatedTarget as Element | null;
    if (to === _translateBadge || _translateBadge?.contains(to)) { _cancelTranslateBadgeHide(); return; }
    if (to?.closest(`[${FIELD_ATTR}]`)) { _cancelTranslateBadgeHide(); return; }
    _scheduleTranslateBadgeHide();
  };

  document.addEventListener('mouseover', _translateBadgeOver);
  document.addEventListener('mouseout',  _translateBadgeOut);
}
// ─────────────────────────────────────────────────────────────────────────────

export function isEditModeActive(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

let _fieldObserver: MutationObserver | null = null;

/**
 * Applies the one-time edit-mode wiring (contenteditable + spellcheck +
 * original-value capture for fields/links/images, href-stripping for plain
 * nav links) to a single element, if it matches. Shared by the initial
 * activation scan and the MutationObserver below, so content that mounts
 * *after* edit mode is already on (an accordion answer, a dropdown menu,
 * anything behind a `{open && (...)}` gate) gets wired up the moment it
 * appears, instead of only whatever existed in the DOM at toggle time.
 */
function _wireElement(el: Element): void {
  if (el.matches(`[${FIELD_ATTR}]`)) {
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    if (!el.hasAttribute(ORIG_ATTR)) {
      el.addEventListener('focus', () => {
        if (!el.hasAttribute(ORIG_ATTR)) {
          el.setAttribute(ORIG_ATTR, el.textContent?.trim() ?? '');
        }
      }, { once: true });
    }
  }

  if (el.matches(`[${LINK_ATTR}]`) && !el.hasAttribute(LINK_ORIG_ATTR)) {
    el.setAttribute(LINK_ORIG_ATTR, el.getAttribute('href') ?? '');
  }

  if (el.matches(`[${IMAGE_ATTR}]`) && !el.hasAttribute(IMAGE_ORIG_ATTR)) {
    const src = _mediaEl(el)?.getAttribute('src') ?? '';
    el.setAttribute(IMAGE_ORIG_ATTR, src);
  }

  if (el.matches(`[${ICON_ATTR}]`) && !el.hasAttribute(ICON_ORIG_ATTR)) {
    el.setAttribute(ICON_ORIG_ATTR, el.getAttribute(ICON_KEY_ATTR) ?? '');
  }

  // Plain navigation links (cards, "view details", etc.) — strip their href
  // entirely while editing so clicking them can never leave the page, and so
  // any data-cms-field text nested inside becomes freely clickable/editable.
  // CMS-link-editable anchors (data-cms-link) keep their href since the link
  // badge needs it, and are instead handled by navBlocker below.
  if (el.matches('a[href]') && !el.matches(`[${LINK_ATTR}]`)) {
    if (!el.hasAttribute(HREF_ORIG_ATTR)) {
      el.setAttribute(HREF_ORIG_ATTR, el.getAttribute('href') ?? '');
    }
    el.removeAttribute('href');
  }
}

/** Wires up `root` itself (if it matches) plus every matching descendant. */
function _wireEditableSubtree(root: Element): void {
  _wireElement(root);
  root.querySelectorAll(`[${FIELD_ATTR}], [${LINK_ATTR}], [${IMAGE_ATTR}], [${ICON_ATTR}], a[href]`).forEach(_wireElement);
}

function _applyEditMode(active: boolean): void {
  localStorage.setItem(STORAGE_KEY, active ? 'true' : 'false');
  document.body.classList.toggle('edit-mode', active);

  if (active) {
    _wireEditableSubtree(document.body);

    if (!_fieldObserver) {
      _fieldObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) _wireEditableSubtree(node as Element);
          });
        }
      });
      _fieldObserver.observe(document.body, { childList: true, subtree: true });
    }
  } else {
    _fieldObserver?.disconnect();
    _fieldObserver = null;

    document.querySelectorAll(`[${FIELD_ATTR}]`).forEach((el) => el.setAttribute('contenteditable', 'false'));

    document.querySelectorAll(`[${HREF_ORIG_ATTR}]`).forEach((el) => {
      el.setAttribute('href', el.getAttribute(HREF_ORIG_ATTR) ?? '');
      el.removeAttribute(HREF_ORIG_ATTR);
    });
  }

  if (active) {
    navBlocker = (e: Event) => {
      const target = e.target as Element;
      const anchor = target.closest('a');
      if (!anchor) return;

      // Alt/Option-click forces real navigation past the block below (and
      // past the href-stripping above) — lets admins browse to a page they
      // want to edit without leaving edit mode first.
      if ((e as MouseEvent).altKey) {
        e.preventDefault();
        e.stopPropagation();
        const href = anchor.getAttribute(HREF_ORIG_ATTR) ?? anchor.getAttribute('href');
        if (href) window.location.href = href;
        return;
      }

      // Block navigation on any remaining links (e.g. data-cms-link anchors)
      // while editing — admins switch pages via the toolbar. Also stop the
      // click from reaching React's own onClick handlers on the anchor (e.g.
      // "close this dropdown/menu"): otherwise clicking into editable text
      // nested inside a link-styled card — the services dropdown, a mobile
      // CTA button, anything similar — closes/unmounts its container before
      // the click can ever focus the field. This runs in the capture phase,
      // ahead of the target and of React's delegated bubble-phase listener,
      // so stopping it here suppresses those handlers without blocking the
      // browser's own native focus/caret placement (governed by mousedown,
      // not click).
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('click', navBlocker, true);
  } else if (navBlocker) {
    document.removeEventListener('click', navBlocker, true);
    navBlocker = null;
  }

  _mountTooltip(active);
  _mountLinkBadge(active);
  _mountImageBadge(active);
  _mountIconBadge(active);
  _mountTranslateBadge(active);
}

// When the iframe receives a broadcast from the parent, apply it locally
bc?.addEventListener('message', ({ data }) => {
  if (typeof data?.active === 'boolean') {
    _applyEditMode(data.active);
    document.dispatchEvent(new CustomEvent(DOM_EVENT, { detail: { active: data.active } }));
  }
});

export function setEditMode(active: boolean): void {
  _applyEditMode(active);
  bc?.postMessage({ active });
  document.dispatchEvent(new CustomEvent(DOM_EVENT, { detail: { active } }));
}

export function onEditModeChange(cb: (active: boolean) => void): () => void {
  const handler = (e: Event) =>
    cb((e as CustomEvent<{ active: boolean }>).detail.active);
  document.addEventListener(DOM_EVENT, handler);
  return () => document.removeEventListener(DOM_EVENT, handler);
}

// On (re)load, if edit mode was left on, re-apply it to the DOM so
// contenteditable/badges/click-blocking are wired up without needing
// an off→on toggle.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const initEditMode = () => {
    if (isEditModeActive()) _applyEditMode(true);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEditMode);
  } else {
    initEditMode();
  }
}

export function setViewport(device: ViewportDevice): void {
  const html = document.documentElement;
  html.classList.remove('cms-preview-mobile', 'cms-preview-tablet');
  html.classList.toggle('cms-iframe-mode', device !== 'desktop');
  if (device !== 'desktop') html.classList.add(`cms-preview-${device}`);
}

/** Update an editable link's href and track the change. */
export function setLinkHref(field: string, href: string): void {
  const el = document.querySelector(`[${LINK_ATTR}="${CSS.escape(field)}"]`) as HTMLAnchorElement | null;
  if (!el) return;
  if (!el.hasAttribute(LINK_ORIG_ATTR)) {
    el.setAttribute(LINK_ORIG_ATTR, el.getAttribute('href') ?? '');
  }
  el.setAttribute('href', href);
}

/** Update an editable image's src and track the change.
 *  Works whether data-cms-image is on the <img>/<video> itself or on a wrapper element. */
export function setImageSrc(field: string, src: string): void {
  const wrapper = document.querySelector(`[${IMAGE_ATTR}="${CSS.escape(field)}"]`);
  if (!wrapper) return;
  if (!wrapper.hasAttribute(IMAGE_ORIG_ATTR)) {
    const origSrc = _mediaEl(wrapper)?.getAttribute('src') ?? '';
    wrapper.setAttribute(IMAGE_ORIG_ATTR, origSrc);
  }
  const media = _mediaEl(wrapper);
  if (media) {
    media.setAttribute('src', src);
    // <video> caches its source at load time — swapping the attribute alone
    // doesn't repaint the element, so the preview would keep showing the old file.
    if (media.tagName === 'VIDEO') (media as HTMLVideoElement).load();
  }
}

/** Update an editable icon's lucide key, track the change, and notify the
 *  React component (via ICON_CHANGE_EVENT) so it re-renders with the new icon. */
export function setIconKey(field: string, iconKey: string): void {
  const el = document.querySelector(`[${ICON_ATTR}="${CSS.escape(field)}"]`);
  if (!el) return;
  if (!el.hasAttribute(ICON_ORIG_ATTR)) {
    el.setAttribute(ICON_ORIG_ATTR, el.getAttribute(ICON_KEY_ATTR) ?? '');
  }
  el.setAttribute(ICON_KEY_ATTR, iconKey);
  document.dispatchEvent(new CustomEvent(ICON_CHANGE_EVENT, { detail: { field, iconKey } }));
}

/** Changes in the main document (desktop mode). */
export function getChanges(): Record<string, string> {
  return getChangesFromDoc(document);
}

// ── Pending cross-locale translations ────────────────────────────────────────
// TranslateAssist.tsx's "Apply" doesn't push to GitHub on its own — it queues
// the translated field here (a hidden marker on the iframe document's
// <body>, mirroring the LIST_CHANGED_ATTR marker pattern above), and
// AdminBar's Save reads it back — via the iframe's contentDocument, since
// AdminBar runs in the parent frame while TranslateAssist runs inside the
// iframe — alongside the normal field diff, so one Save commits both the
// current locale's edits and any queued cross-locale translations together.
const PENDING_TRANSLATIONS_ATTR = 'data-cms-pending-translations';

/** { [targetLocale]: { [fieldKey]: translatedText } }, keyed by locale so a
 *  single Save can carry queued translations for more than one other locale. */
export function getPendingTranslationsFromDoc(doc: Document): Record<string, Record<string, string>> {
  const raw = doc.body.getAttribute(PENDING_TRANSLATIONS_ATTR);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function queuePendingTranslation(doc: Document, targetLocale: string, field: string, value: string): void {
  const all = getPendingTranslationsFromDoc(doc);
  all[targetLocale] = { ...all[targetLocale], [field]: value };
  doc.body.setAttribute(PENDING_TRANSLATIONS_ATTR, JSON.stringify(all));
}

export function clearPendingTranslationsFromDoc(doc: Document): void {
  doc.body.removeAttribute(PENDING_TRANSLATIONS_ATTR);
}

/** Total count of queued translations across all target locales — for the
 *  Save button's change-count badge. */
export function countPendingTranslations(doc: Document): number {
  return Object.values(getPendingTranslationsFromDoc(doc)).reduce((sum, obj) => sum + Object.keys(obj).length, 0);
}

/** Changes in any document — used to read from iframe.contentDocument. */
export function getChangesFromDoc(doc: Document): Record<string, string> {
  const changes: Record<string, string> = {};

  // Text field changes
  doc.querySelectorAll(`[${FIELD_ATTR}][${ORIG_ATTR}]`).forEach((el) => {
    const field    = el.getAttribute(FIELD_ATTR)!;
    const original = el.getAttribute(ORIG_ATTR) ?? '';
    const current  = el.textContent?.trim() ?? '';
    if (current !== original) changes[field] = current;
  });

  // Link destination changes
  doc.querySelectorAll(`[${LINK_ATTR}][${LINK_ORIG_ATTR}]`).forEach((el) => {
    const field    = el.getAttribute(LINK_ATTR)!;
    const original = el.getAttribute(LINK_ORIG_ATTR) ?? '';
    const current  = el.getAttribute('href') ?? '';
    if (current !== original) changes[`${field}:href`] = current;
  });

  // Image/video src changes — attribute may be on <img>/<video> or on a wrapper div
  doc.querySelectorAll(`[${IMAGE_ATTR}][${IMAGE_ORIG_ATTR}]`).forEach((el) => {
    const field    = el.getAttribute(IMAGE_ATTR)!;
    const original = el.getAttribute(IMAGE_ORIG_ATTR) ?? '';
    const current  = _mediaEl(el)?.getAttribute('src') ?? '';
    if (current !== original) changes[`${field}:src`] = current;
  });

  // Icon key changes — field is already the literal JSON path (e.g. "processSteps[0].iconKey")
  doc.querySelectorAll(`[${ICON_ATTR}][${ICON_ORIG_ATTR}]`).forEach((el) => {
    const field    = el.getAttribute(ICON_ATTR)!;
    const original = el.getAttribute(ICON_ORIG_ATTR) ?? '';
    const current  = el.getAttribute(ICON_KEY_ATTR) ?? '';
    if (current !== original) changes[field] = current;
  });

  return changes;
}

/**
 * Whole-array overwrites — for lists that support add/remove (FAQ entries,
 * delivery steps, gallery images, etc.), where the generic per-field diff
 * above can't express a length change. A list container is marked with a
 * hidden `[data-cms-list-changed="<path>"]` flag (value '1' once dirty); when
 * set, every `[data-cms-field]` under that path (e.g. "faq.items[0].q") is
 * read fresh from the DOM and reassembled into the current array, grouped by
 * index and sub-key. Plain string-array items (no ".sub" suffix) come back
 * as a flat array of strings instead of objects. Items whose image lives in
 * a `[data-cms-image]` attribute instead of text (e.g. "images.items[0].src")
 * are folded in the same way, reading the resolved media src instead of
 * textContent, so a dirty list doesn't silently drop each item's picture.
 */
export function getArrayChangesFromDoc(doc: Document): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};

  doc.querySelectorAll(`[${LIST_CHANGED_ATTR}]`).forEach((marker) => {
    const listPath = marker.getAttribute(LIST_CHANGED_ATTR);
    const isDirty  = (marker as HTMLInputElement).value === '1';
    if (!listPath || !isDirty) return;

    const prefix = `${listPath}[`;
    const items: Record<number, Record<string, string> | string> = {};

    function ingest(field: string, value: string) {
      const rest = field.slice(prefix.length); // e.g. "0].q" or "0]"
      const m    = rest.match(/^(\d+)\](?:\.(.+))?$/);
      if (!m) return;

      const idx = Number(m[1]);
      const sub = m[2];

      if (sub) {
        const entry = (items[idx] && typeof items[idx] === 'object') ? items[idx] as Record<string, string> : {};
        entry[sub] = value;
        items[idx] = entry;
      } else {
        items[idx] = value;
      }
    }

    doc.querySelectorAll(`[${FIELD_ATTR}^="${prefix}"]`).forEach((el) => {
      ingest(el.getAttribute(FIELD_ATTR)!, el.textContent?.trim() ?? '');
    });

    doc.querySelectorAll(`[${IMAGE_ATTR}^="${prefix}"]`).forEach((el) => {
      ingest(el.getAttribute(IMAGE_ATTR)!, _mediaEl(el)?.getAttribute('src') ?? '');
    });

    result[listPath] = Object.keys(items)
      .map(Number)
      .sort((a, b) => a - b)
      .map((i) => items[i]);
  });

  return result;
}
