import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import worldMapRaw from '@svg-maps/world';
import { t } from '../../lib/ui-strings';
import type { Locale } from '../../lib/i18n';

// Browser only: GSAP starts a timer on registration, which Cloudflare Workers forbid at module scope (SSR).
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

interface WorldLocation {
  name: string;
  id: string;
  path: string;
}

export interface MarketCountry {
  name: string;
  region: string;
}

// Real country boundaries (CC-BY-4.0, github.com/VictorCazanave/svg-maps) —
// same package family as the India distribution map, so pin placement uses
// the identical bounding-box technique.
const worldMap = worldMapRaw as unknown as { viewBox: string; locations: WorldLocation[] };

const LOCATION_BY_KEY = new Map<string, WorldLocation>();
for (const loc of worldMap.locations) {
  LOCATION_BY_KEY.set(loc.name.trim().toLowerCase(), loc);
  LOCATION_BY_KEY.set(loc.id.trim().toLowerCase(), loc);
}

// This dataset spells a couple of our markets differently (no diacritics) —
// mapped by hand rather than fuzzy-matched, so a typo elsewhere can't
// silently highlight the wrong country.
const NAME_ALIASES: Record<string, string> = {
  'réunion': 'reunion',
};

function findLocation(name: string): WorldLocation | undefined {
  const key = name.trim().toLowerCase();
  return LOCATION_BY_KEY.get(NAME_ALIASES[key] ?? key);
}

// Unicode regional-indicator flags for the hover preview card — every
// country here resolves to a real ISO 3166-1 alpha-2 code. Anything typed
// into the CMS that isn't in this map just skips the flag rather than
// showing a broken glyph.
const FLAG_BY_COUNTRY: Record<string, string> = {
  'United Arab Emirates': '🇦🇪',
  Oman: '🇴🇲',
  Kuwait: '🇰🇼',
  'Saudi Arabia': '🇸🇦',
  'Sierra Leone': '🇸🇱',
  Tanzania: '🇹🇿',
  Djibouti: '🇩🇯',
  Ethiopia: '🇪🇹',
  Mauritius: '🇲🇺',
  'Réunion': '🇷🇪',
  Nepal: '🇳🇵',
  Bangladesh: '🇧🇩',
  'Sri Lanka': '🇱🇰',
  Malaysia: '🇲🇾',
  Philippines: '🇵🇭',
  Singapore: '🇸🇬',
  'Papua New Guinea': '🇵🇬',
};

// The lucide "MapPin" teardrop, in its native 24x24 box — tip sits at
// (12, 21). Reused verbatim (same glyph already used for location fields
// elsewhere on this site) rather than inventing a new pin shape.
const PIN_PATH = 'M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z';
const PIN_SCALE = 0.9;

