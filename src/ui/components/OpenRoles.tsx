import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { isEditModeActive, onEditModeChange } from '../lib/editMode';
import { t } from '../../lib/ui-strings';
import type { Locale } from '../../lib/i18n';

export interface RoleItem {
  title: string;
  department: string;
  location: string;
  type: string;
  description: string;
}

export interface OpenRolesContent {
  heading: string;
  subheading: string;
  items: RoleItem[];
}

const EMPTY_ROLE: RoleItem = {
  title: '',
  department: '',
  location: 'Gandhidham, Gujarat',
  type: 'Full-time',
  description: '',
};

function TagIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICON_LOCATION = 'M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z';
const ICON_CLOCK = 'M12 7v5l3 2 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z';
const ICON_DEPARTMENT = 'M3 21V10l5 3V10l5 3V6l7 4v11H3Z';

export default function OpenRoles({ content, locale = 'en' }: { content: OpenRolesContent; locale?: Locale }) {
  const { heading, subheading } = content;
  const [items, setItems] = useState<RoleItem[]>(content.items);
  const [listDirty, setListDirty] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setEditing(isEditModeActive());
    return onEditModeChange(setEditing);
  }, []);

  // Contenteditable typing only mutates the DOM (editMode.ts reads it back at
  // Save time) — syncing it into state here keeps add/remove (which re-renders
  // every row from state) from wiping out an edit the editor hadn't saved yet.
  function updateField(i: number, key: keyof RoleItem, e: React.FocusEvent<HTMLElement>) {
    const next = e.currentTarget.textContent?.trim() ?? '';
    setItems((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: next } : r)));
  }

  function addRole() {
    setItems((prev) => [...prev, { ...EMPTY_ROLE }]);
    setListDirty(true);
  }

  function removeRole(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
    setListDirty(true);
  }

  // Opens the (normally hidden) apply modal and pre-fills its "Team of
  // Interest" dropdown — both live outside this component's own React tree,
  // so both are driven purely through DOM custom events.
  function applyFor(role: RoleItem) {
    window.dispatchEvent(new CustomEvent('customselect:set', { detail: { name: 'team', value: role.department } }));
    window.dispatchEvent(new CustomEvent('careers:open-apply-modal'));
  }

  return (
    <div>
      <h2 className="font-display font-medium text-2xl lg:text-3xl text-indian-red" data-cms-field="openRoles.heading">
        {heading}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-indian-red/70 max-w-[600px]" data-cms-field="openRoles.subheading">
        {subheading}
      </p>

      <input type="hidden" data-cms-list-changed="openRoles.items" value={listDirty ? '1' : '0'} readOnly />

      <div className="mt-8 flex flex-col gap-4">
        {items.map((role, i) => (
          <div key={i} className="role-row rounded-2xl bg-indian-red px-6 py-6 transition-transform duration-300 ease-out hover:-translate-y-1 hover:shadow-lg hover:shadow-indian-red/20">
            <div className="flex items-start justify-between gap-4">
              <h3
                data-cms-field={`openRoles.items[${i}].title`}
                onBlur={(e) => updateField(i, 'title', e)}
                className="font-display font-medium text-lg text-silent-white"
              >
                {role.title || 'Untitled role'}
              </h3>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => applyFor(role)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-silent-white px-4 py-2 text-sm font-medium text-indian-red whitespace-nowrap transition-transform duration-200 hover:scale-[1.04]"
                >
                  {t(locale, 'Apply')}
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5">
                    <path d="M5 12h14m0 0-5-5m5 5-5 5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {editing && (
                  <button
                    type="button"
                    onClick={() => removeRole(i)}
                    aria-label={`Remove ${role.title || 'role'}`}
                    className="text-silent-white/50 hover:text-silent-white"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>

            <p
              data-cms-field={`openRoles.items[${i}].description`}
              onBlur={(e) => updateField(i, 'description', e)}
              className="mt-1.5 text-sm leading-relaxed text-silent-white/70"
            >
              {role.description}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-silent-white/25 px-3 py-1 text-xs font-medium text-silent-white/80">
                <TagIcon d={ICON_DEPARTMENT} />
                <span data-cms-field={`openRoles.items[${i}].department`} onBlur={(e) => updateField(i, 'department', e)}>
                  {role.department || 'Department'}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-silent-white/25 px-3 py-1 text-xs font-medium text-silent-white/80">
                <TagIcon d={ICON_LOCATION} />
                <span data-cms-field={`openRoles.items[${i}].location`} onBlur={(e) => updateField(i, 'location', e)}>
                  {role.location}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-silent-white/25 px-3 py-1 text-xs font-medium text-silent-white/80">
                <TagIcon d={ICON_CLOCK} />
                <span data-cms-field={`openRoles.items[${i}].type`} onBlur={(e) => updateField(i, 'type', e)}>
                  {role.type}
                </span>
              </span>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <button
          type="button"
          onClick={addRole}
          className="mt-1 inline-flex items-center gap-1.5 font-sans text-xs font-semibold uppercase tracking-wide text-indian-red/60 hover:text-indian-red"
        >
          <Plus size={13} /> Add Role
        </button>
      )}
    </div>
  );
}
