import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import gsap from 'gsap';
import { isEditModeActive, onEditModeChange } from '../lib/editMode';

export interface CustomSelectProps {
  name: string;
  placeholder: string;
  options: string[];
  icon: string;
  iconFilled?: boolean;
  required?: boolean;
  /** JSON path to the options array (e.g. "general.subjectOptions") — pass this
   *  to make the option list itself add/removable in the admin. Omit for
   *  dropdowns whose options are owned by another page (e.g. industries/grades,
   *  already CRUD-editable from the Industrial Salt page). */
  listPath?: string;
}

export default function CustomSelect({ name, placeholder, options, icon, iconFilled, required, listPath }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const [items, setItems] = useState<string[]>(options);
  const [listDirty, setListDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<SVGSVGElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setEditing(isEditModeActive());
    return onEditModeChange(setEditing);
  }, []);

  // Lets other components (e.g. an "Apply for this role" link) pre-fill this
  // dropdown from outside its own React tree, since each CustomSelect is an
  // isolated island with no shared state of its own.
  useEffect(() => {
    function onExternalSet(e: Event) {
      const detail = (e as CustomEvent<{ name: string; value: string }>).detail;
      if (detail?.name === name && items.includes(detail.value)) {
        setValue(detail.value);
      }
    }
    window.addEventListener('customselect:set', onExternalSet);
    return () => window.removeEventListener('customselect:set', onExternalSet);
  }, [name, items]);

  // Editors need to actually see the option list to edit it — the admin's
  // click-to-edit overlay can't reach elements hidden behind display:none.
  // But this dropdown might itself live inside something that starts hidden
  // (e.g. the career apply modal), in which case opening immediately would
  // portal a floating panel to <body> while its own trigger is still
  // invisible. Only auto-open once the trigger is actually laid out
  // (offsetParent is null for anything inside a display:none ancestor), and
  // retry whenever a modal announces it just opened.
  useEffect(() => {
    if (!editing) return;
    const tryOpen = () => {
      if (triggerRef.current && triggerRef.current.offsetParent !== null) {
        setOpen(true);
      }
    };
    tryOpen();
    window.addEventListener('careers:open-apply-modal', tryOpen);
    return () => window.removeEventListener('careers:open-apply-modal', tryOpen);
  }, [editing]);

  const updateCoords = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setCoords({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  };

  // Popover is portaled to <body> so it can never be clipped by a form
  // card's overflow-hidden (used elsewhere for rounded corners) — so it
  // tracks the trigger's position manually instead of relying on CSS.
  useEffect(() => {
    if (!open) return;
    updateCoords();
    window.addEventListener('scroll', updateCoords, true);
    window.addEventListener('resize', updateCoords);
    return () => {
      window.removeEventListener('scroll', updateCoords, true);
      window.removeEventListener('resize', updateCoords);
    };
  }, [open]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      const insideTrigger = triggerRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel && !editing) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !editing) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [editing]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (open) {
      gsap.set(panel, { display: 'block' });
      gsap.fromTo(
        panel,
        { opacity: 0, y: -8, scaleY: 0.9 },
        { opacity: 1, y: 0, scaleY: 1, duration: 0.22, ease: 'power2.out', transformOrigin: 'top' }
      );
    } else {
      gsap.to(panel, {
        opacity: 0,
        y: -8,
        scaleY: 0.9,
        duration: 0.15,
        ease: 'power1.in',
        transformOrigin: 'top',
        onComplete: () => gsap.set(panel, { display: 'none' }),
      });
    }
    if (chevronRef.current) {
      gsap.to(chevronRef.current, { rotate: open ? 180 : 0, duration: 0.2, ease: 'power2.out' });
    }
  }, [open]);

  // Contenteditable typing only mutates the DOM (editMode.ts reads it back at
  // Save time) — syncing it into state here keeps add/remove (which re-renders
  // every option from state) from wiping out an edit the editor hadn't saved yet.
  function updateOption(i: number, e: React.FocusEvent<HTMLElement>) {
    const next = e.currentTarget.textContent?.trim() ?? '';
    setItems((prev) => prev.map((v, idx) => (idx === i ? next : v)));
  }

  function addOption() {
    setItems((prev) => [...prev, '']);
    setListDirty(true);
  }

  function removeOption(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
    setListDirty(true);
  }

  return (
    <div>
      <input type="hidden" name={name} value={value} required={required} />
      <button
        type="button"
        ref={triggerRef}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 rounded-lg border border-indian-red/15 bg-white py-2.5 pl-3.5 pr-3.5 text-sm text-left transition-colors duration-150 hover:border-indian-red/30 focus:outline-none focus:ring-2 focus:ring-indian-red/30"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-indian-red/35">
          <path
            d={icon}
            fill={iconFilled ? 'currentColor' : 'none'}
            stroke={iconFilled ? 'none' : 'currentColor'}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className={`flex-1 ${value ? 'text-indian-red' : 'text-indian-red/30'}`}>{value || placeholder}</span>
        <svg ref={chevronRef} viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-indian-red/40">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {mounted &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            style={{ display: 'none', position: 'fixed', top: coords.top, left: coords.left, width: coords.width }}
            className="z-[110] max-h-60 overflow-auto rounded-lg border border-indian-red/15 bg-white shadow-lg shadow-indian-red/10 py-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            {listPath && <input type="hidden" data-cms-list-changed={listPath} value={listDirty ? '1' : '0'} readOnly />}

            {items.map((opt, i) =>
              editing && listPath ? (
                <div key={i} className="flex items-center gap-2 px-3.5 py-2 text-sm">
                  <span
                    data-cms-field={`${listPath}[${i}]`}
                    onBlur={(e) => updateOption(i, e)}
                    className="flex-1 text-indian-red/80 outline-none"
                  >
                    {opt}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    aria-label={`Remove ${opt || 'option'}`}
                    className="shrink-0 text-indian-red/40 hover:text-indian-red"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  key={i}
                  role="option"
                  aria-selected={value === opt}
                  onClick={() => {
                    setValue(opt);
                    setOpen(false);
                    // Lets a plain <script> elsewhere on the page (e.g. an
                    // "Other" reveal-field toggle) react to a pick made
                    // inside this island, mirroring the existing inbound
                    // 'customselect:set' event above.
                    window.dispatchEvent(new CustomEvent('customselect:change', { detail: { name, value: opt } }));
                  }}
                  className={`block w-full text-left px-3.5 py-2 text-sm transition-colors duration-100 hover:bg-indian-red/5 ${
                    value === opt ? 'bg-indian-red/10 text-indian-red font-medium' : 'text-indian-red/80'
                  }`}
                >
                  {opt}
                </button>
              )
            )}

            {editing && listPath && (
              <button
                type="button"
                onClick={addOption}
                className="flex w-full items-center gap-1.5 px-3.5 py-2 text-xs font-semibold uppercase tracking-wide text-indian-red/60 hover:text-indian-red"
              >
                <Plus size={13} /> Add Option
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