export default function WorldMarketsMap({ countries, locale = 'en' }: { countries: MarketCountry[]; locale?: Locale }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const pathRefs = useRef<Map<string, SVGPathElement>>(new Map());
  const [centers, setCenters] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [hover, setHover] = useState<{ country: MarketCountry; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const next = new Map<string, { x: number; y: number }>();
    pathRefs.current.forEach((el, id) => {
      const box = el.getBBox();
      next.set(id, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    });
    setCenters(next);
  }, []);

  // Pins get their own effect, keyed on `centers` — they don't exist in the
  // DOM at all until the centers-computing layout effect above resolves and
  // triggers a second render (each pin's own JSX bails to `null` while its
  // center is still unknown). Registering ScrollTrigger.batch('.wm-pin', ...)
  // in a mount-only effect (the original `useEffect` here, with `[]` deps)
  // was finding zero elements — batch() reads the DOM once, synchronously,
  // at registration time, it doesn't watch for elements added later — so the
  // pins silently never animated. This effect re-registers once real pins
  // are actually in the DOM. (Same fix as the homepage's DistributionMap.tsx
  // and the Distributor Network page's map.)
  //
  // pre-anim-hidden (global.css) hides `.wm-pin` via plain CSS from the very
  // first paint, closing the gap where Astro/React paint the real pins well
  // before this client:load island hydrates. fromTo (not .from) gives the
  // tween an explicit end value instead of letting GSAP infer one by reading
  // the current computed style, which — with the CSS pre-hide already at
  // opacity:0 — would read "current == target == 0" and no-op. Region tabs
  // in the parent GlobalMarkets swap which countries (and therefore which
  // `.wm-pin` elements) render, so a persistent pre-hide rule would
  // permanently hide any pin that appears after this one-time batch has
  // already fired — onComplete removes the marker once the initial set
  // finishes, so a later region switch just renders its pins at their
  // natural opacity (visible, unanimated), same as before this fix.
  useLayoutEffect(() => {
    if (centers.size === 0) return;
    const ctx = gsap.context(() => {
      ScrollTrigger.batch('.wm-pin', {
        start: 'top 85%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { scale: 0, opacity: 0 },
            {
              scale: 1,
              opacity: 1,
              duration: 0.45,
              ease: 'back.out(1.7)',
              stagger: 0.04,
              onComplete: () => sectionRef.current?.classList.remove('pre-anim-hidden'),
            },
          ),
      });
    }, sectionRef);
    return () => ctx.revert();
  }, [centers]);

  // Measured live off the real rendered rects (not viewBox percentages) so
  // the preview card lands correctly regardless of how the SVG's responsive
  // scaling/letterboxing plays out at a given viewport width.
  function handlePinEnter(e: MouseEvent<SVGGElement>, country: MarketCountry) {
    const mapRect = sectionRef.current?.getBoundingClientRect();
    const pinRect = e.currentTarget.getBoundingClientRect();
    if (!mapRect) return;
    setHover({
      country,
      x: pinRect.left + pinRect.width / 2 - mapRect.left,
      y: pinRect.top - mapRect.top,
    });
  }

  const highlightedIds = new Set(
    countries.map((c) => findLocation(c.name)?.id).filter((id): id is string => Boolean(id)),
  );

  return (
    <div
      ref={sectionRef}
      className="pre-anim-hidden relative overflow-visible rounded-2xl bg-indian-red/[0.04] p-4 sm:p-6 lg:p-8 ring-1 ring-indian-red/10"
    >
      <span className="sr-only">{t(locale, 'Map of countries Ankur Salt exports to')}</span>
      <svg viewBox={worldMap.viewBox} className="w-full h-auto max-h-[420px] overflow-visible" aria-hidden="true">
        {worldMap.locations.map((loc) => (
          <path
            key={loc.id}
            ref={(el) => {
              if (el) pathRefs.current.set(loc.id, el);
            }}
            d={loc.path}
            fill="currentColor"
            stroke="#FFF6EB"
            strokeWidth={0.5}
            className={highlightedIds.has(loc.id) ? 'text-indian-red/55 transition-colors duration-300' : 'text-indian-red/[0.08] transition-colors duration-300'}
          />
        ))}
        {countries.map((country, i) => {
          const loc = findLocation(country.name);
          const center = loc && centers.get(loc.id);
          if (!center) return null;
          return (
            <g
              key={i}
              className="wm-pin cursor-pointer"
              transform={`translate(${center.x}, ${center.y}) scale(${PIN_SCALE}) translate(-12, -21)`}
              onMouseEnter={(e) => handlePinEnter(e, country)}
              onMouseLeave={() => setHover(null)}
            >
              <path d={PIN_PATH} fill="#A82121" stroke="#FFF6EB" strokeWidth={1} />
              <circle cx={12} cy={9} r={3.2} fill="#FFF6EB" />
            </g>
          );
        })}
      </svg>

      {/* Custom preview card — a plain text tooltip reads as an afterthought;
          this mirrors the flag + name + region "place card" pattern used in
          map-preview UIs (Google Maps info windows and similar). */}
      {hover && (
        <div
          className="pointer-events-none absolute z-20"
          style={{ left: hover.x, top: hover.y, transform: 'translate(-50%, calc(-100% - 14px))' }}
        >
          <div className="flex items-center gap-3 whitespace-nowrap rounded-xl bg-white px-4 py-2.5 shadow-xl shadow-black/15 ring-1 ring-indian-red/10">
            <span className="text-2xl leading-none" aria-hidden="true">
              {FLAG_BY_COUNTRY[hover.country.name] ?? '🌍'}
            </span>
            <div className="text-left">
              <p className="text-sm font-semibold leading-tight text-indian-red">{t(locale, hover.country.name)}</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase leading-tight tracking-wider text-indian-red/45">
                {hover.country.region}
              </p>
            </div>
          </div>
          <div className="mx-auto -mt-1.5 h-3 w-3 rotate-45 rounded-[2px] bg-white shadow-sm" />
        </div>
      )}
    </div>
  );
}
