import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Plus, X } from 'lucide-react';
import { isEditModeActive, onEditModeChange } from '../lib/editMode';
import { t } from '../../lib/ui-strings';
import type { Locale } from '../../lib/i18n';

// Browser only: GSAP starts a timer on registration, which Cloudflare Workers forbid at module scope (SSR).
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

export interface GradeSpec {
  tier: string;
  name: string;
  hardness: string;
}

export interface GradesTableContent {
  heading: string;
  subheading: string;
  items: GradeSpec[];
}

const EMPTY_GRADE: GradeSpec = { tier: 'Standard', name: '', hardness: '' };

function parseNumber(s: string) {
  return parseFloat(s.replace(/[^\d.]/g, ''));
}
function hardnessPpm(hardness: string) {
  return hardness.toLowerCase().includes('ppm') ? parseNumber(hardness) : null;
}

export default function GradesTable({ content, locale = 'en' }: { content: GradesTableContent; locale?: Locale }) {
  const { heading, subheading } = content;
  const [items, setItems] = useState<GradeSpec[]>(content.items);
  const [listDirty, setListDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditing(isEditModeActive());
    return onEditModeChange(setEditing);
  }, []);

  // This used to share the parent Astro page's plain `.reveal` class and
  // IntersectionObserver — but that observer runs outside React and mutates
  // this className directly (adding `in-view`) whenever it fires, which can
  // land before this client:visible island finishes hydrating. React then
  // sees a server/client className mismatch on hydration and explicitly
  // abandons reconciling that subtree ("this won't be patched up" is React's
  // own wording for it) — a real correctness bug, not just a console
  // warning: once abandoned, later state changes here (toggling `editing`,
  // adding/removing a grade row) aren't guaranteed to update the DOM
  // correctly anymore. This component now owns its entrance animation
  // itself, the same as every other React island on the site, instead of
  // borrowing a DOM-mutating system it doesn't control the timing of.
  //
  // Keep server-rendered grades visible if hydration or GSAP fails. The
  // timeline applies its starting values only after this effect runs.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: rootRef.current, start: 'top 80%', once: true },
        defaults: { ease: 'power3.out' },
      });
      tl.fromTo('.gt-heading', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5 })
        .fromTo('.gt-subheading', { opacity: 0, y: 20, filter: 'blur(10px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.7 }, '<0.1')
        .fromTo('.gt-cards', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.7 }, '<0.15');
    }, rootRef);
    return () => ctx.revert();
  }, []);

  const lowestPpmGrade = items.reduce((best, g) => {
    const ppm = hardnessPpm(g.hardness);
    return ppm !== null && ppm < (hardnessPpm(best.hardness) ?? Infinity) ? g : best;
  }, items[0]);

  // One card per tier instead of one flat wrap of chips — groups consecutive
  // same-tier items (tiers are assumed contiguous, same as the rest of this
  // component's editing logic) while keeping every entry's real index into
  // the flat `items` array, since updateField/removeRow/addRowToTier all
  // address rows by that index, not by position within a tier.
  const tierGroups = items.reduce<{ tier: string; startIndex: number; entries: { grade: GradeSpec; index: number }[] }[]>((groups, grade, i) => {
    const last = groups[groups.length - 1];
    if (last && last.tier === grade.tier) {
      last.entries.push({ grade, index: i });
    } else {
      groups.push({ tier: grade.tier, startIndex: i, entries: [{ grade, index: i }] });
    }
    return groups;
  }, []);

  // Contenteditable typing only mutates the DOM (editMode.ts reads it back at
  // Save time) — it never touches this component's own state. Without syncing
  // it here, adding/removing a row (which re-renders every row from state)
  // would silently wipe out any edit the editor hadn't already saved.
  function updateField(i: number, key: keyof GradeSpec, e: React.FocusEvent<HTMLElement>) {
    const next = e.currentTarget.textContent?.trim() ?? '';
    setItems((prev) => prev.map((g, idx) => (idx === i ? { ...g, [key]: next } : g)));
  }

  // Inserts a new row right after the last row of a given tier, so "Add" works
  // per-group (Standard / Low Hardness Series / Specialty) instead of only
  // ever appending to the very end of the whole list.
  function addRowToTier(tier: string, afterIndex: number) {
    setItems((prev) => {
      const next = [...prev];
      next.splice(afterIndex + 1, 0, { ...EMPTY_GRADE, tier });
      return next;
    });
    setListDirty(true);
  }

  // Renaming a tier group has to update every item in that contiguous run, not
  // just the one the group-header text happens to be bound to — otherwise the
  // renamed item's tier would stop matching its neighbours and the group would
  // silently split apart on next load.
  function renameTierGroup(startIndex: number, oldTier: string, e: React.FocusEvent<HTMLElement>) {
    const newTier = e.currentTarget.textContent?.trim() ?? '';
    setItems((prev) => {
      const next = [...prev];
      for (let i = startIndex; i < next.length && next[i].tier === oldTier; i++) {
        next[i] = { ...next[i], tier: newTier };
      }
      return next;
    });
  }

  function removeRow(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
    setListDirty(true);
  }

  return (
    <div ref={rootRef}>
      <span
        data-cms-field="grades.heading"
        className="gt-heading block text-[10px] font-semibold uppercase tracking-widest text-indian-red/40"
      >
        {heading}
      </span>
      <h2
        data-cms-field="grades.subheading"
        className="gt-subheading mt-2 font-display font-medium text-2xl lg:text-3xl text-indian-red mb-8"
      >
        {subheading}
      </h2>

      {/* One card per tier — grade names only, no NaCl/hardness/moisture
          numbers shown publicly; those live behind the Technical Data
          Sheet's verified-email gate below instead. Matches the Industries
          Served card treatment further down this page (white rounded-2xl,
          hover lift) instead of one flat wrap of loose chips. */}
      <div className="gt-cards grid grid-cols-1 gap-4 sm:grid-cols-3">
        {tierGroups.map((group) => (
          <div
            key={group.startIndex}
            className="rounded-2xl bg-white p-6 ring-1 ring-indian-red/[0.08] transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg hover:shadow-indian-red/10"
          >
            <div className="flex items-center justify-between gap-2">
              <p
                data-cms-field={`grades.items[${group.startIndex}].tier`}
                className="text-[10px] font-semibold uppercase tracking-widest text-indian-red/40"
                onBlur={(e) => renameTierGroup(group.startIndex, group.tier, e)}
              >
                {group.tier}
              </p>
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-indian-red/30">
                {t(locale, group.entries.length === 1 ? '{n} grade' : '{n} grades', { n: group.entries.length })}
              </span>
            </div>

            <ul className="mt-4 flex flex-col gap-3">
              {group.entries.map(({ grade, index: gi }) => (
                <li key={gi} className="flex items-center gap-2">
                  {/* Hidden so every item's tier round-trips on save, even though
                      only the card header above is what an editor actually edits. */}
                  {gi !== group.startIndex && (
                    <span data-cms-field={`grades.items[${gi}].tier`} className="hidden">
                      {grade.tier}
                    </span>
                  )}
                  <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-indian-red/50">
                    <path d="M8 1 14 8 8 15 2 8Z" fill="currentColor" />
                  </svg>
                  <span
                    data-cms-field={`grades.items[${gi}].name`}
                    className="flex-1 text-sm font-medium text-indian-red"
                    onBlur={(e) => updateField(gi, 'name', e)}
                  >
                    {grade.name || 'Untitled grade'}
                  </span>
                  {grade === lowestPpmGrade && (
                    <span className="shrink-0 rounded-full bg-indian-red px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-silent-white">
                      {t(locale, 'Highest Purity')}
                    </span>
                  )}
                  {editing && (
                    <button
                      type="button"
                      onClick={() => removeRow(gi)}
                      aria-label={`Remove ${grade.name || 'grade'}`}
                      className="shrink-0 text-indian-red/40 hover:text-indian-red"
                    >
                      <X size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {editing && (
              <button
                type="button"
                onClick={() => addRowToTier(group.tier, group.startIndex + group.entries.length - 1)}
                className="mt-4 inline-flex items-center gap-1 rounded-full border border-dashed border-indian-red/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-indian-red/60 hover:border-indian-red/50 hover:text-indian-red"
              >
                <Plus size={12} /> Add
              </button>
            )}
          </div>
        ))}
      </div>

      <input type="hidden" data-cms-list-changed="grades.items" value={listDirty ? '1' : '0'} readOnly />
    </div>
  );
}
