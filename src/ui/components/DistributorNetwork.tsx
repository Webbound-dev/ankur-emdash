import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import indiaMapRaw from '@svg-maps/india';
import { computePathCentroid } from '../lib/mapCentroid';
import { t } from '../../lib/ui-strings';
import type { Locale } from '../../lib/i18n';

// Browser only: GSAP starts a timer on registration, which Cloudflare Workers forbid at module scope (SSR).
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

interface IndiaLocation {
  name: string;
  id: string;
  path: string;
}

// Same real state/UT boundary data DistributionMap uses on the homepage —
// every distributor's `state` value just needs to match one of these names
// for its pin to place itself, no hand-plotted coordinates required.
const indiaMap = indiaMapRaw as unknown as { viewBox: string; locations: IndiaLocation[] };
const [, , VIEWBOX_W, VIEWBOX_H] = indiaMap.viewBox.split(' ').map(Number);

const LOCATION_BY_KEY = new Map<string, IndiaLocation>();
for (const loc of indiaMap.locations) {
  LOCATION_BY_KEY.set(loc.name.trim().toLowerCase(), loc);
  LOCATION_BY_KEY.set(loc.id.trim().toLowerCase(), loc);
}
function findLocation(name: string): IndiaLocation | undefined {
  return LOCATION_BY_KEY.get(name.trim().toLowerCase());
}

export interface Distributor {
  state: string;
}

export interface DistributorNetworkContent {
  hero: {
    eyebrow: string;
    heading: string;
    intro: string;
  };
}

