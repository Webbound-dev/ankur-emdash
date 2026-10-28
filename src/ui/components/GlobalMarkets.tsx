import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { MapPin, Globe2 } from 'lucide-react';
import WorldMarketsMap from './WorldMarketsMap';
import { t } from '../../lib/ui-strings';
import type { Locale } from '../../lib/i18n';

// Browser only: GSAP starts a timer on registration, which Cloudflare Workers forbid at module scope (SSR).
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

export interface Region {
  name: string;
  countries: string[];
}

export interface GlobalMarketsContent {
  heading: string;
  subheading: string;
  stat: { countries: number; regions: number };
  regions: Region[];
}

export default function GlobalMarkets({ content, locale = 'en' }: { content: GlobalMarketsContent; locale?: Locale }) {
  const { heading, subheading, stat, regions } = content;
  const [active, setActive] = useState<string>('All');
  const sectionRef = useRef<HTMLElement>(null);

  // This section previously had no entrance animation at all — same gap as
  // BecomeDistributorForm.tsx on the Distributor Network page. pre-anim-hidden
  // (global.css) hides these elements via plain CSS from the very first
  // paint, closing the gap where Astro/React paint the real, fully-visible
  // copy well before this client:load island hydrates. fromTo (not .from)
  // gives each tween an explicit end value instead of letting GSAP infer one
  // by reading the current computed style, which — with the CSS pre-hide
  // already at opacity:0 — would read "current == target == 0" and no-op.
  // Safe to fully CSS-pre-hide here: heading/subheading/stats/tabs are all
  // static CMS content, nothing here is ever added dynamically at runtime
  // (unlike the map's own pins below, which need the marker-removal
  // treatment — see WorldMarketsMap.tsx).
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: sectionRef.current, start: 'top 80%', once: true },
        defaults: { ease: 'power3.out' },
      });
      tl.fromTo('.gm-heading', { opacity: 0, y: 24, filter: 'blur(10px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8 })
        .fromTo('.gm-subheading', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6 }, '<0.15')
        .fromTo('.gm-stat', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out', stagger: 0.1 }, '<0.1')
        .fromTo('.gm-tabs', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, '<0.15')
        .fromTo('.gm-map-wrap', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.7 }, '<0.15');
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} id="global-markets" className="pre-anim-hidden relative max-w-[1100px] mx-auto px-6 lg:px-10 py-14 lg:py-20 scroll-mt-24">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05] [mask-image:linear-gradient(to_bottom,black,transparent)]"
        style={{ backgroundImage: 'repeating-linear-gradient(90deg, #A82121 0, #A82121 1px, transparent 1px, transparent 28px)' }}
        aria-hidden="true"
      />

      <div className="relative">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="max-w-[560px]">
            <h2 className="gm-heading font-display font-medium text-2xl lg:text-3xl text-indian-red" data-cms-field="globalMarkets.heading">
              {heading}
            </h2>
            <p className="gm-subheading mt-2 text-sm leading-relaxed text-indian-red/70" data-cms-field="globalMarkets.subheading">
              {subheading}
            </p>
          </div>
          <div className="flex items-center gap-6 shrink-0">
            <div className="gm-stat flex items-center gap-2.5">
              <MapPin className="h-6 w-6 shrink-0 text-indian-red/40" aria-hidden="true" />
              <div>
                <p className="font-display font-semibold text-2xl text-indian-red tabular-nums" data-cms-field="globalMarkets.stat.countries">
                  {stat.countries}
                </p>
                <p className="text-xs font-medium uppercase tracking-wide text-indian-red/50">{t(locale, 'Countries')}</p>
              </div>
            </div>
            <div className="h-8 w-px bg-indian-red/10" aria-hidden="true" />
            <div className="gm-stat flex items-center gap-2.5">
              <Globe2 className="h-6 w-6 shrink-0 text-indian-red/40" aria-hidden="true" />
              <div>
                <p className="font-display font-semibold text-2xl text-indian-red tabular-nums" data-cms-field="globalMarkets.stat.regions">
                  {stat.regions}
                </p>
                <p className="text-xs font-medium uppercase tracking-wide text-indian-red/50">{t(locale, 'Regions')}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Region tabs — same pill-toggle language as the site's other
            filterable directories. Filtering here only changes which
            countries get passed to the map below, so there's no separate
            list to keep in sync. */}
        <div className="gm-tabs mt-8 flex flex-wrap gap-2">
          {['All', ...regions.map((r) => r.name)].map((name, i) => (
            <button
              key={name}
              type="button"
              onClick={() => setActive(name)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150 ${
                active === name
                  ? 'bg-indian-red text-silent-white'
                  : 'bg-indian-red/[0.06] text-indian-red/70 hover:bg-indian-red/[0.12]'
              }`}
            >
              {i === 0 ? t(locale, 'All') : <span data-cms-field={`globalMarkets.regions[${i - 1}].name`}>{name}</span>}
            </button>
          ))}
        </div>

        {/* World map — highlights whichever region tab is active (or every
            market when "All" is selected); hover a pin for a country preview. */}
        <div className="gm-map-wrap mt-6">
          <WorldMarketsMap
            countries={
              active === 'All'
                ? regions.flatMap((r) => r.countries.map((name) => ({ name, region: r.name })))
                : (regions.find((r) => r.name === active)?.countries ?? []).map((name) => ({ name, region: active }))
            }
            locale={locale}
          />
        </div>
      </div>
    </section>
  );
}