export default function DistributorNetwork({
  content,
  distributors: initialDistributors,
  locale = 'en',
}: {
  content: DistributorNetworkContent;
  /** Page language, for the interface text (src/lib/ui-strings.ts). */
  locale?: Locale;
  distributors: Distributor[];
}) {
  const { hero } = content;
  const heroRef = useRef<HTMLElement>(null);
  const pathRefs = useRef<Map<string, SVGPathElement>>(new Map());

  const distributors = initialDistributors;
  const [centers, setCenters] = useState<Map<string, { x: number; y: number }>>(new Map());

  // Badge positions come from each path's actual filled-area centroid, same
  // technique DistributionMap uses on the homepage — a bounding-box center
  // drifts off the real state for concave/elongated shapes (Gujarat's Kutch
  // peninsula, J&K's long diagonal outline, the tightly packed northeast),
  // while this stays fully automatic: an editor adding a new state name
  // still just works without anyone hand-plotting a coordinate for it.
  useLayoutEffect(() => {
    const next = new Map<string, { x: number; y: number }>();
    pathRefs.current.forEach((el, id) => {
      const centroid = computePathCentroid(el.getAttribute('d') ?? '', VIEWBOX_W, VIEWBOX_H);
      if (centroid) next.set(id, centroid);
    });
    setCenters(next);
  }, []);

  // pre-anim-hidden (global.css) hides `.dn-heading > *` via plain CSS from
  // the very first paint — Astro/React paint the real, fully-visible copy
  // well before this client:load island hydrates, so without it there's a
  // real gap where the finished hero sits on screen unanimated before GSAP
  // catches up and yanks it back to hidden (which is what made the heading
  // look like it had no animation at all — by the time anyone scrolled to
  // it, it was already sitting fully visible from that gap). fromTo (not
  // .from) gives the tween an explicit end value instead of letting GSAP
  // infer one by reading the element's current computed style — which, with
  // the CSS pre-hide already at opacity:0, would otherwise read
  // "current == target == 0" and produce a no-op.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      ScrollTrigger.batch('.dn-heading > *', {
        start: 'top 85%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { y: 24, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', stagger: 0.1, delay: 0.15 },
          ),
      });
    }, heroRef);
    return () => ctx.revert();
  }, []);

  // Pins get their own effect, keyed on `centers` — they don't exist in the
  // DOM at all until the centers-computing layout effect above resolves and
  // triggers a second render (each pin's own JSX bails to `[]` while its
  // center is still unknown). Registering ScrollTrigger.batch('.dn-pin', ...)
  // in the same, mount-only effect as the heading above was finding zero
  // elements — batch() reads the DOM once, synchronously, at registration
  // time, it doesn't watch for elements added later — so the pins silently
  // never animated. This effect re-registers once real pins are actually in
  // the DOM. (Same fix as the homepage's DistributionMap.tsx.) No CSS
  // pre-hide here either, same reasoning as `.dn-row` above: an admin can
  // add a new distributor via edit mode, which renders a new pin without
  // `centers` itself ever changing (it's derived from the map's fixed state
  // geometry, not from the distributor list) — so this effect wouldn't
  // re-fire to reveal it, and a persistent CSS rule would leave that pin
  // stuck invisible forever.
  useLayoutEffect(() => {
    if (centers.size === 0) return;
    const ctx = gsap.context(() => {
      ScrollTrigger.batch('.dn-pin', {
        start: 'top 85%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { scale: 0, opacity: 0 },
            { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.7)', stagger: 0.015 },
          ),
      });
    }, heroRef);
    return () => ctx.revert();
  }, [centers]);

  // Group distributors by state — drives the dot-matrix map (which states
  // get a dot scatter + badge).
  const byState = new Map<string, Distributor[]>();
  for (const d of distributors) {
    if (!d.state) continue;
    const list = byState.get(d.state) ?? [];
    list.push(d);
    byState.set(d.state, list);
  }

  return (
    <>
      {/* ── Hero: full-bleed India map ───────────────────────────────────── */}
      <section id="find-distributor" ref={heroRef} className="pre-anim-hidden relative bg-indian-red overflow-hidden scroll-mt-20">
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{ backgroundImage: 'repeating-linear-gradient(90deg, #FFF6EB 0, #FFF6EB 1px, transparent 1px, transparent 28px)' }}
          />
        </div>

        {/* Stacked, not side-by-side — heading/intro centered on top, map
            centered below, same order as the original layout. */}
        <div className="relative max-w-[900px] mx-auto px-6 lg:px-10 py-12 lg:py-16 text-center">
          <div className="dn-heading">
            <span
              data-cms-field="hero.eyebrow"
              className="block font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-silent-white/60"
            >
              {hero.eyebrow}
            </span>
            <h1
              data-cms-field="hero.heading"
              className="mt-2 font-display font-medium text-3xl lg:text-5xl text-silent-white leading-tight [text-wrap:balance]"
            >
              {hero.heading}
            </h1>
            <p
              data-cms-field="hero.intro"
              className="mt-4 font-sans text-sm lg:text-base leading-relaxed text-silent-white/70 max-w-[440px] mx-auto"
            >
              {hero.intro}
            </p>
          </div>

          {/* Clean line-art, not a filled shape or a dot texture — every
              state is a thin outline with just a whisper of fill so the
              landmass still reads at a glance (states with a distributor
              presence a touch brighter than empty ones). Soft glow behind
              the map and a drop-shadow under the badges give the whole
              thing some depth instead of sitting perfectly flat. Badges
              scale up slightly with distributor count, so a state with 3
              carries a bit more visual weight than one with 1. */}
          <div className="relative mt-10 lg:mt-12 mx-auto h-[280px] sm:h-[340px] lg:h-[420px]">
            <div className="pointer-events-none absolute -top-10 -left-10 h-56 w-56 rounded-full bg-silent-white/10 blur-3xl" aria-hidden="true" />
            <div className="pointer-events-none absolute -bottom-14 -right-6 h-64 w-64 rounded-full bg-silent-white/10 blur-3xl" aria-hidden="true" />
            <span className="sr-only">{t(locale, 'Map of Ankur\'s distributor network across India')}</span>
            <svg viewBox={indiaMap.viewBox} className="relative h-full w-auto mx-auto block drop-shadow-[0_12px_28px_rgba(0,0,0,0.25)]" aria-hidden="true">
              {indiaMap.locations.map((loc) => (
                <path
                  key={loc.id}
                  ref={(el) => {
                    if (el) pathRefs.current.set(loc.id, el);
                  }}
                  d={loc.path}
                  fill="currentColor"
                  stroke="currentColor"
                  strokeWidth={0.9}
                  className={byState.has(loc.name) ? 'text-silent-white/[0.08] stroke-silent-white/60' : 'text-silent-white/[0.03] stroke-silent-white/20'}
                />
              ))}
              {[...byState.keys()].map((stateName) => {
                const loc = findLocation(stateName);
                const center = loc && centers.get(loc.id);
                if (!center) return null;
                // Presence dot — same marker as the homepage's
                // DistributionMap, inverted for this hero's solid red
                // backdrop (a same-red dot would disappear into it). Just
                // marks that Ankur has distributors in this state; no count
                // on the marker itself, no size scaling by distributor count.
                return (
                  <g
                    key={stateName}
                    className="dn-pin"
                    transform={`translate(${center.x}, ${center.y})`}
                    style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))' }}
                  >
                    <title>{stateName}</title>
                    <circle r={11} fill="none" stroke="#FFF6EB" strokeOpacity={0.4} strokeWidth={1.5} />
                    <circle r={5} fill="#FFF6EB" />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </section>
    </>
  );
}
